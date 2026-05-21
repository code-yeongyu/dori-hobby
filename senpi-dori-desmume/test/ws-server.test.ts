import { createServer } from "node:net";
import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type { ChatAck, ChatError } from "../extensions/intervention/types.js";
import { startInterventionServer } from "../extensions/intervention/ws-server.js";

type MockPi = Pick<ExtensionAPI, "sendUserMessage">;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseServerMessage(raw: WebSocket.RawData): ChatAck | ChatError {
	const text = typeof raw === "string" ? raw : raw.toString("utf8");
	const parsed: unknown = JSON.parse(text);
	if (!isRecord(parsed)) {
		throw new Error("Message was not an object");
	}
	if (parsed.type === "ack" && typeof parsed.id === "string") {
		return { type: "ack", id: parsed.id };
	}
	if (parsed.type === "error" && typeof parsed.message === "string") {
		return { type: "error", message: parsed.message };
	}
	throw new Error("Unknown message shape");
}

function waitForOpen(socket: WebSocket): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.once("open", () => resolve());
		socket.once("error", (error: Error) => reject(error));
	});
}

function waitForClose(socket: WebSocket): Promise<void> {
	return new Promise((resolve) => {
		socket.once("close", () => resolve());
	});
}

function waitForMessage(socket: WebSocket): Promise<ChatAck | ChatError> {
	return new Promise((resolve, reject) => {
		socket.once("message", (raw) => {
			try {
				resolve(parseServerMessage(raw));
			} catch (error) {
				reject(error);
			}
		});
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

describe("intervention websocket server", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("valid message is forwarded and acked", async () => {
		const sendUserMessage = vi.fn<(message: string) => void>();
		const pi: MockPi = { sendUserMessage };
		const port = await getAvailablePort();
		const server = startInterventionServer(pi, port);
		const client = new WebSocket(`ws://127.0.0.1:${port.toString()}`);
		await waitForOpen(client);

		client.send(
			JSON.stringify({ type: "message", text: "Take over now", id: "m1" }),
		);
		const message = await waitForMessage(client);

		expect(sendUserMessage).toHaveBeenCalledWith("Take over now", {
			deliverAs: "steer",
		});
		expect(message).toEqual({ type: "ack", id: "m1" });

		client.close();
		await waitForClose(client);
		await server.stop();
	});

	it("invalid JSON returns ChatError", async () => {
		const pi: MockPi = { sendUserMessage: vi.fn<(message: string) => void>() };
		const port = await getAvailablePort();
		const server = startInterventionServer(pi, port);
		const client = new WebSocket(`ws://127.0.0.1:${port.toString()}`);
		await waitForOpen(client);

		client.send("{invalid-json");
		const message = await waitForMessage(client);
		expect(message).toEqual({ type: "error", message: "invalid json" });

		client.close();
		await waitForClose(client);
		await server.stop();
	});

	it("schema mismatch returns ChatError", async () => {
		const pi: MockPi = { sendUserMessage: vi.fn<(message: string) => void>() };
		const port = await getAvailablePort();
		const server = startInterventionServer(pi, port);
		const client = new WebSocket(`ws://127.0.0.1:${port.toString()}`);
		await waitForOpen(client);

		client.send(JSON.stringify({ type: "message", text: "hello" }));
		const message = await waitForMessage(client);
		expect(message).toEqual({ type: "error", message: "schema mismatch" });

		client.close();
		await waitForClose(client);
		await server.stop();
	});

	it("empty text fails schema minLength", async () => {
		const pi: MockPi = { sendUserMessage: vi.fn<(message: string) => void>() };
		const port = await getAvailablePort();
		const server = startInterventionServer(pi, port);
		const client = new WebSocket(`ws://127.0.0.1:${port.toString()}`);
		await waitForOpen(client);

		client.send(JSON.stringify({ type: "message", text: "", id: "m2" }));
		const message = await waitForMessage(client);
		expect(message).toEqual({ type: "error", message: "schema mismatch" });

		client.close();
		await waitForClose(client);
		await server.stop();
	});

	it("two concurrent clients receive their own ack", async () => {
		const sendUserMessage = vi.fn<(message: string) => void>();
		const pi: MockPi = { sendUserMessage };
		const port = await getAvailablePort();
		const server = startInterventionServer(pi, port);
		const clientA = new WebSocket(`ws://127.0.0.1:${port.toString()}`);
		const clientB = new WebSocket(`ws://127.0.0.1:${port.toString()}`);
		await Promise.all([waitForOpen(clientA), waitForOpen(clientB)]);

		const aMessagePromise = waitForMessage(clientA);
		const bMessagePromise = waitForMessage(clientB);
		clientA.send(JSON.stringify({ type: "message", text: "alpha", id: "a" }));
		clientB.send(JSON.stringify({ type: "message", text: "beta", id: "b" }));

		const [aMessage, bMessage] = await Promise.all([
			aMessagePromise,
			bMessagePromise,
		]);
		expect(aMessage).toEqual({ type: "ack", id: "a" });
		expect(bMessage).toEqual({ type: "ack", id: "b" });
		expect(sendUserMessage).toHaveBeenCalledWith("alpha", {
			deliverAs: "steer",
		});
		expect(sendUserMessage).toHaveBeenCalledWith("beta", {
			deliverAs: "steer",
		});

		clientA.close();
		clientB.close();
		await Promise.all([waitForClose(clientA), waitForClose(clientB)]);
		await server.stop();
	});

	it("pi.sendUserMessage failure returns injection error", async () => {
		const sendUserMessage = vi.fn<(message: string) => void>(() => {
			throw new Error("boom");
		});
		const pi: MockPi = { sendUserMessage };
		const port = await getAvailablePort();
		const server = startInterventionServer(pi, port);
		const client = new WebSocket(`ws://127.0.0.1:${port.toString()}`);
		await waitForOpen(client);

		client.send(JSON.stringify({ type: "message", text: "explode", id: "m3" }));
		const message = await waitForMessage(client);
		expect(message).toEqual({
			type: "error",
			message: "injection failed: boom",
		});

		client.close();
		await waitForClose(client);
		await server.stop();
	});

	it("server.stop closes sockets", async () => {
		const pi: MockPi = { sendUserMessage: vi.fn<(message: string) => void>() };
		const port = await getAvailablePort();
		const server = startInterventionServer(pi, port);
		const client = new WebSocket(`ws://127.0.0.1:${port.toString()}`);
		await waitForOpen(client);

		const closePromise = waitForClose(client);
		await server.stop();
		await closePromise;
	});
});
