import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { Value } from "@sinclair/typebox/value";
import { type WebSocket, WebSocketServer } from "ws";
import { type ChatAck, type ChatError, ChatMessageSchema } from "./types.js";

export interface InterventionServer {
	port: number;
	stop(): Promise<void>;
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
		},
	};
}
