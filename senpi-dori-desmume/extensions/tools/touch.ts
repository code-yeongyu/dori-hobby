import { defineTool } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { broadcastAction } from "../intervention/ws-server.js";
import { captureScreenshot, postJson } from "./shared.js";

interface TouchParams {
	readonly x: number;
	readonly y: number;
}

function isBottomScreenCoordInRange(x: number, y: number): boolean {
	return x >= 0 && x <= 255 && y >= 0 && y <= 191;
}

const TOUCH_MAX_X = 255;
const TOUCH_MAX_Y = 191;

export const touchTool = defineTool({
	name: "nds_touch",
	label: "NDS Touch Screen",
	description:
		"Tap a point on the NDS bottom (touch) screen. Coordinates are absolute pixels within the BOTTOM screen only. Top screen is view-only.",
	promptSnippet:
		"nds_touch({ x, y }): tap the touch screen. x in [0,255], y in [0,191] (bottom screen only).",
	promptGuidelines: [
		"IMPORTANT: The top screen is VIEW-ONLY. Touch input ONLY works on the bottom screen.",
		"Coordinates x∈[0,255], y∈[0,191] are RELATIVE to the bottom screen's own top-left corner.",
		"In the combined 256x384 screenshot, the bottom screen occupies y=192..383. To convert: if you see a target at screenshot_y=300, the touch y = 300 - 192 = 108.",
		"Common bottom-screen targets in Pokémon: menu buttons, bag items, move selection during battle.",
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

		await postJson("/touch", params);
		broadcastAction("touch", `(${params.x}, ${params.y}) on bottom screen`);
		const { contentBlocks } = await captureScreenshot();

		return {
			content: contentBlocks,
			details: { x: params.x, y: params.y },
		};
	},
});
