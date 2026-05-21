import { defineTool } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { broadcastAction } from "../intervention/ws-server.js";
import { captureScreenshot, postJson } from "./shared.js";

function isBottomScreenCoordInRange(x: number, y: number): boolean {
	return x >= 0 && x <= 255 && y >= 0 && y <= 191;
}

const TOUCH_MAX_X = 255;
const TOUCH_MAX_Y = 191;
const DEFAULT_DRAG_DURATION_MS = 400;

const TouchPointSchema = Type.Object({
	x: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_X }),
	y: Type.Integer({ minimum: 0, maximum: TOUCH_MAX_Y }),
});

export const touchTool = defineTool({
	name: "nds_touch",
	label: "NDS Touch Screen",
	description:
		"Tap, hold, or drag on the NDS bottom touch screen. Coordinates are absolute pixels within the BOTTOM screen only. Top screen is view-only.",
	promptSnippet:
		"nds_touch({ x, y, hold_ms?, drag_to?, drag_duration_ms? }): tap, hold, or drag the bottom touch screen, then returns the screenshot.",
	promptGuidelines: [
		"IMPORTANT: The top screen is VIEW-ONLY. Touch input ONLY works on the bottom screen.",
		"Coordinates x∈[0,255], y∈[0,191] are RELATIVE to the bottom screen's own top-left corner.",
		"In the combined 256x384 screenshot, the bottom screen occupies y=192..383. To convert: if you see a target at screenshot_y=300, the touch y = 300 - 192 = 108.",
		"Common bottom-screen targets in Pokémon: menu buttons, bag items, move selection during battle.",
		"Use drag_to for stylus drags. drag_duration_ms defaults to 400ms when omitted.",
		"Every call returns the resulting screenshot; do not call nds_capture_screen after it unless you missed something.",
	],
	parameters: Type.Object({
		x: Type.Integer({
			minimum: 0,
			maximum: TOUCH_MAX_X,
			description: "X within the bottom screen (0=left, 255=right)",
		}),
		y: Type.Integer({
			minimum: 0,
			maximum: TOUCH_MAX_Y,
			description:
				"Y within the bottom screen (0=top of bottom screen, 191=bottom)",
		}),
		hold_ms: Type.Optional(
			Type.Integer({
				minimum: 50,
				maximum: 5000,
				description: "Tap-and-hold duration in ms. Default 80.",
			}),
		),
		drag_to: Type.Optional(TouchPointSchema),
		drag_duration_ms: Type.Optional(
			Type.Integer({
				minimum: 50,
				maximum: 3000,
				description:
					"Stylus drag duration in ms. Default 400 when drag_to is set.",
			}),
		),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		if (!isBottomScreenCoordInRange(params.x, params.y)) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Error: coordinates out of range. x must be 0..${TOUCH_MAX_X}, y must be 0..${TOUCH_MAX_Y} (bottom screen only).`,
					},
				],
				details: { error: "out_of_range", x: params.x, y: params.y },
			};
		}
		if (
			params.drag_to !== undefined &&
			!isBottomScreenCoordInRange(params.drag_to.x, params.drag_to.y)
		) {
			return {
				isError: true,
				content: [
					{
						type: "text",
						text: `Error: drag_to coordinates out of range. x must be 0..${TOUCH_MAX_X}, y must be 0..${TOUCH_MAX_Y} (bottom screen only).`,
					},
				],
				details: {
					error: "out_of_range",
					x: params.drag_to.x,
					y: params.drag_to.y,
				},
			};
		}

		const dragTo = params.drag_to;
		if (dragTo !== undefined) {
			await postJson("/touch-drag", {
				from: { x: params.x, y: params.y },
				to: dragTo,
				duration_ms: params.drag_duration_ms ?? DEFAULT_DRAG_DURATION_MS,
			});
		} else {
			await postJson("/touch", {
				x: params.x,
				y: params.y,
				hold_ms: params.hold_ms,
			});
		}
		const isDrag = dragTo !== undefined;
		const detail =
			dragTo !== undefined
				? `drag (${params.x}, ${params.y}) -> (${dragTo.x}, ${dragTo.y}) over ${params.drag_duration_ms ?? DEFAULT_DRAG_DURATION_MS}ms`
				: `(${params.x}, ${params.y}) on bottom screen`;
		broadcastAction("touch", detail);
		const { contentBlocks } = await captureScreenshot();

		return {
			content: contentBlocks,
			details: {
				x: params.x,
				y: params.y,
				drag: isDrag,
				screenshot: "post-action",
			},
		};
	},
});
