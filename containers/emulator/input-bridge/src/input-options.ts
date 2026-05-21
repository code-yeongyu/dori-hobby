import type { ButtonPressOptions, TouchPoint } from "./types.js";

export type ResolvedButtonPressOptions = {
	readonly holdMs: number;
	readonly repeatCount: number;
	readonly repeatIntervalMs: number;
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
