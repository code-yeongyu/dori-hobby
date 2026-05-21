import { defineTool } from "@code-yeongyu/senpi";
import { Type } from "typebox";
import { broadcastAction } from "../intervention/ws-server.js";
import {
	captureScreenshot,
	postJson,
	readNumber,
	readString,
} from "./shared.js";

type AUntilDialogBridgeResponse = {
	readonly stopReason: "stable" | "max_presses";
	readonly pressCount: number;
	readonly durationMs: number;
};

const parseBridgeResponse = (
	payload: Record<string, unknown>,
): AUntilDialogBridgeResponse => {
	const stopReason = readString(payload, "stop_reason");
	if (stopReason !== "stable" && stopReason !== "max_presses") {
		throw new Error(`bridge payload invalid stop_reason: ${stopReason}`);
	}
	return {
		stopReason,
		pressCount: readNumber(payload, "press_count"),
		durationMs: readNumber(payload, "duration_ms"),
	};
};

export const aUntilDialogTool = defineTool({
	// ccapi-cf proxy (request-transformer.ts) converts snake_case tool
	// names to PascalCase on the way to Anthropic. `nds_a_until_dialog`
	// becomes `NdsAUntilDialog` — and that name has the `AU` substring,
	// which trips ccapi's `isPurePascalCase` heuristic (`/[A-Z]{2}/`).
	// The response-side reverse transform is then SKIPPED, so senpi
	// receives `NdsAUntilDialog` literally and looks up a tool it does
	// not have, logging `Tool NdsAUntilDialog not found` to every chat.
	// Rename to a form whose Pascal projection has no adjacent caps.
	name: "nds_advance_dialog",
	label: "NDS A Until Dialog Stable",
	description:
		"Press A repeatedly until post-press screenshots stabilize. Always auto-returns a fresh post-action screenshot.",
	promptSnippet:
		"nds_advance_dialog({ max_presses?: 1..200, press_interval_ms?: 50..2000, stable_threshold?: 1..10 }): A-mash through scripted dialog until the screen stabilizes, then returns the screenshot. (Was nds_a_until_dialog — renamed to avoid a ccapi proxy snake→Pascal reverse-transform bug.)",
	promptGuidelines: [
		"Prefer this over nds_press_button({ button: 'A', repeat_count: 20 }) for scripted dialog mashing.",
		"Use defaults first. Lower max_presses only when you know the dialog is short.",
		"Every call returns the resulting screenshot; do not call nds_capture_screen after it unless you missed something.",
	],
	parameters: Type.Object({
		max_presses: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
		press_interval_ms: Type.Optional(
			Type.Integer({ minimum: 50, maximum: 2000 }),
		),
		stable_threshold: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
		const response = parseBridgeResponse(
			await postJson("/a-until-dialog", {
				max_presses: params.max_presses,
				press_interval_ms: params.press_interval_ms,
				stable_threshold: params.stable_threshold,
			}),
		);
		broadcastAction(
			"button",
			`A-mash until stable: ${response.pressCount} presses, ${response.stopReason}`,
		);
		const { contentBlocks } = await captureScreenshot();
		return {
			content: contentBlocks,
			details: {
				stop_reason: response.stopReason,
				press_count: response.pressCount,
				duration_ms: response.durationMs,
				screenshot: "post-action",
			},
		};
	},
});
