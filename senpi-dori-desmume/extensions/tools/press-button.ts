import { defineTool } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { captureScreenshot, postJson } from "./shared.js";

const BUTTONS = [
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
		"Press a Nintendo DS button. Auto-returns a fresh screenshot showing the result.",
	promptSnippet:
		"nds_press_button({ button: 'A' }): press a DS button. Auto-captures the result.",
	promptGuidelines: [
		"A confirms / interacts. B cancels / backs out. X opens the menu. Start pauses.",
		"Up/Down/Left/Right move the cursor or character.",
		"After pressing, study the returned screenshot before pressing again.",
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
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		await postJson("/button", params);
		const { contentBlocks } = await captureScreenshot();
		return {
			content: contentBlocks,
			details: { button: params.button },
		};
	},
});
