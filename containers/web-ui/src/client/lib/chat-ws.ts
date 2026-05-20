import type { ChatMessage, ServerToClient } from "../../shared/types.js";

export type ChatConnectionState = "connected" | "reconnecting" | "disconnected";

interface ChatWsOptions {
  readonly url: string;
  readonly onState: (state: ChatConnectionState) => void;
}

export interface ChatWsClient {
  connect(): void;
  close(): void;
  send(message: ChatMessage): void;
  /**
   * Register a server message handler. Returns an unsubscribe function —
   * call it from your useEffect cleanup so React StrictMode's double-mount
   * doesn't leave a duplicate handler behind that fires every message
   * twice.
   */
  onMessage(handler: (message: ServerToClient) => void): () => void;
}

const parseServerMessage = (raw: string): ServerToClient | undefined => {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (!("type" in parsed)) {
    return undefined;
  }

  const candidate = parsed;
  const typeValue = candidate.type;
  if (typeof typeValue !== "string") {
    return undefined;
  }

  if (typeValue === "ack") {
    const id = candidate.id;
    if (typeof id === "string") {
      return { type: "ack", id };
    }
  }

  if (typeValue === "error") {
    const message = candidate.message;
    if (typeof message === "string") {
      return { type: "error", message };
    }
  }

  if (
    typeValue === "status" &&
    (candidate.emulator === "connected" ||
      candidate.emulator === "disconnected") &&
    (candidate.stream === "live" ||
      candidate.stream === "connecting" ||
      candidate.stream === "disconnected") &&
    (candidate.agent === "running" ||
      candidate.agent === "idle" ||
      candidate.agent === "disconnected")
  ) {
    return {
      type: "status",
      emulator: candidate.emulator,
      stream: candidate.stream,
      agent: candidate.agent,
    };
  }

  if (
    typeValue === "agent-action" &&
    typeof candidate.id === "string" &&
    typeof candidate.timestamp === "number" &&
    (candidate.action === "button" ||
      candidate.action === "touch" ||
      candidate.action === "screenshot") &&
    typeof candidate.detail === "string"
  ) {
    return {
      type: "agent-action",
      id: candidate.id,
      timestamp: candidate.timestamp,
      action: candidate.action,
      detail: candidate.detail,
    };
  }

  if (
    typeValue === "agent-thinking" &&
    typeof candidate.id === "string" &&
    typeof candidate.timestamp === "number" &&
    typeof candidate.text === "string"
  ) {
    return {
      type: "agent-thinking",
      id: candidate.id,
      timestamp: candidate.timestamp,
      text: candidate.text,
    };
  }

  return undefined;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

export const createChatWsClient = (options: ChatWsOptions): ChatWsClient => {
  let socket: WebSocket | undefined;
  let closedManually = false;
  let reconnectAttempt = 0;
  let reconnectTimer: number | undefined;
  const handlers: ((message: ServerToClient) => void)[] = [];

  const clearTimer = (): void => {
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };

  const scheduleReconnect = (): void => {
    if (closedManually) {
      return;
    }
    reconnectAttempt += 1;
    const delay = Math.min(5_000, 200 * 2 ** reconnectAttempt);
    options.onState("reconnecting");
    reconnectTimer = window.setTimeout(() => {
      connectInternal();
    }, delay);
  };

  const connectInternal = (): void => {
    clearTimer();
    options.onState("reconnecting");
    socket = new WebSocket(options.url);
    socket.addEventListener("open", () => {
      reconnectAttempt = 0;
      options.onState("connected");
    });
    socket.addEventListener("close", () => {
      options.onState("disconnected");
      scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      options.onState("disconnected");
    });
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      const parsed = parseServerMessage(event.data);
      if (parsed === undefined) {
        return;
      }
      for (const handler of handlers) {
        handler(parsed);
      }
    });
  };

  return {
    connect() {
      closedManually = false;
      connectInternal();
    },

    close() {
      closedManually = true;
      clearTimer();
      if (socket !== undefined) {
        socket.close();
      }
      options.onState("disconnected");
    },

    send(message: ChatMessage) {
      if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(JSON.stringify(message));
    },

    onMessage(handler: (message: ServerToClient) => void) {
      handlers.push(handler);
      return () => {
        const idx = handlers.indexOf(handler);
        if (idx >= 0) {
          handlers.splice(idx, 1);
        }
      };
    },
  };
};
