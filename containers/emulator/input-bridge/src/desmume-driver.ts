import {
	assertIntegerInRange,
	assertNever,
	assertTouchPoint,
	DEFAULT_TOUCH_HOLD_MS,
	type ResolvedButtonPressOptions,
	resolveButtonPressOptions,
	TOUCH_DRAG_FRAME_MS,
} from "./input-options.js";
import {
	BUTTON_KEY_MAP,
	type ButtonPressOptions,
	type NdsButton,
	type SequenceStep,
	type TouchPoint,
} from "./types.js";

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

const matchInt = (haystack: string, pattern: RegExp): number | undefined => {
	const m = pattern.exec(haystack);
	if (m === null) return undefined;
	const captured = m[1];
	if (captured === undefined) return undefined;
	const value = Number.parseInt(captured, 10);
	if (Number.isNaN(value)) return undefined;
	return value;
};

interface CanvasGeometry {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

// DeSmuME 0.9.11 GTK draws a menu + toolbar above the game canvas
// inside the toplevel window, and a status bar below it. Measured
// empirically by capturing the full 256x490 window and inspecting
// where uniform-chrome rows transition into varied-game rows:
//   rows  0..84  = menu + toolbar (chrome)
//   rows 85..276 = DS top screen (192 px)
//   rows 277..468 = DS bottom screen (192 px)
//   rows 470..489 = status bar (chrome)
// So the real two-screen canvas is exactly 256x384 starting 85 px
// below the toplevel's upper edge.
const GTK_CHROME_TOP_PX = 85;
const GTK_CHROME_BOTTOM_PX = 21;

export class DesmumeDriver {
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
	 * `xdotool getwindowgeometry --shell` returns coordinates that include
	 * GTK frame offset adjustments — they're NOT the true root-window
	 * absolute position. Cropping with those numbers slices through the
	 * menu bar.
	 *
	 * `xwininfo` exposes "Absolute upper-left X/Y" which IS the right
	 * value to pass to `import -window root` + crop and ffmpeg's
	 * `:99.0+X,Y` offset.
	 */
	private async getCanvasGeometry(): Promise<CanvasGeometry> {
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
		// Trim the GTK menu/toolbar (top) and status bar (bottom) so the
		// reported canvas is just the two DS screens.
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
		const geometry = await this.getCanvasGeometry();
		const centerX = geometry.x + Math.floor(geometry.width / 2);
		const centerY = geometry.y + Math.floor(geometry.height / 2);
		await this.runner.run("xdotool", ["mousemove", String(centerX), String(centerY)]);
		await this.runner.run("xdotool", ["windowactivate", "--sync", windowId]);
		await this.sleep(50);
	}

	private async pressButtonFocused(button: NdsButton, options: ResolvedButtonPressOptions): Promise<void> {
		const key = BUTTON_KEY_MAP[button];
		if (options.holdMs > 0) {
			await this.runner.run("xdotool", ["keydown", key]);
			await this.sleep(options.holdMs);
			await this.runner.run("xdotool", ["keyup", key]);
			return;
		}

		for (let index = 0; index < options.repeatCount; index += 1) {
			await this.runner.run("xdotool", ["key", key]);
			if (index < options.repeatCount - 1) {
				await this.sleep(options.repeatIntervalMs);
			}
		}
	}

	public async pressButton(button: NdsButton, options?: number | ButtonPressOptions): Promise<void> {
		const resolvedOptions = resolveButtonPressOptions(options);
		const windowId = await this.findWindow();

		await this.focusCanvas(windowId);
		await this.pressButtonFocused(button, resolvedOptions);
	}

	private async getTouchRootPoint(point: TouchPoint): Promise<TouchPoint> {
		const geometry = await this.getCanvasGeometry();
		const halfH = Math.floor(geometry.height / 2);
		return { x: geometry.x + point.x, y: geometry.y + halfH + point.y };
	}

	private async touchFocused(point: TouchPoint, holdMs: number): Promise<void> {
		assertTouchPoint(point);
		assertIntegerInRange("hold_ms", holdMs, 50, 5000);
		const root = await this.getTouchRootPoint(point);
		await this.runner.run("xdotool", ["mousemove", String(root.x), String(root.y)]);
		await this.runner.run("xdotool", ["mousedown", "1"]);
		await this.sleep(holdMs);
		await this.runner.run("xdotool", ["mouseup", "1"]);
	}

	public async touch(x: number, y: number, holdMs = DEFAULT_TOUCH_HOLD_MS): Promise<void> {
		const point = { x, y };
		assertTouchPoint(point);
		assertIntegerInRange("hold_ms", holdMs, 50, 5000);

		const windowId = await this.findWindow();
		await this.focusCanvas(windowId);
		// Canvas-local layout (relative to the DeSmuME drawing area):
		//   top DS screen:    y = 0..(canvas_h*192/(192+192+gap))      (view only)
		//   bottom DS screen: y starts at roughly canvas_h * 192/384
		// The default DeSmuME 0.9.11 canvas at 1x is 256x490 with a small
		// gap between screens. Half-and-half is a good-enough approximation
		// for clicking the bottom screen.
		await this.touchFocused(point, holdMs);
	}

	private async touchDragFocused(from: TouchPoint, to: TouchPoint, durationMs: number): Promise<void> {
		assertTouchPoint(from);
		assertTouchPoint(to);
		assertIntegerInRange("duration_ms", durationMs, 50, 3000);
		const fromRoot = await this.getTouchRootPoint(from);
		const toRoot = await this.getTouchRootPoint(to);
		const frameCount = Math.max(1, Math.ceil(durationMs / TOUCH_DRAG_FRAME_MS));
		const frameDelayMs = Math.max(1, Math.round(durationMs / frameCount));
		await this.runner.run("xdotool", ["mousemove", String(fromRoot.x), String(fromRoot.y)]);
		await this.runner.run("xdotool", ["mousedown", "1"]);
		for (let frame = 1; frame <= frameCount; frame += 1) {
			await this.sleep(frameDelayMs);
			const ratio = frame / frameCount;
			const rootX = Math.round(fromRoot.x + (toRoot.x - fromRoot.x) * ratio);
			const rootY = Math.round(fromRoot.y + (toRoot.y - fromRoot.y) * ratio);
			await this.runner.run("xdotool", ["mousemove", String(rootX), String(rootY)]);
		}
		await this.runner.run("xdotool", ["mouseup", "1"]);
	}

	public async touchDrag(from: TouchPoint, to: TouchPoint, durationMs: number): Promise<void> {
		assertTouchPoint(from);
		assertTouchPoint(to);
		assertIntegerInRange("duration_ms", durationMs, 50, 3000);
		const windowId = await this.findWindow();
		await this.focusCanvas(windowId);
		await this.touchDragFocused(from, to, durationMs);
	}

	public async runSequence(steps: readonly SequenceStep[]): Promise<void> {
		const windowId = await this.findWindow();
		await this.focusCanvas(windowId);
		for (const step of steps) {
			switch (step.kind) {
				case "button":
					await this.pressButtonFocused(step.button, resolveButtonPressOptions(step));
					break;
				case "touch":
					await this.touchFocused({ x: step.x, y: step.y }, step.hold_ms ?? DEFAULT_TOUCH_HOLD_MS);
					break;
				case "touch_drag":
					await this.touchDragFocused(step.from, step.to, step.duration_ms);
					break;
				case "wait":
					assertIntegerInRange("ms", step.ms, 0, 10000);
					await this.sleep(step.ms);
					break;
				default:
					assertNever(step);
			}
		}
	}

	/**
	 * Save the current emulator state into DeSmuME's slot N (1..10).
	 * Hotkey: Shift+F<N>. DeSmuME writes the file to
	 *   ~/.config/desmume/<rom-basename>.dsN
	 * which the entrypoint mounts as a persistent volume so the state
	 * survives container restarts.
	 */
	public async saveState(slot: number): Promise<void> {
		if (slot < 1 || slot > 10) {
			throw new Error(`slot out of range: ${slot}`);
		}
		const windowId = await this.findWindow();
		await this.focusCanvas(windowId);
		// xdotool's key syntax for "shift + F1" is "shift+F1".
		await this.runner.run("xdotool", ["key", `shift+F${slot}`]);
	}

	/**
	 * Load DeSmuME's slot N (1..10) into the running emulator. Hotkey: F<N>.
	 * No-op if the slot file doesn't exist — DeSmuME will just beep.
	 */
	public async loadState(slot: number): Promise<void> {
		if (slot < 1 || slot > 10) {
			throw new Error(`slot out of range: ${slot}`);
		}
		const windowId = await this.findWindow();
		await this.focusCanvas(windowId);
		await this.runner.run("xdotool", ["key", `F${slot}`]);
	}

	public async captureScreen(): Promise<{
		readonly base64: string;
		readonly width: number;
		readonly height: number;
	}> {
		// Capture the root window then crop to the game canvas in one shell
		// pipeline. `import -window <child>` intermittently fails with
		// "Resource temporarily unavailable" because GTK keeps the canvas
		// backing pixmap busy. Cropping after a root capture is bulletproof.
		//
		// The canvas position is dynamic (entrypoint pins it to ~(10,10) but
		// the user might have moved it), so we re-resolve geometry every
		// time. Cheap: getwindowgeometry is microseconds.
		const geometry = await this.getCanvasGeometry();
		const cropSpec = `${geometry.width}x${geometry.height}+${geometry.x}+${geometry.y}`;
		// ImageMagick 6.x (Debian default) uses `convert`; v7+ uses `magick`.
		// Debian bookworm ships v6.9, so `convert` is what we have.
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
}
