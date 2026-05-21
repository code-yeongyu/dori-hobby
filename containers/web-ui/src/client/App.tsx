import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ChatMessage,
  ServerToClient,
  SystemStatus,
} from "../shared/types.js";
import { type ActivityEntry, ActivityLog } from "./components/ActivityLog.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { StreamViewer } from "./components/StreamViewer.js";
import { type ChatConnectionState, createChatWsClient } from "./lib/chat-ws.js";

type StreamState = "connecting" | "live" | "disconnected";

export interface ChatRow {
  readonly id: string;
  readonly text: string;
  readonly pending: boolean;
  readonly system: boolean;
}

export const App = (): JSX.Element => {
  const [status, setStatus] = useState<SystemStatus>({
    type: "status",
    emulator: "disconnected",
    stream: "disconnected",
    agent: "disconnected",
  });
  const [activity, setActivity] = useState<readonly ActivityEntry[]>([]);
  const [chatRows, setChatRows] = useState<readonly ChatRow[]>([]);
  const [connection, setConnection] =
    useState<ChatConnectionState>("disconnected");
  const [playtimeSeconds, setPlaytimeSeconds] = useState<number | undefined>(
    undefined,
  );

  // One WebSocket for the whole app. ChatPanel, ActivityLog, and the status
  // bar all consume from the same stream so we never duplicate connections.
  const client = useMemo(() => {
    return createChatWsClient({
      url: `ws://${window.location.host}/chat`,
      onState: setConnection,
    });
  }, []);

  useEffect(() => {
    const unsubscribe = client.onMessage((message) => {
      handleMessage(message, setChatRows, setActivity, setStatus);
    });
    client.connect();
    return () => {
      // Unsubscribe FIRST so StrictMode's second mount can't deliver
      // messages to a stale handler from the first mount.
      unsubscribe();
      client.close();
    };
  }, [client]);

  const handleStreamStatus = useCallback((stream: StreamState): void => {
    setStatus((previous) => {
      return { ...previous, stream };
    });
  }, []);

  // Poll the same-origin /emulator/health proxy so the status pill reflects
  // whether the input-bridge is actually answering (not just whether the WS
  // bridge to senpi is up).
  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch("/emulator/health", {
          signal: AbortSignal.timeout(2000),
        });
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setStatus((previous) => ({ ...previous, emulator: "disconnected" }));
          return;
        }
        const payload = (await response.json()) as { status?: string };
        const next: SystemStatus["emulator"] =
          payload.status === "connected" ? "connected" : "disconnected";
        setStatus((previous) =>
          previous.emulator === next
            ? previous
            : { ...previous, emulator: next },
        );
      } catch {
        if (!cancelled) {
          setStatus((previous) => ({ ...previous, emulator: "disconnected" }));
        }
      }
    };
    void tick();
    const interval = window.setInterval(tick, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      try {
        const response = await fetch("/api/playtime", {
          signal: AbortSignal.timeout(2000),
        });
        if (cancelled) {
          return;
        }
        if (!response.ok) {
          setPlaytimeSeconds(undefined);
          return;
        }
        const nextSeconds = readPlaytimeSeconds(await response.json());
        if (!cancelled) {
          setPlaytimeSeconds(nextSeconds);
        }
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
        if (!cancelled) {
          setPlaytimeSeconds(undefined);
        }
      }
    };
    void tick();
    const interval = window.setInterval(tick, 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // The chat WS being "connected" only proves the bridge is alive, NOT that
  // senpi is running. The agent badge stays `idle` until we see an actual
  // agent-action or agent-thinking message on the wire.
  useEffect(() => {
    setStatus((previous) => {
      if (connection !== "connected") {
        return { ...previous, agent: "disconnected" };
      }
      if (previous.agent === "running") {
        return previous;
      }
      return { ...previous, agent: "idle" };
    });
  }, [connection]);

  const sendChat = useCallback(
    (text: string): string | undefined => {
      const trimmed = text.trim();
      if (trimmed.length === 0) {
        return undefined;
      }
      const id = crypto.randomUUID();
      const message: ChatMessage = { type: "message", id, text: trimmed };
      setChatRows((previous) => [
        ...previous,
        { id, text: trimmed, pending: true, system: false },
      ]);
      client.send(message);
      return id;
    },
    [client],
  );

  return (
    <div className="app-grid">
      <main className="stream-cell">
        <StreamViewer onStreamStatus={handleStreamStatus} />
      </main>

      <aside className="activity-cell">
        <ActivityLog entries={activity} />
      </aside>

      <aside className="chat-cell">
        <ChatPanel connection={connection} rows={chatRows} onSend={sendChat} />
      </aside>

      <footer className="status-cell">
        <StatusBar status={status} playtimeSeconds={playtimeSeconds} />
      </footer>
    </div>
  );
};

const readPlaytimeSeconds = (payload: unknown): number | undefined => {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const totalSeconds = Reflect.get(payload, "total_seconds");
  return typeof totalSeconds === "number" && Number.isFinite(totalSeconds)
    ? totalSeconds
    : undefined;
};

const handleMessage = (
  message: ServerToClient,
  setChatRows: (
    update: (previous: readonly ChatRow[]) => readonly ChatRow[],
  ) => void,
  setActivity: (
    update: (previous: readonly ActivityEntry[]) => readonly ActivityEntry[],
  ) => void,
  setStatus: (update: (previous: SystemStatus) => SystemStatus) => void,
): void => {
  if (message.type === "ack") {
    setChatRows((previous) =>
      previous.map((row) =>
        row.id === message.id ? { ...row, pending: false } : row,
      ),
    );
    return;
  }

  if (message.type === "error") {
    setChatRows((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        text: message.message,
        pending: false,
        system: true,
      },
    ]);
    return;
  }

  if (message.type === "status") {
    setStatus(() => message);
    return;
  }

  if (message.type === "agent-action" || message.type === "agent-thinking") {
    setActivity((previous) => [...previous.slice(-499), message]);
    setStatus((previous) => ({ ...previous, agent: "running" }));
    return;
  }

  if (message.type === "agent-status") {
    setStatus((previous) => ({ ...previous, agent: message.state }));
  }
};
