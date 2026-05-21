import {
	A_UNTIL_DIALOG_DEFAULT_MAX_PRESSES,
	A_UNTIL_DIALOG_DEFAULT_PRESS_INTERVAL_MS,
	A_UNTIL_DIALOG_DEFAULT_STABLE_THRESHOLD,
	type AUntilDialogRequest,
	type ButtonPressOptions,
	SEQUENCE_DEFAULT_ABORT_ON_STUCK,
	SEQUENCE_DEFAULT_STUCK_THRESHOLD,
	type SequenceRequest,
	type TouchPoint,
} from "./types.js";

export type ResolvedButtonPressOptions = {
	readonly holdMs: number;
	readonly repeatCount: number;
	readonly repeatIntervalMs: number;
};

export type ResolvedAUntilDialogOptions = {
	readonly maxPresses: number;
	readonly pressIntervalMs: number;
	readonly stableThreshold: number;
};

export type SequenceRunOptions = Omit<SequenceRequest, "steps">;

export type ResolvedSequenceRunOptions = {
	readonly abortOnStuck: boolean;
	readonly stuckThreshold: number;
};

export const DEFAULT_REPEAT_COUNT = 1;
export const DEFAULT_REPEAT_INTERVAL_MS = 80;
export const DEFAULT_TOUCH_HOLD_MS = 80;
export const TOUCH_DRAG_FRAME_MS = 16;

export const assertNever = (value: never): never => {
	throw new Error(`unexpected sequence step: ${JSON.stringify(value)}`);
};

export const assertIntegerInRange = (name: string, value: number, min: number, max: number): void => {
	if (!Number.isInteger(value) || value < min || value > max) {
		throw new Error(`${name} out of range: ${value}`);
	}
};

export const assertTouchPoint = (point: TouchPoint): void => {
	assertIntegerInRange("x", point.x, 0, 255);
	assertIntegerInRange("y", point.y, 0, 191);
};

export const resolveButtonPressOptions = (options?: number | ButtonPressOptions): ResolvedButtonPressOptions => {
	const holdMs = typeof options === "number" ? options : (options?.hold_ms ?? 0);
	const repeatCount =
		typeof options === "number" ? DEFAULT_REPEAT_COUNT : (options?.repeat_count ?? DEFAULT_REPEAT_COUNT);
	const repeatIntervalMs =
		typeof options === "number"
			? DEFAULT_REPEAT_INTERVAL_MS
			: (options?.repeat_interval_ms ?? DEFAULT_REPEAT_INTERVAL_MS);
	assertIntegerInRange("hold_ms", holdMs, 0, 5000);
	assertIntegerInRange("repeat_count", repeatCount, 1, 50);
	assertIntegerInRange("repeat_interval_ms", repeatIntervalMs, 10, 2000);
	if (holdMs > 0 && repeatCount > 1) {
		throw new Error("hold_ms and repeat_count are mutually exclusive");
	}
	return { holdMs, repeatCount, repeatIntervalMs };
};

export const resolveAUntilDialogOptions = (options?: AUntilDialogRequest): ResolvedAUntilDialogOptions => {
	const maxPresses = options?.max_presses ?? A_UNTIL_DIALOG_DEFAULT_MAX_PRESSES;
	const pressIntervalMs = options?.press_interval_ms ?? A_UNTIL_DIALOG_DEFAULT_PRESS_INTERVAL_MS;
	const stableThreshold = options?.stable_threshold ?? A_UNTIL_DIALOG_DEFAULT_STABLE_THRESHOLD;
	assertIntegerInRange("max_presses", maxPresses, 1, 200);
	assertIntegerInRange("press_interval_ms", pressIntervalMs, 50, 2000);
	assertIntegerInRange("stable_threshold", stableThreshold, 1, 10);
	return { maxPresses, pressIntervalMs, stableThreshold };
};

export const resolveSequenceRunOptions = (options?: SequenceRunOptions): ResolvedSequenceRunOptions => {
	const abortOnStuck = options?.abort_on_stuck ?? SEQUENCE_DEFAULT_ABORT_ON_STUCK;
	const stuckThreshold = options?.stuck_threshold ?? SEQUENCE_DEFAULT_STUCK_THRESHOLD;
	assertIntegerInRange("stuck_threshold", stuckThreshold, 2, 16);
	return { abortOnStuck, stuckThreshold };
};
