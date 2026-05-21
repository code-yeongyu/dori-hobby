import { type Server, createServer } from "node:http";
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { Value } from "@sinclair/typebox/value";
import { type WebSocket, WebSocketServer } from "ws";
import { type ChatAck, type ChatError, ChatMessageSchema } from "./types.js";

export interface InterventionServer {
	port: number;
	stop(): Promise<void>;
}

export type AgentActionKind = "button" | "touch" | "screenshot";

interface AgentActionWire {
	readonly type: "agent-action";
	readonly id: string;
	readonly timestamp: number;
	readonly action: AgentActionKind;
	readonly detail: string;
}

interface AgentThinkingWire {
	readonly type: "agent-thinking";
	readonly id: string;
	readonly timestamp: number;
	readonly text: string;
}

interface InterventionServerState {
	readonly wss: WebSocketServer;
	readonly httpServer: Server;
	readonly port: number;
	readonly pi: Pick<ExtensionAPI, "sendUserMessage">;
}

declare global {
	var __senpiDoriInterventionServerState: InterventionServerState | undefined;
}

function currentInterventionState(): InterventionServerState | undefined {
	return globalThis.__senpiDoriInterventionServerState;
}

function setInterventionState(state: InterventionServerState): void {
	globalThis.__senpiDoriInterventionServerState = state;
}

function clearInterventionState(state: InterventionServerState): void {
	const currentState = currentInterventionState();
	if (currentState?.wss === state.wss) {
		globalThis.__senpiDoriInterventionServerState = undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorCode(error: unknown): string | undefined {
	if (!isRecord(error)) {
		return undefined;
	}
	const code = error.code;
	return typeof code === "string" ? code : undefined;
}

function broadcastJson(message: AgentActionWire | AgentThinkingWire): void {
	const server = currentInterventionState()?.wss;
	if (server === undefined) {
		return;
	}
	const text = JSON.stringify(message);
	for (const client of server.clients) {
		if (client.readyState === 1) {
			client.send(text);
		}
	}
}

function newId(): string {
	if (
		typeof globalThis.crypto !== "undefined" &&
		typeof globalThis.crypto.randomUUID === "function"
	) {
		return globalThis.crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Broadcast a single agent action (button press, touch, screenshot capture)
 * to every connected viewer. No-op when the intervention server isn't up,
 * so tools stay safe to call before the WS bootstraps.
 */
export function broadcastAction(action: AgentActionKind, detail: string): void {
	broadcastJson({
		type: "agent-action",
		id: newId(),
		timestamp: Date.now(),
		action,
		detail: detail.length > 240 ? `${detail.slice(0, 237)}...` : detail,
	});
}

/**
 * Broadcast a chunk of the agent's reasoning. Same delivery semantics as
 * broadcastAction. Keep texts short — multiple short emits look better in
 * the UI than one giant blob.
 */
export function broadcastThinking(text: string): void {
	broadcastJson({
		type: "agent-thinking",
		id: newId(),
		timestamp: Date.now(),
		text: text.length > 1000 ? `${text.slice(0, 997)}...` : text,
	});
}

function sendError(sock: WebSocket, message: string): void {
	const payload: ChatError = { type: "error", message };
	sock.send(JSON.stringify(payload));
}

export function startInterventionServer(
	pi: Pick<ExtensionAPI, "sendUserMessage">,
	port = 7979,
): InterventionServer {
	const existingState = currentInterventionState();
	if (existingState !== undefined) {
		setInterventionState({ ...existingState, pi });
		return {
			port: existingState.port,
			async stop() {
				await stopInterventionServer(existingState);
			},
		};
	}

	const httpServer = createServer();
	const wss = new WebSocketServer({ server: httpServer });
	const state: InterventionServerState = { wss, httpServer, port, pi };

	httpServer.on("error", (error) => {
		if (errorCode(error) === "EADDRINUSE") {
			clearInterventionState(state);
			void stopWebSocketServer(state).catch((closeError: unknown) => {
				console.error(
					"[senpi-dori-desmume] failed to close busy intervention WS:",
					closeError instanceof Error ? closeError.message : closeError,
				);
			});
			return;
		}
		console.error(
			"[senpi-dori-desmume] intervention HTTP server error:",
			error instanceof Error ? error.message : error,
		);
	});
	wss.on("error", (error) => {
		console.error(
			"[senpi-dori-desmume] intervention WS error:",
			error instanceof Error ? error.message : error,
		);
	});
	setInterventionState(state);
	try {
		httpServer.listen(port);
	} catch (error) {
		clearInterventionState(state);
		throw error;
	}

	wss.on("connection", (sock) => {
		sock.on("message", async (raw) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw.toString());
			} catch {
				sendError(sock, "invalid json");
				return;
			}

			if (!Value.Check(ChatMessageSchema, parsed)) {
				sendError(sock, "schema mismatch");
				return;
			}

			try {
				const currentPi = currentInterventionState()?.pi;
				if (currentPi === undefined) {
					sendError(sock, "injection failed: unavailable");
					return;
				}
				// 'steer' interrupts the current assistant response and
				// redirects with the new user message. The chat panel's
				// purpose IS mid-flight intervention — a watcher saying
				// "wait you missed the gift box" needs to land NOW, not
				// after Dori finishes whatever 50-button mash she's on.
				// Without streamingBehavior, senpi 2026.5.19+ rejects mid-
				// response with "Agent is already processing" and the
				// user's nudge silently vanishes.
				currentPi.sendUserMessage(parsed.text, {
					deliverAs: "steer",
				});
				const ack: ChatAck = { type: "ack", id: parsed.id };
				sock.send(JSON.stringify(ack));
			} catch (error) {
				if (error instanceof Error) {
					sendError(sock, `injection failed: ${error.message}`);
					return;
				}
				sendError(sock, "injection failed: unknown");
			}
		});
	});

	return {
		port,
		async stop() {
			await stopInterventionServer(state);
		},
	};
}

async function stopInterventionServer(
	state: InterventionServerState,
): Promise<void> {
	const currentState = currentInterventionState();
	if (currentState?.wss !== state.wss) {
		return;
	}
	await stopWebSocketServer(state);
	clearInterventionState(state);
}

async function stopWebSocketServer(
	state: InterventionServerState,
): Promise<void> {
	for (const client of state.wss.clients) {
		client.close();
	}

	await new Promise<void>((resolve, reject) => {
		state.wss.close((error) => {
			if (error !== undefined) {
				reject(error);
				return;
			}
			resolve();
		});
	});

	await new Promise<void>((resolve, reject) => {
		state.httpServer.close((error) => {
			if (
				error !== undefined &&
				errorCode(error) !== "ERR_SERVER_NOT_RUNNING"
			) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}
