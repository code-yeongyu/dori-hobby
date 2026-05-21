import { defineTool } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { broadcastAction } from "../intervention/ws-server.js";
import { captureScreenshot, postJson } from "./shared.js";

export const BUTTONS = [
	"A",
	"B",
	"X",
	"Y",
	"L",
	"R",
	"Start",
	"Select",
	"Up",
	"Down",
	"Left",
	"Right",
] as const;

export const pressButtonTool = defineTool({
	name: "nds_press_button",
	label: "NDS Press Button",
	description:
		"Press, hold, or repeat a Nintendo DS button. Always auto-returns a fresh post-action screenshot.",
	promptSnippet:
		"nds_press_button({ button: 'A', repeat_count?: 1..50, repeat_interval_ms?: 10..2000, hold_ms?: 0..5000 }): press, hold, or repeat a DS button, then returns the screenshot.",
	promptGuidelines: [
		"A confirms / interacts. B cancels / backs out. X opens the menu. Start pauses.",
		"Up/Down/Left/Right move the cursor or character.",
		"Use repeat_count for known repeated taps, such as mashing A through dialog or walking several tiles.",
		"Use hold_ms for continuous movement. Do not combine hold_ms with repeat_count > 1.",
		"Every call returns the resulting screenshot; do not call nds_capture_screen after it unless you missed something.",
	],
	parameters: Type.Object({
		button: Type.Union(BUTTONS.map((button) => Type.Literal(button))),
		hold_ms: Type.Optional(
			Type.Integer({
				minimum: 0,
				maximum: 5000,
				description: "Hold duration in ms. Omit for a tap.",
			}),
		),
		repeat_count: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: 50,
				description:
					"Number of tap presses. Default 1. Mutually exclusive with hold_ms > 0.",
			}),
		),
		repeat_interval_ms: Type.Optional(
			Type.Integer({
				minimum: 10,
				maximum: 2000,
				description: "Delay between repeated taps in ms. Default 80.",
			}),
		),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		await postJson("/button", {
			button: params.button,
			hold_ms: params.hold_ms,
			repeat_count: params.repeat_count,
			repeat_interval_ms: params.repeat_interval_ms,
		});
		const repeatSuffix =
			params.repeat_count !== undefined && params.repeat_count > 1
				? ` × ${params.repeat_count} @ ${params.repeat_interval_ms ?? 80}ms`
				: "";
		const holdSuffix =
			params.hold_ms !== undefined && params.hold_ms > 0
				? ` (hold ${params.hold_ms}ms)`
				: "";
		const detail = `${params.button} button${repeatSuffix}${holdSuffix}`;
		broadcastAction("button", detail);
		const { contentBlocks } = await captureScreenshot();
		return {
			content: contentBlocks,
			details: {
				button: params.button,
				repeat_count: params.repeat_count ?? 1,
				screenshot: "post-action",
			},
		};
	},
});
