import { type Static, Type } from "@sinclair/typebox";

export const NDS_BUTTONS = ["A", "B", "X", "Y", "L", "R", "Start", "Select", "Up", "Down", "Left", "Right"] as const;

export type NdsButton = (typeof NDS_BUTTONS)[number];

export const TOUCH_MAX_X = 255;
export const TOUCH_MAX_Y = 191;
export const SEQUENCE_MAX_STEPS = 32;
export const SEQUENCE_DEFAULT_ABORT_ON_STUCK = true;
export const SEQUENCE_DEFAULT_STUCK_THRESHOLD = 5;
export const A_UNTIL_DIALOG_DEFAULT_MAX_PRESSES = 80;
export const A_UNTIL_DIALOG_DEFAULT_PRESS_INTERVAL_MS = 250;
export const A_UNTIL_DIALOG_DEFAULT_STABLE_THRESHOLD = 3;

export const NdsButtonSchema = Type.Union([
	Type.Literal("A"),
	Type.Literal("B"),
	Type.Literal("X"),
	Type.Literal("Y"),
	Type.Literal("L"),
	Type.Literal("R"),
	Type.Literal("Start"),
	Type.Literal("Select"),
	Type.Literal("Up"),
	Type.Literal("Down"),
	Type.Literal("Left"),
	Type.Literal("Right"),
]);

export const ButtonSchema = Type.Object({
	button: NdsButtonSchema,
	hold_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
	repeat_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
	repeat_interval_ms: Type.Optional(Type.Integer({ minimum: 10, maximum: 2000 })),
});

export const TouchPointSchema = Type.Object({
	x: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_X }),
	y: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_Y }),
});

export const TouchSchema = Type.Object({
	x: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_X }),
	y: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_Y }),
	hold_ms: Type.Optional(Type.Integer({ minimum: 50, maximum: 5000 })),
});

export const TouchDragSchema = Type.Object({
	from: TouchPointSchema,
	to: TouchPointSchema,
	duration_ms: Type.Integer({ minimum: 50, maximum: 3000 }),
});

export const SequenceStepSchema = Type.Union([
	Type.Object({
		kind: Type.Literal("button"),
		button: NdsButtonSchema,
		hold_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
		repeat_count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
		repeat_interval_ms: Type.Optional(Type.Integer({ minimum: 10, maximum: 2000 })),
	}),
	Type.Object({
		kind: Type.Literal("touch"),
		x: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_X }),
		y: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_Y }),
		hold_ms: Type.Optional(Type.Integer({ minimum: 50, maximum: 5000 })),
	}),
	Type.Object({
		kind: Type.Literal("touch_drag"),
		from: TouchPointSchema,
		to: TouchPointSchema,
		duration_ms: Type.Integer({ minimum: 50, maximum: 3000 }),
	}),
	Type.Object({
		kind: Type.Literal("wait"),
		ms: Type.Integer({ minimum: 0, maximum: 10000 }),
	}),
]);

export const SequenceSchema = Type.Object({
	steps: Type.Array(SequenceStepSchema, { minItems: 1, maxItems: SEQUENCE_MAX_STEPS }),
	abort_on_stuck: Type.Optional(Type.Boolean()),
	stuck_threshold: Type.Optional(Type.Integer({ minimum: 2, maximum: 16 })),
});

export const AUntilDialogSchema = Type.Object({
	max_presses: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
	press_interval_ms: Type.Optional(Type.Integer({ minimum: 50, maximum: 2000 })),
	stable_threshold: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
});

// DeSmuME 0.9.11 GTK supports save-state slots 1..10 (hotkeys F1..F10
// to load, Shift+F1..F10 to save). We expose slot 0 too because DeSmuME
// accepts the "0" suffix internally for a "quick" slot in some builds —
// but the safe range is 1..10 and we default to slot 1 for autosave.
export const SaveStateSchema = Type.Object({
	slot: Type.Integer({ minimum: 1, maximum: 10 }),
});

export type ButtonRequest = Static<typeof ButtonSchema>;
export type ButtonPressOptions = Omit<ButtonRequest, "button">;
export type TouchRequest = Static<typeof TouchSchema>;
export type TouchPoint = Static<typeof TouchPointSchema>;
export type TouchDragRequest = Static<typeof TouchDragSchema>;
export type SequenceStep = Static<typeof SequenceStepSchema>;
export type SequenceRequest = Static<typeof SequenceSchema>;
export type AUntilDialogRequest = Static<typeof AUntilDialogSchema>;
export type SaveStateRequest = Static<typeof SaveStateSchema>;

export const BUTTON_KEY_MAP = {
	A: "x",
	B: "z",
	X: "s",
	Y: "a",
	L: "q",
	R: "w",
	Start: "Return",
	Select: "BackSpace",
	Up: "Up",
	Down: "Down",
	Left: "Left",
	Right: "Right",
} satisfies Readonly<Record<NdsButton, string>>;
