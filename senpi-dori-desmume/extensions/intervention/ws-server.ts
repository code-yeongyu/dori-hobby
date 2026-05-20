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

// Module-level handle to the running WSS so individual tool implementations
// can shout into the web UI without having to thread the server reference
// through every callsite. There's only ever ONE intervention server per
// senpi process — see startInterventionServer below.
let wssRef: WebSocketServer | undefined;

function broadcastJson(message: AgentActionWire | AgentThinkingWire): void {
	const server = wssRef;
	if (server === undefined) {
		// Server not started yet; tools called before extension boot complete.
		return;
	}
	const text = JSON.stringify(message);
	for (const client of server.clients) {
		if (client.readyState === 1) {
			// 1 === WebSocket.OPEN (avoid the ws.WebSocket static for ESM friendliness).
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
	const wss = new WebSocketServer({ port });
	wssRef = wss;

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
				pi.sendUserMessage(parsed.text);
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
			for (const client of wss.clients) {
				client.close();
			}

			await new Promise<void>((resolve, reject) => {
				wss.close((error) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					resolve();
				});
			});
			if (wssRef === wss) {
				wssRef = undefined;
			}
		},
	};
}
