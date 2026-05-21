import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { installIdleNudge } from "./idle-nudge.js";
import {
	broadcastAction,
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
const DEFAULT_BACKUP_EVERY_N_SAVES = 5;
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

async function waitForFileSettled(
	filePath: string,
	timeoutMs = 3_000,
	intervalMs = 100,
): Promise<void> {
	const fs = await import("node:fs/promises");
	const deadline = Date.now() + timeoutMs;
	let previousMtime = 0;
	let stableForMs = 0;
	while (Date.now() < deadline) {
		try {
			const stat = await fs.stat(filePath);
			const currentMtime = stat.mtimeMs;
			if (currentMtime === previousMtime && stat.size > 0) {
				stableForMs += intervalMs;
				if (stableForMs >= intervalMs * 2) {
					return;
				}
			} else {
				stableForMs = 0;
				previousMtime = currentMtime;
			}
		} catch {
			// File may not exist yet — keep polling.
		}
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
}

async function backupSaveStateToHost(slot: number): Promise<void> {
	const fs = await import("node:fs/promises");
	const path = await import("node:path");
	const src = path.resolve("desmume-state", `pokemon-white.ds${slot}`);
	// DeSmuME writes the slot file asynchronously after xdotool's
	// Shift+F<n>. If we copy too early we capture either a missing file
	// or a half-written one. Wait until the mtime is stable for at least
	// 200ms before copying.
	await waitForFileSettled(src);

	const backupDir = path.resolve("desmume-state", "backups");
	await fs.mkdir(backupDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const dst = path.join(backupDir, `pokemon-white.ds${slot}.${stamp}`);
	await fs.copyFile(src, dst);

	const entries = await fs.readdir(backupDir);
	const matching = entries
		.filter((name) => name.startsWith(`pokemon-white.ds${slot}.`))
		.sort();
	const keepN = 20;
	if (matching.length > keepN) {
		const toDelete = matching.slice(0, matching.length - keepN);
		await Promise.all(
			toDelete.map((name) => fs.unlink(path.join(backupDir, name))),
		);
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
	const backupEveryN = Number(
		process.env.NDS_BACKUP_EVERY_N_SAVES ?? DEFAULT_BACKUP_EVERY_N_SAVES,
	);
	let autosaveTickCount = 0;
	const autosaveTimer =
		autosaveIntervalMs > 0
			? setInterval(() => {
					void saveStateToBridge(bridgeUrl, autosaveSlot)
						.then(async () => {
							autosaveTickCount += 1;
							broadcastAction("screenshot", `autosaved slot ${autosaveSlot}`);
							if (backupEveryN > 0 && autosaveTickCount % backupEveryN === 0) {
								await backupSaveStateToHost(autosaveSlot).catch(
									(error: unknown) => {
										console.error(
											"[senpi-dori-desmume] save backup failed:",
											error instanceof Error ? error.message : error,
										);
									},
								);
							}
						})
						.catch((error: unknown) => {
							console.error(
								"[senpi-dori-desmume] autosave failed:",
								error instanceof Error ? error.message : error,
							);
						});
				}, autosaveIntervalMs)
			: undefined;

	const idleNudge = installIdleNudge(pi, {
		idleTimeoutMs: Number(
			process.env.IDLE_NUDGE_TIMEOUT_MS ?? DEFAULT_IDLE_NUDGE_MS,
		),
		nudgeText: IDLE_NUDGE_TEXT,
	});

	const shutdown = (): void => {
		if (autosaveTimer !== undefined) {
			clearInterval(autosaveTimer);
		}
		idleNudge.stop();
		void server.stop();
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}
