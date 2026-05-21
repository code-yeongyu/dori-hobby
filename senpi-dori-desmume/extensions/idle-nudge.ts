import type { ExtensionAPI } from "@code-yeongyu/senpi";
import {
	broadcastAction,
	broadcastAgentStatus,
} from "./intervention/ws-server.js";

export interface IdleNudgeOptions {
	readonly idleTimeoutMs: number;
	readonly nudgeText: string;
}

export interface IdleNudgeHandle {
	readonly stop: () => void;
}

type PiForIdle = Pick<ExtensionAPI, "on" | "sendUserMessage">;

export function installIdleNudge(
	pi: PiForIdle,
	options: IdleNudgeOptions,
): IdleNudgeHandle {
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
		if (options.idleTimeoutMs <= 0) {
			return;
		}
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			broadcastAction(
				"screenshot",
				`auto-nudge (idle ${Math.round(options.idleTimeoutMs / 1000)}s)`,
			);
			try {
				pi.sendUserMessage(options.nudgeText, { deliverAs: "steer" });
			} catch (error: unknown) {
				console.error(
					"[senpi-dori-desmume] idle nudge failed:",
					error instanceof Error ? error.message : error,
				);
			}
		}, options.idleTimeoutMs);
	});

	return { stop: clearIdleTimer };
}
