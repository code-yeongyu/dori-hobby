import { Value } from "@sinclair/typebox/value";
import WSClient, {
  type RawData,
  type WebSocket,
  type WebSocketServer,
} from "ws";
import {
  AgentActionSchema,
  AgentStatusSchema,
  AgentThinkingSchema,
  type ChatMessage,
  ChatMessageSchema,
  type ServerToClient,
} from "../shared/types.js";

type Send = (message: ServerToClient) => void;

interface UpstreamConnection {
  readonly socket: WSClient;
  readonly ready: Promise<void>;
}

const createUpstreamUrl = (): string => {
  const host = process.env.SENPI_WS_HOST ?? "host.docker.internal";
  const port = Number(process.env.SENPI_WS_PORT ?? 7979);
  return `ws://${host}:${port}`;
};

// One upstream WS to senpi (intervention bridge on :7979). Many downstream
// clients subscribe and we broadcast every upstream message to all of them.
let upstream: UpstreamConnection | undefined;
const subscribers = new Set<Send>();

const broadcast = (message: ServerToClient): void => {
  console.log(`[chat-ws] broadcasting ${message.type} to ${subscribers.size} subscriber(s)`);
  for (const send of subscribers) {
    try {
      send(message);
    } catch {
      // best-effort: a dead socket shouldn't break delivery to the others.
    }
  }
};

// Parse + dispatch a message coming FROM senpi. Senpi may stream:
//   { type: "agent-action", action, detail, ... }
//   { type: "agent-thinking", text, ... }
// We schema-check before relaying so a buggy upstream can't pollute the UI.
const handleUpstreamMessage = (raw: string): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return;
  }
  if (Value.Check(AgentActionSchema, parsed)) {
    broadcast(parsed);
    return;
  }
  if (Value.Check(AgentThinkingSchema, parsed)) {
    broadcast(parsed);
    return;
  }
  if (Value.Check(AgentStatusSchema, parsed)) {
    broadcast(parsed);
  }
};

const getOrCreateUpstream = (): UpstreamConnection => {
  if (upstream !== undefined && upstream.socket.readyState === WSClient.OPEN) {
    return upstream;
  }

  // Attach the error handler FIRST so a sync connect failure doesn't fire
  // an unhandled 'error' event that crashes the bun process. The `ws`
  // client emits 'error' BEFORE 'close' on ENOTFOUND / ECONNREFUSED, so
  // we ALWAYS need a listener registered before any other lifecycle work.
  const socket = new WSClient(createUpstreamUrl());
  socket.on("error", () => {
    // Swallow: senpi may not be running yet. We retry the next time someone
    // calls getOrCreateUpstream (chat send, new client connection, etc.).
  });

  const ready = new Promise<void>((resolve, reject) => {
    socket.once("open", () => {
      resolve();
    });
    socket.once("error", (error: Error) => {
      reject(error);
    });
  });

  // Defensive: any consumer that does NOT await `ready` would leak an
  // unhandled rejection. Pre-attach a no-op .catch() to neutralise that.
  void ready.catch(() => {});

  upstream = { socket, ready };
  socket.on("message", (raw: RawData) => {
    const text = typeof raw === "string" ? raw : raw.toString();
    handleUpstreamMessage(text);
  });
  socket.once("close", () => {
    upstream = undefined;
    // After a senpi restart the existing upstream socket fires "close" but
    // existing browser subscribers stay connected. Eagerly attempt to
    // re-open the upstream connection so future agent-action / agent-status
    // events still flow through. Failures here are silent — the next chat
    // send or subscribe call would retry anyway.
    if (subscribers.size > 0) {
      setTimeout(() => {
        try {
          getOrCreateUpstream();
        } catch {
          // Ignore — next send/subscribe will retry.
        }
      }, 1_000);
    }
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

/**
 * Subscribe a downstream client to upstream broadcasts (agent-action,
 * agent-thinking). The returned function removes the subscription.
 *
 * Calling this also lazily opens the upstream connection so the senpi
 * bridge gets a single WS even when many tabs are open.
 */
export const subscribeToUpstream = (send: Send): (() => void) => {
  subscribers.add(send);
  // Eager attempt to open upstream — if senpi isn't running yet, we keep
  // the subscriber registered and `getOrCreateUpstream` will be retried
  // the next time a chat message is sent.
  try {
    getOrCreateUpstream();
  } catch {
    // Ignored: upstream not available yet, will retry on demand.
  }
  return (): void => {
    subscribers.delete(send);
  };
};

export const handleBunMessage = async (
  raw: string,
  send: Send,
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
