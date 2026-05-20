import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";
import { attachChatWs, closeUpstreamForTest } from "../src/server/chat-ws.js";

const randomPort = (): number => Math.floor(Math.random() * 10_000) + 20_000;

const onceMessage = (socket: WebSocket): Promise<string> => {
  return new Promise((resolve) => {
    socket.once("message", (raw: WebSocket.RawData) => {
      resolve(typeof raw === "string" ? raw : raw.toString());
    });
  });
};

const serverPort = (server: WebSocketServer): number => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("unexpected ws server address");
  }
  return address.port;
};

afterEach(() => {
  closeUpstreamForTest();
});

describe("chat ws bridge", () => {
  it("acks valid client message and forwards upstream", async () => {
    const upstreamPort = randomPort();
    process.env["SENPI_WS_HOST"] = "127.0.0.1";
    process.env["SENPI_WS_PORT"] = String(upstreamPort);

    const upstreamServer = new WebSocketServer({ port: upstreamPort });
    const upstreamReceived = new Promise<string>((resolve) => {
      upstreamServer.once("connection", (socket) => {
        socket.once("message", (raw: WebSocket.RawData) => {
          resolve(typeof raw === "string" ? raw : raw.toString());
        });
      });
    });

    const appPort = randomPort();
    const appServer = new WebSocketServer({ port: appPort });
    attachChatWs(appServer);

    const client = new WebSocket(`ws://127.0.0.1:${appPort}`);
    await new Promise<void>((resolve) => {
      client.once("open", () => {
        resolve();
      });
    });

    client.send(JSON.stringify({ type: "message", id: "id-1", text: "hello" }));

    const clientAckRaw = await onceMessage(client);
    const upstreamRaw = await upstreamReceived;

    expect(JSON.parse(clientAckRaw)).toEqual({ type: "ack", id: "id-1" });
    expect(JSON.parse(upstreamRaw)).toEqual({
      type: "message",
      id: "id-1",
      text: "hello",
    });

    client.close();
    appServer.close();
    upstreamServer.close();
  });

  it("returns invalid json error", async () => {
    const appServer = new WebSocketServer({ port: randomPort() });
    attachChatWs(appServer);

    const port = serverPort(appServer);
    expect(port).toBeGreaterThan(0);
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => {
      client.once("open", () => resolve());
    });

    client.send("{invalid");
    const errRaw = await onceMessage(client);
    expect(JSON.parse(errRaw)).toEqual({
      type: "error",
      message: "invalid json",
    });

    client.close();
    appServer.close();
  });

  it("returns schema mismatch error", async () => {
    const appServer = new WebSocketServer({ port: randomPort() });
    attachChatWs(appServer);

    const port = serverPort(appServer);
    expect(port).toBeGreaterThan(0);
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => {
      client.once("open", () => resolve());
    });

    client.send(JSON.stringify({ type: "message", id: "", text: "x" }));
    const errRaw = await onceMessage(client);
    expect(JSON.parse(errRaw)).toEqual({
      type: "error",
      message: "schema mismatch",
    });

    client.close();
    appServer.close();
  });
});
