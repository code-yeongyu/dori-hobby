import type { ExtensionAPI } from "@code-yeongyu/senpi";
import {
	broadcastAction,
	broadcastThinking,
	startInterventionServer,
} from "./intervention/ws-server.js";
import {
	captureScreenTool,
	pressButtonTool,
	pressSequenceTool,
	touchTool,
} from "./tools/index.js";

const DEFAULT_AUTOSAVE_INTERVAL_MS = 60_000;
const DEFAULT_AUTOSAVE_SLOT = 1;
const DEFAULT_BRIDGE_URL = "http://localhost:7878";

async function saveStateToBridge(
	bridgeUrl: string,
	slot: number,
): Promise<void> {
	const response = await fetch(`${bridgeUrl}/save-state`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ slot }),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`save-state http ${response.status}: ${text}`);
	}
}

export default async function extension(pi: ExtensionAPI): Promise<void> {
	pi.registerTool(captureScreenTool);
	pi.registerTool(pressButtonTool);
	pi.registerTool(pressSequenceTool);
	pi.registerTool(touchTool);

	const interventionPort = Number(process.env.INTERVENTION_PORT ?? 7979);
	const server = startInterventionServer(pi, interventionPort);
	console.log(
		`[senpi-dori-desmume] registered 4 tools + intervention WS on :${server.port}`,
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

	// Auto-save the emulator state to slot 1 every minute while Dori plays.
	// DeSmuME persists the slot to ~/.config/desmume/<rom>.ds1, which is a
	// bind-mount from the host, so progress survives container restarts AND
	// senpi restarts. The entrypoint adds --load-slot=1 on next boot when
	// the file exists, so resume is automatic. We surface every save as an
	// activity-log row so the viewer can see the checkpoint cadence.
	const autosaveIntervalMs = Number(
		process.env.NDS_AUTOSAVE_INTERVAL_MS ?? DEFAULT_AUTOSAVE_INTERVAL_MS,
	);
	const autosaveSlot = Number(
		process.env.NDS_AUTOSAVE_SLOT ?? DEFAULT_AUTOSAVE_SLOT,
	);
	const bridgeUrl = process.env.NDS_BRIDGE_URL ?? DEFAULT_BRIDGE_URL;
	const autosaveTimer =
		autosaveIntervalMs > 0
			? setInterval(() => {
					void saveStateToBridge(bridgeUrl, autosaveSlot)
						.then(() => {
							broadcastAction("screenshot", `autosaved slot ${autosaveSlot}`);
						})
						.catch((error: unknown) => {
							console.error(
								"[senpi-dori-desmume] autosave failed:",
								error instanceof Error ? error.message : error,
							);
						});
				}, autosaveIntervalMs)
			: undefined;

	const shutdown = (): void => {
		if (autosaveTimer !== undefined) {
			clearInterval(autosaveTimer);
		}
		void server.stop();
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}
