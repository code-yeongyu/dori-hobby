import { useState } from "react";
import type { SystemStatus } from "../shared/types.js";
import { ChatPanel } from "./components/ChatPanel.js";
import { StatusBar } from "./components/StatusBar.js";
import { StreamViewer } from "./components/StreamViewer.js";

export const App = (): JSX.Element => {
  const [status, setStatus] = useState<SystemStatus>({
    type: "status",
    emulator: "disconnected",
    stream: "disconnected",
    agent: "disconnected",
  });

  return (
    <div className="app-grid">
      <main className="stream-cell">
        <StreamViewer
          onStreamStatus={(stream) => {
            setStatus((previous) => {
              return { ...previous, stream };
            });
          }}
        />
      </main>

      <aside className="chat-cell">
        <ChatPanel
          onAgentStatus={(agent) => {
            setStatus((previous) => {
              return { ...previous, agent };
            });
          }}
        />
      </aside>

      <footer className="status-cell">
        <StatusBar status={status} />
      </footer>
    </div>
  );
};
