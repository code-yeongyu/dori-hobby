import { BUTTON_KEY_MAP, type NdsButton, TOUCH_MAX_X, TOUCH_MAX_Y } from "./types.js";

export type CommandResult = {
	readonly stdout: Uint8Array;
	readonly stderr: string;
	readonly code: number;
};

export interface CommandRunner {
	run(cmd: string, args: readonly string[], opts?: { readonly input?: string }): Promise<CommandResult>;
}

type SleepFunction = (ms: number) => Promise<void>;

const defaultSleep: SleepFunction = async (ms: number): Promise<void> => {
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

export class DesmumeDriver {
	private windowId: string | undefined;
	private readonly runner: CommandRunner;
	private readonly sleep: SleepFunction;

	public constructor(runner: CommandRunner, sleep: SleepFunction = defaultSleep) {
		this.runner = runner;
		this.sleep = sleep;
	}

	public async findWindow(): Promise<string> {
		if (this.windowId !== undefined) {
			return this.windowId;
		}

		for (let attempt = 0; attempt < 3; attempt += 1) {
			// Match the VISIBLE game-canvas window (DeSmuME titles it
			// "DeSmuME - <fps> fps, ..."). `--class desmume` also matches
			// the hidden 10x10 GTK helper window which silently swallows
			// XSendEvent keys; filter to onlyvisible + name "fps" to be safe.
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
	 * Move the mouse cursor over the game canvas. With openbox configured
	 * for sloppy/under-mouse focus, this transfers keyboard focus to the
	 * DeSmuME window. We then use `xdotool key` WITHOUT --window, which
	 * uses the XTEST extension (real-looking events) instead of
	 * XSendEvent (synthetic, dropped by GDK's send_event filter).
	 *
	 * This indirection is necessary because DeSmuME GTK ignores synthetic
	 * X events for game-button presses.
	 */
	private async focusCanvas(windowId: string): Promise<void> {
		// Canvas is roughly 256x490 in its top-level frame at 388,253 on root.
		// Place mouse near the center of the canvas (absolute root coords).
		await this.runner.run("xdotool", ["mousemove", "517", "500"]);
		await this.runner.run("xdotool", ["windowactivate", "--sync", windowId]);
		await this.sleep(50);
	}

	public async pressButton(button: NdsButton, holdMs?: number): Promise<void> {
		const windowId = await this.findWindow();
		const key = BUTTON_KEY_MAP[button];

		await this.focusCanvas(windowId);

		if (holdMs === undefined || holdMs <= 0) {
			// XTEST-backed key event (no --window) — bypasses GDK synthetic filter.
			await this.runner.run("xdotool", ["key", key]);
			return;
		}

		await this.runner.run("xdotool", ["keydown", key]);
		await this.sleep(holdMs);
		await this.runner.run("xdotool", ["keyup", key]);
	}

	public async touch(x: number, y: number): Promise<void> {
		if (x < 0 || x > TOUCH_MAX_X) {
			throw new Error(`x out of range: ${x}`);
		}
		if (y < 0 || y > TOUCH_MAX_Y) {
			throw new Error(`y out of range: ${y}`);
		}

		const windowId = await this.findWindow();
		// Canvas is 256x490 inside the frame at 388,253. The lower DS
		// half lives at canvas-local y=[260..490], width 256. Convert
		// DS-touch coords to absolute root coords (no --window, so XTEST
		// click goes through the same synthetic-filter-free path as keys).
		const rootX = 389 + x;
		const rootY = 273 + 260 + y;
		await this.focusCanvas(windowId);
		await this.runner.run("xdotool", ["mousemove", String(rootX), String(rootY)]);
		await this.runner.run("xdotool", ["click", "1"]);
	}

	public async captureScreen(): Promise<{ readonly base64: string; readonly width: number; readonly height: number }> {
		// `import -window <child>` regularly fails with
		// "Resource temporarily unavailable" on Xvfb because GTK keeps the
		// canvas backing pixmap busy. Capture the root window — DeSmuME is
		// the only visible app, so the framing is stable.
		const result = await this.runner.run("import", ["-window", "root", "png:-"]);
		if (result.code !== 0) {
			throw new Error("screen capture failed");
		}

		return {
			base64: Buffer.from(result.stdout).toString("base64"),
			width: 1024,
			height: 768,
		};
	}
}
