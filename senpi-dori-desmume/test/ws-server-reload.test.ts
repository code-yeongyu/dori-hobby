import { createServer } from "node:net";
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { startInterventionServer } from "../extensions/intervention/ws-server.js";

type MockPi = Pick<ExtensionAPI, "sendUserMessage">;

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", (error: Error) => reject(error));
	});
}

function waitForMessage(socket: WebSocket): Promise<string> {
	return new Promise((resolve) => {
		socket.once("message", (raw) =>
			resolve(typeof raw === "string" ? raw : raw.toString("utf8")),
		);
	});
}

async function getAvailablePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once("error", (error) => reject(error));
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			if (address === null || typeof address === "string") {
				reject(new Error("No TCP address available"));
				return;
			}
			const port = address.port;
			probe.close((closeError) => {
				if (closeError !== undefined) {
					reject(closeError);
					return;
				}
				resolve(port);
			});
		});
	});
}

async function occupyPort(port: number): Promise<{
	readonly close: () => Promise<void>;
}> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", (error) => reject(error));
		server.listen(port, "127.0.0.1", () => {
			resolve({
				close: async () => {
					await new Promise<void>((closeResolve, closeReject) => {
						server.close((error) => {
							if (error !== undefined) {
								closeReject(error);
								return;
							}
							closeResolve();
						});
					});
				},
			});
		});
	});
}

async function waitForTicks(count: number): Promise<void> {
	for (let index = 0; index < count; index += 1) {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	}
}

describe("intervention websocket server reload", () => {
	it("reuses the listener and forwards messages to the latest extension API", async () => {
		const firstSendUserMessage = vi.fn<(message: string) => void>();
		const secondSendUserMessage = vi.fn<(message: string) => void>();
		const firstPi: MockPi = { sendUserMessage: firstSendUserMessage };
		const secondPi: MockPi = { sendUserMessage: secondSendUserMessage };
		const port = await getAvailablePort();
		const firstServer = startInterventionServer(firstPi, port);
		const secondServer = startInterventionServer(secondPi, port);
		const client = new WebSocket(`ws://127.0.0.1:${port.toString()}`);
		await waitForOpen(client);

		client.send(
			JSON.stringify({ type: "message", text: "reload ok", id: "r1" }),
		);
		const raw = await waitForMessage(client);

		expect(JSON.parse(raw)).toEqual({ type: "ack", id: "r1" });
		expect(firstSendUserMessage).not.toHaveBeenCalled();
		// `deliverAs: "steer"` is REQUIRED by senpi 2026.5.x — chat injects
		// must interrupt the current response, not silently fail with "Agent
		// is already processing". The intervention chat panel is for
		// mid-flight course correction.
		expect(secondSendUserMessage).toHaveBeenCalledWith("reload ok", {
			deliverAs: "steer",
		});

		client.close();
		await secondServer.stop();
		await firstServer.stop();
	});

	it("does not surface an uncaught exception when the intervention port is busy", async () => {
		const sendUserMessage = vi.fn<(message: string) => void>();
		const pi: MockPi = { sendUserMessage };
		const port = await getAvailablePort();
		const occupied = await occupyPort(port);
		let uncaught: Error | undefined;
		const recordUncaught = (error: Error): void => {
			uncaught = error;
		};
		process.once("uncaughtException", recordUncaught);

		const server = startInterventionServer(pi, port);
		await waitForTicks(5);

		process.off("uncaughtException", recordUncaught);
		await server.stop();
		await occupied.close();
		expect(uncaught).toBeUndefined();
	});
});
