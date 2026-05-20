import { type Static, Type } from "@sinclair/typebox";

export const NDS_BUTTONS = ["A", "B", "X", "Y", "L", "R", "Start", "Select", "Up", "Down", "Left", "Right"] as const;

export type NdsButton = (typeof NDS_BUTTONS)[number];

export const TOUCH_MAX_X = 255;
export const TOUCH_MAX_Y = 191;

export const ButtonSchema = Type.Object({
	button: Type.Union([
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
	]),
	hold_ms: Type.Optional(Type.Integer({ minimum: 0, maximum: 5000 })),
});

export const TouchSchema = Type.Object({
	x: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_X }),
	y: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_Y }),
});

export type ButtonRequest = Static<typeof ButtonSchema>;
export type TouchRequest = Static<typeof TouchSchema>;

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
