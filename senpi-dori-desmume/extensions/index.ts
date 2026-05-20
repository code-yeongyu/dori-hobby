import type { ExtensionAPI } from "@code-yeongyu/senpi";
import {
	broadcastThinking,
	startInterventionServer,
} from "./intervention/ws-server.js";
import {
	captureScreenTool,
	pressButtonTool,
	touchTool,
} from "./tools/index.js";

export default async function extension(pi: ExtensionAPI): Promise<void> {
	pi.registerTool(captureScreenTool);
	pi.registerTool(pressButtonTool);
	pi.registerTool(touchTool);

	const interventionPort = Number(process.env.INTERVENTION_PORT ?? 7979);
	const server = startInterventionServer(pi, interventionPort);
	console.log(
		`[senpi-dori-desmume] registered 3 tools + intervention WS on :${server.port}`,
	);

	// Forward Dori's reasoning/text stream into the activity log. senpi
	// fires `message_update` token-by-token while the model streams; we
	// emit at the `*_end` boundaries so each row is a complete utterance
	// instead of a flood of single-character partials.
	pi.on("message_update", (event) => {
		const e = event.assistantMessageEvent;
		if (e.type === "text_end" && typeof e.content === "string") {
			const trimmed = e.content.trim();
			if (trimmed.length > 0) {
				broadcastThinking(trimmed);
			}
			return;
		}
		if (e.type === "thinking_end" && typeof e.content === "string") {
			const trimmed = e.content.trim();
			if (trimmed.length > 0) {
				// Tag extended-thinking blocks so the viewer can tell them apart
				// from the assistant's spoken text.
				broadcastThinking(`[think] ${trimmed}`);
			}
		}
	});

	process.once("SIGINT", () => {
		void server.stop();
	});
	process.once("SIGTERM", () => {
		void server.stop();
	});
}
