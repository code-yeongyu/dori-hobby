import { useCallback, useState } from "react";
import type { SystemStatus } from "../shared/types.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { StreamViewer } from "./components/StreamViewer.js";

type StreamState = "connecting" | "live" | "disconnected";
type AgentState = "running" | "idle" | "disconnected";

export const App = (): JSX.Element => {
  const [status, setStatus] = useState<SystemStatus>({
    type: "status",
    emulator: "disconnected",
    stream: "disconnected",
    agent: "disconnected",
  });

  const handleStreamStatus = useCallback((stream: StreamState): void => {
    setStatus((previous) => {
      return { ...previous, stream };
    });
  }, []);

  const handleAgentStatus = useCallback((agent: AgentState): void => {
    setStatus((previous) => {
      return { ...previous, agent };
    });
  }, []);

  return (
    <div className="app-grid">
      <main className="stream-cell">
        <StreamViewer onStreamStatus={handleStreamStatus} />
      </main>

      <aside className="chat-cell">
        <ChatPanel onAgentStatus={handleAgentStatus} />
      </aside>

      <footer className="status-cell">
        <StatusBar status={status} />
      </footer>
    </div>
  );
};
