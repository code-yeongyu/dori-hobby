import { defineTool } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { captureScreenshot } from "./shared.js";

export const captureScreenTool = defineTool({
	name: "nds_capture_screen",
	label: "NDS Capture Screen",
	description:
		"Capture both NDS screens (top + bottom touch) as a single combined PNG image. Returns metadata about coordinate offsets.",
	promptSnippet:
		"nds_capture_screen: see the current DS display (returns a combined image of both screens)",
	promptGuidelines: [
		"The screenshot shows both DS screens stacked vertically.",
		"Top screen: y=0..191 (VIEW-ONLY, no touch).",
		"Bottom (touch) screen: y=192..383 in the screenshot.",
		"When deciding a touch coordinate, subtract 192 from the screenshot's y to get the touch tool's y.",
	],
	parameters: Type.Object({}),
	async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
		const { contentBlocks } = await captureScreenshot();
		return {
			content: contentBlocks,
			details: { source: "nds_capture_screen" },
		};
	},
});
