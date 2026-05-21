import type { ExtensionAPI } from "@code-yeongyu/senpi";
import {
	broadcastAction,
	broadcastAgentStatus,
	broadcastThinking,
	startInterventionServer,
} from "./intervention/ws-server.js";
import {
	aUntilDialogTool,
	captureScreenTool,
	notepadAppendTool,
	notepadReadTool,
	pressButtonTool,
	pressSequenceTool,
	recordEventTool,
	touchTool,
} from "./tools/index.js";

const DEFAULT_AUTOSAVE_INTERVAL_MS = 60_000;
const DEFAULT_AUTOSAVE_SLOT = 1;
const DEFAULT_BRIDGE_URL = "http://localhost:8787";
const DEFAULT_IDLE_NUDGE_MS = 45_000;
const IDLE_NUDGE_TEXT =
	"AUTOMATED NUDGE: you went idle. Your goal is to play Pokemon White and progress the story toward the Striaton Trio Badge. Take the next action NOW: capture screen, read notepad, then move forward with nds_press_sequence or nds_advance_dialog. Do not stop again.";

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
	pi.registerTool(aUntilDialogTool);
	pi.registerTool(captureScreenTool);
	pi.registerTool(notepadReadTool);
	pi.registerTool(notepadAppendTool);
	pi.registerTool(pressButtonTool);
	pi.registerTool(pressSequenceTool);
	pi.registerTool(recordEventTool);
	pi.registerTool(touchTool);

	const interventionPort = Number(process.env.INTERVENTION_PORT ?? 7979);
	const server = startInterventionServer(pi, interventionPort);
	console.log(
		`[senpi-dori-desmume] registered 8 tools + intervention WS on :${server.port}`,
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

	// Auto-nudge when Dori goes idle.
	//
	// senpi emits `agent_start` when an agent loop kicks off and `agent_end`
	// when the loop finishes and the system waits for the next user message.
	// That `agent_end` is the authoritative "truly idle" signal — unlike the
	// previous client-side heuristic where the status pill never transitioned
	// back from "running" to "idle", here we know the agent IS idle.
	//
	// Strategy: on `agent_end`, schedule a single-shot timer at
	// IDLE_NUDGE_TIMEOUT_MS. If the timer fires without `agent_start`
	// interrupting it, fire a steering nudge that reminds Dori of the goal.
	// `deliverAs: "steer"` is harmless when idle (nothing to interrupt) and
	// is the same code path the human chat panel uses, so we get the same
	// reliability guarantees.
	const idleNudgeMs = Number(
		process.env.IDLE_NUDGE_TIMEOUT_MS ?? DEFAULT_IDLE_NUDGE_MS,
	);
	let idleTimer: ReturnType<typeof setTimeout> | undefined;

	const clearIdleTimer = (): void => {
		if (idleTimer !== undefined) {
			clearTimeout(idleTimer);
			idleTimer = undefined;
		}
	};

	pi.on("agent_start", () => {
		clearIdleTimer();
		broadcastAgentStatus("running");
	});

	pi.on("agent_end", () => {
		clearIdleTimer();
		broadcastAgentStatus("idle");
		if (idleNudgeMs <= 0) {
			return;
		}
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			broadcastAction(
				"screenshot",
				`auto-nudge (idle ${Math.round(idleNudgeMs / 1000)}s)`,
			);
			try {
				pi.sendUserMessage(IDLE_NUDGE_TEXT, { deliverAs: "steer" });
			} catch (error: unknown) {
				console.error(
					"[senpi-dori-desmume] idle nudge failed:",
					error instanceof Error ? error.message : error,
				);
			}
		}, idleNudgeMs);
	});

	const shutdown = (): void => {
		if (autosaveTimer !== undefined) {
			clearInterval(autosaveTimer);
		}
		clearIdleTimer();
		void server.stop();
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}
