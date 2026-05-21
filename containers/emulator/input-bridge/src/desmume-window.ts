export type CommandResult = {
	readonly stdout: Uint8Array;
	readonly stderr: string;
	readonly code: number;
};

export interface CommandRunner {
	run(cmd: string, args: readonly string[], opts?: { readonly input?: string }): Promise<CommandResult>;
}

export type SleepFunction = (ms: number) => Promise<void>;

export const defaultSleep: SleepFunction = async (ms: number): Promise<void> => {
	await new Promise<void>((resolve) => {
		setTimeout(() => {
			resolve();
		}, ms);
	});
};

const firstLine = (value: Uint8Array): string | undefined => {
	const text = new TextDecoder().decode(value).trim();
	const lines = text.split("\n");
	const candidate = lines[0];
	if (candidate === undefined || candidate.length === 0) {
		return undefined;
	}
	return candidate;
};

const matchInt = (haystack: string, pattern: RegExp): number | undefined => {
	const m = pattern.exec(haystack);
	if (m === null) return undefined;
	const captured = m[1];
	if (captured === undefined) return undefined;
	const value = Number.parseInt(captured, 10);
	if (Number.isNaN(value)) return undefined;
	return value;
};

export interface CanvasGeometry {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

// DeSmuME 0.9.11 GTK draws menu/toolbar chrome above the game canvas and a
// status bar below it. The real two-screen canvas is 256x384 starting 85 px
// below the toplevel window; keep this math centralized for capture + input.
const GTK_CHROME_TOP_PX = 85;
const GTK_CHROME_BOTTOM_PX = 21;

export class DesmumeWindowController {
	private windowId: string | undefined;
	private cachedGeometry: CanvasGeometry | undefined;
	private readonly runner: CommandRunner;
	private readonly sleep: SleepFunction;

	public constructor(runner: CommandRunner, sleep: SleepFunction = defaultSleep) {
		this.runner = runner;
		this.sleep = sleep;
	}

	/**
	 * Resolve the current canvas position via `xwininfo -id`.
	 *
	 * `xdotool getwindowgeometry --shell` returns coordinates that include GTK
	 * frame offset adjustments; `xwininfo` exposes the root-window absolute point
	 * that works for root screenshot cropping and XTEST input.
	 */
	public async getCanvasGeometry(): Promise<CanvasGeometry> {
		if (this.cachedGeometry !== undefined) {
			return this.cachedGeometry;
		}
		const windowId = await this.findWindow();
		const result = await this.runner.run("xwininfo", ["-id", windowId]);
		if (result.code !== 0) {
			throw new Error("xwininfo failed");
		}
		const text = new TextDecoder().decode(result.stdout);
		const absX = matchInt(text, /Absolute upper-left X:\s+(-?\d+)/);
		const absY = matchInt(text, /Absolute upper-left Y:\s+(-?\d+)/);
		const width = matchInt(text, /Width:\s+(\d+)/);
		const height = matchInt(text, /Height:\s+(\d+)/);
		if (absX === undefined || absY === undefined || width === undefined || height === undefined) {
			throw new Error("incomplete xwininfo output");
		}
		const trimmedHeight = Math.max(1, height - GTK_CHROME_TOP_PX - GTK_CHROME_BOTTOM_PX);
		const geometry: CanvasGeometry = {
			x: absX,
			y: absY + GTK_CHROME_TOP_PX,
			width,
			height: trimmedHeight,
		};
		this.cachedGeometry = geometry;
		return geometry;
	}

	public async findWindow(): Promise<string> {
		if (this.windowId !== undefined) {
			return this.windowId;
		}

		for (let attempt = 0; attempt < 3; attempt += 1) {
			const result = await this.runner.run("xdotool", ["search", "--onlyvisible", "--name", "fps"]);
			if (result.code === 0) {
				const id = firstLine(result.stdout);
				if (id !== undefined) {
					this.windowId = id;
					return id;
				}
			}
			await this.sleep(500);
		}

		throw new Error("desmume window not found");
	}

	/**
	 * Hover the canvas, then activate the window. DeSmuME GTK ignores synthetic
	 * XSendEvent keypresses, so button input uses xdotool's root-window XTEST path.
	 */
	public async focusCanvas(windowId: string): Promise<void> {
		const geometry = await this.getCanvasGeometry();
		const centerX = geometry.x + Math.floor(geometry.width / 2);
		const centerY = geometry.y + Math.floor(geometry.height / 2);
		await this.runner.run("xdotool", ["mousemove", String(centerX), String(centerY)]);
		await this.runner.run("xdotool", ["windowactivate", "--sync", windowId]);
		await this.sleep(50);
	}

	public async captureScreen(): Promise<{
		readonly base64: string;
		readonly width: number;
		readonly height: number;
	}> {
		const geometry = await this.getCanvasGeometry();
		const cropSpec = `${geometry.width}x${geometry.height}+${geometry.x}+${geometry.y}`;
		const result = await this.runner.run("sh", [
			"-c",
			`import -window root miff:- | convert miff:- -crop ${cropSpec} +repage png:-`,
		]);
		if (result.code !== 0) {
			throw new Error("screen capture failed");
		}

		return {
			base64: Buffer.from(result.stdout).toString("base64"),
			width: geometry.width,
			height: geometry.height,
		};
	}

	public async captureScreenFingerprint(): Promise<string> {
		const geometry = await this.getCanvasGeometry();
		const cropSpec = `${geometry.width}x${geometry.height}+${geometry.x}+${geometry.y}`;
		const result = await this.runner.run("sh", [
			"-c",
			`import -window root miff:- | convert miff:- -crop ${cropSpec} +repage -resize 8x8! -depth 8 rgb:-`,
		]);
		if (result.code !== 0) {
			throw new Error("screen fingerprint failed");
		}
		return Buffer.from(result.stdout).toString("base64");
	}
}
