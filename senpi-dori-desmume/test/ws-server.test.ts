import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createInterventionServer } from "../extensions/intervention/ws-server";

interface MockPi {
	sendUserMessage: (message: string) => void;
}

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", (error) => reject(error));
	});
}

function waitForClose(socket: WebSocket): Promise<void> {
	return new Promise((resolve) => {
		socket.once("close", () => resolve());
	});
}

describe("intervention websocket server", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("forwards intervention message to pi.sendUserMessage", async () => {
		const sendUserMessage = vi.fn<(message: string) => void>();
		const pi: MockPi = { sendUserMessage };
		const server = createInterventionServer(pi, { host: "127.0.0.1", port: 0 });
		await server.start();

		const address = server.address();
		expect(address).toBeDefined();
		const port = address?.port;
		expect(typeof port).toBe("number");

		const client = new WebSocket(`ws://127.0.0.1:${port?.toString() ?? "0"}`);
		await waitForOpen(client);
		client.send(JSON.stringify({ type: "intervene", text: "Take over now" }));

		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(sendUserMessage).toHaveBeenCalledWith("[Intervention] Take over now");

		client.close();
		await waitForClose(client);
		await server.stop();
	});
});
