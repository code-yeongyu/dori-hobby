import type { ExtensionAPI } from "@code-yeongyu/senpi";
import {
	broadcastAction,
	broadcastAgentStatus,
} from "./intervention/ws-server.js";

export interface IdleNudgeOptions {
	readonly idleTimeoutMs: number;
	readonly nudgeText: string;
	readonly maxConsecutive?: number;
}

export interface IdleNudgeHandle {
	readonly stop: () => void;
}

type PiForIdle = Pick<ExtensionAPI, "on" | "sendUserMessage">;

const DEFAULT_MAX_CONSECUTIVE = 5;

export function installIdleNudge(
	pi: PiForIdle,
	options: IdleNudgeOptions,
): IdleNudgeHandle {
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let consecutiveCount = 0;
	const maxConsecutive = options.maxConsecutive ?? DEFAULT_MAX_CONSECUTIVE;

	const clearIdleTimer = (): void => {
		if (idleTimer !== undefined) {
			clearTimeout(idleTimer);
			idleTimer = undefined;
		}
	};

	pi.on("agent_start", () => {
		clearIdleTimer();
		consecutiveCount = 0;
		broadcastAgentStatus("running");
	});

	pi.on("agent_end", () => {
		clearIdleTimer();
		broadcastAgentStatus("idle");
		if (options.idleTimeoutMs <= 0) {
			return;
		}
		if (consecutiveCount >= maxConsecutive) {
			broadcastAction(
				"screenshot",
				`auto-nudge disabled after ${consecutiveCount} consecutive idle nudges`,
			);
			return;
		}
		idleTimer = setTimeout(() => {
			idleTimer = undefined;
			consecutiveCount += 1;
			broadcastAction(
				"screenshot",
				`auto-nudge ${consecutiveCount}/${maxConsecutive} (idle ${Math.round(options.idleTimeoutMs / 1000)}s)`,
			);
			const logFailure = (error: unknown): void => {
				console.error(
					"[senpi-dori-desmume] idle nudge failed:",
					error instanceof Error ? error.message : error,
				);
			};
			try {
				Promise.resolve(
					pi.sendUserMessage(options.nudgeText, { deliverAs: "steer" }),
				).catch(logFailure);
			} catch (error: unknown) {
				logFailure(error);
			}
		}, options.idleTimeoutMs);
	});

	return { stop: clearIdleTimer };
}
