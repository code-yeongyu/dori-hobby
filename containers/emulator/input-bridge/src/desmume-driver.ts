import { type CommandRunner, DesmumeWindowController, defaultSleep, type SleepFunction } from "./desmume-window.js";
import {
	assertIntegerInRange,
	assertNever,
	assertTouchPoint,
	DEFAULT_TOUCH_HOLD_MS,
	type ResolvedButtonPressOptions,
	resolveAUntilDialogOptions,
	resolveButtonPressOptions,
	resolveSequenceRunOptions,
	type SequenceRunOptions,
	TOUCH_DRAG_FRAME_MS,
} from "./input-options.js";
import {
	type AUntilDialogRequest,
	BUTTON_KEY_MAP,
	type ButtonPressOptions,
	type NdsButton,
	type SequenceStep,
	type TouchPoint,
} from "./types.js";

export type { CommandResult, CommandRunner } from "./desmume-window.js";

export type DialogStopReason = "stable" | "max_presses";

export type AUntilDialogResult = {
	readonly stopReason: DialogStopReason;
	readonly pressCount: number;
	readonly durationMs: number;
};

export type SequenceAbortReason = "collision_stuck";

export type SequenceRunResult =
	| {
			readonly aborted: true;
			readonly stepsExecuted: number;
			readonly stepsRemaining: number;
			readonly abortReason: SequenceAbortReason;
			readonly stuckStreak: number;
	  }
	| {
			readonly aborted: false;
			readonly stepsExecuted: number;
			readonly stepsRemaining: 0;
			readonly stuckStreak: number;
	  };

const isMovementButton = (button: NdsButton): boolean => {
	switch (button) {
		case "Up":
		case "Down":
		case "Left":
		case "Right":
			return true;
		case "A":
		case "B":
		case "X":
		case "Y":
		case "L":
		case "R":
		case "Start":
		case "Select":
			return false;
		default:
			return assertNever(button);
	}
};

const hasMovementIntent = (step: SequenceStep): boolean => {
	switch (step.kind) {
		case "button":
			return isMovementButton(step.button);
		case "touch":
		case "touch_drag":
			return true;
		case "wait":
			return false;
		default:
			return assertNever(step);
	}
};

// Dialog stability needs exact full-frame equality; collision detection uses a
// low-resolution fingerprint so tiny sprite animation does not hide wall bumps.
const fingerprintScreenshot = (base64: string): string => {
	return new Bun.CryptoHasher("sha1").update(base64).digest("hex");
};

const nextStableStreak = (hash: string, lastHash: string | undefined, currentStreak: number): number => {
	return hash === lastHash ? currentStreak + 1 : 1;
};

const nextCollisionStreak = (hash: string, lastHash: string | undefined, currentStreak: number): number => {
	return hash === lastHash ? currentStreak + 1 : Math.max(1, currentStreak - 1);
};

const SEQUENCE_MOVEMENT_SETTLE_MS = 160;

export class DesmumeDriver {
	private readonly runner: CommandRunner;
	private readonly sleep: SleepFunction;
	private readonly window: DesmumeWindowController;

	public constructor(runner: CommandRunner, sleep: SleepFunction = defaultSleep) {
		this.runner = runner;
		this.sleep = sleep;
		this.window = new DesmumeWindowController(runner, sleep);
	}

	public async findWindow(): Promise<string> {
		return await this.window.findWindow();
	}

	private async focusCanvas(windowId: string): Promise<void> {
		await this.window.focusCanvas(windowId);
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

	public async aUntilDialog(options?: AUntilDialogRequest): Promise<AUntilDialogResult> {
		const resolvedOptions = resolveAUntilDialogOptions(options);
		const windowId = await this.findWindow();
		await this.focusCanvas(windowId);

		const startedAt = performance.now();
		let lastHash: string | undefined;
		let stableStreak = 0;
		for (let index = 0; index < resolvedOptions.maxPresses; index += 1) {
			await this.runner.run("xdotool", ["key", BUTTON_KEY_MAP.A]);
			await this.sleep(resolvedOptions.pressIntervalMs);
			const screenshot = await this.captureScreen();
			const hash = fingerprintScreenshot(screenshot.base64);
			stableStreak = nextStableStreak(hash, lastHash, stableStreak);
			lastHash = hash;
			const pressCount = index + 1;
			if (stableStreak >= resolvedOptions.stableThreshold) {
				return {
					stopReason: "stable",
					pressCount,
					durationMs: Math.round(performance.now() - startedAt),
				};
			}
		}

		return {
			stopReason: "max_presses",
			pressCount: resolvedOptions.maxPresses,
			durationMs: Math.round(performance.now() - startedAt),
		};
	}

	private async getTouchRootPoint(point: TouchPoint): Promise<TouchPoint> {
		const geometry = await this.window.getCanvasGeometry();
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

	public async runSequence(steps: readonly SequenceStep[], options?: SequenceRunOptions): Promise<SequenceRunResult> {
		const resolvedOptions = resolveSequenceRunOptions(options);
		const windowId = await this.findWindow();
		await this.focusCanvas(windowId);
		let lastHash: string | undefined;
		let stuckStreak = 0;
		for (const [index, step] of steps.entries()) {
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

			if (hasMovementIntent(step)) {
				await this.sleep(SEQUENCE_MOVEMENT_SETTLE_MS);
				const hash = await this.window.captureScreenFingerprint();
				stuckStreak = nextCollisionStreak(hash, lastHash, stuckStreak);
				lastHash = hash;
				if (resolvedOptions.abortOnStuck && stuckStreak >= resolvedOptions.stuckThreshold) {
					const stepsExecuted = index + 1;
					return {
						aborted: true,
						stepsExecuted,
						stepsRemaining: steps.length - stepsExecuted,
						abortReason: "collision_stuck",
						stuckStreak,
					};
				}
			}
		}
		return { aborted: false, stepsExecuted: steps.length, stepsRemaining: 0, stuckStreak };
	}

	public async saveState(slot: number): Promise<void> {
		if (slot < 1 || slot > 10) {
			throw new Error(`slot out of range: ${slot}`);
		}
		const windowId = await this.findWindow();
		await this.focusCanvas(windowId);
		await this.runner.run("xdotool", ["key", `shift+F${slot}`]);
	}

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
		return await this.window.captureScreen();
	}
}
