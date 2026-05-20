import { Value } from "@sinclair/typebox/value";
import WSClient, {
  type RawData,
  type WebSocket,
  type WebSocketServer,
} from "ws";
import {
  type ChatMessage,
  ChatMessageSchema,
  type ServerToClient,
} from "../shared/types.js";

interface UpstreamConnection {
  readonly socket: WSClient;
  readonly ready: Promise<void>;
}

const createUpstreamUrl = (): string => {
  const host = process.env["SENPI_WS_HOST"] ?? "host.docker.internal";
  const port = Number(process.env["SENPI_WS_PORT"] ?? 7979);
  return `ws://${host}:${port}`;
};

let upstream: UpstreamConnection | undefined;

const getOrCreateUpstream = (): UpstreamConnection => {
  if (upstream !== undefined && upstream.socket.readyState === WSClient.OPEN) {
    return upstream;
  }

  const socket = new WSClient(createUpstreamUrl());
  const ready = new Promise<void>((resolve, reject) => {
    socket.once("open", () => {
      resolve();
    });
    socket.once("error", (error: Error) => {
      reject(error);
    });
  });

  upstream = { socket, ready };
  socket.on("error", () => {
    // handled by promise rejection path above for first-connect,
    // and ignored for later lifecycle events.
  });
  socket.once("close", () => {
    upstream = undefined;
  });

  return upstream;
};

const sendServerMessage = (
  client: WebSocket,
  message: ServerToClient,
): void => {
  client.send(JSON.stringify(message));
};

const sendError = (client: WebSocket, message: string): void => {
  sendServerMessage(client, { type: "error", message });
};

const handleClientMessage = async (
  client: WebSocket,
  raw: RawData,
): Promise<void> => {
  const text = typeof raw === "string" ? raw : raw.toString();
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(text) as unknown;
  } catch {
    sendError(client, "invalid json");
    return;
  }

  if (!Value.Check(ChatMessageSchema, parsedUnknown)) {
    sendError(client, "schema mismatch");
    return;
  }
  const parsed: ChatMessage = parsedUnknown;

  try {
    const connection = getOrCreateUpstream();
    await connection.ready;
    connection.socket.send(JSON.stringify(parsed));
    sendServerMessage(client, { type: "ack", id: parsed.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown";
    sendError(client, `upstream error: ${message}`);
  }
};

export const attachChatWs = (wss: WebSocketServer): void => {
  wss.on("connection", (client: WebSocket) => {
    client.on("message", (raw: RawData) => {
      void handleClientMessage(client, raw);
    });
  });
};

export const closeUpstreamForTest = (): void => {
  if (upstream !== undefined) {
    upstream.socket.close();
    upstream = undefined;
  }
};

export const handleBunMessage = async (
  raw: string,
  send: (message: ServerToClient) => void,
): Promise<void> => {
  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(raw) as unknown;
  } catch {
    send({ type: "error", message: "invalid json" });
    return;
  }

  if (!Value.Check(ChatMessageSchema, parsedUnknown)) {
    send({ type: "error", message: "schema mismatch" });
    return;
  }
  const parsed: ChatMessage = parsedUnknown;

  try {
    const connection = getOrCreateUpstream();
    await connection.ready;
    connection.socket.send(JSON.stringify(parsed));
    send({ type: "ack", id: parsed.id });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown";
    send({ type: "error", message: `upstream error: ${message}` });
  }
};
