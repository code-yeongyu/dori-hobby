import type { Dispatch, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage, ServerToClient } from "../../shared/types.js";
import {
  type ChatConnectionState,
  createChatWsClient,
} from "../lib/chat-ws.js";

type AgentState = "running" | "idle" | "disconnected";

interface ChatPanelProps {
  readonly onAgentStatus: (state: AgentState) => void;
}

interface ChatRow {
  readonly id: string;
  readonly text: string;
  readonly pending: boolean;
  readonly system: boolean;
}

const connectionColor = (state: ChatConnectionState): string => {
  if (state === "connected") {
    return "var(--accent-success)";
  }
  if (state === "reconnecting") {
    return "var(--accent-warn)";
  }
  return "var(--accent-error)";
};

export const ChatPanel = ({ onAgentStatus }: ChatPanelProps): JSX.Element => {
  const [connection, setConnection] =
    useState<ChatConnectionState>("disconnected");
  const [rows, setRows] = useState<readonly ChatRow[]>([]);
  const [value, setValue] = useState<string>("");
  const listRef = useRef<HTMLUListElement | null>(null);
  const clientRef = useRef<ReturnType<typeof createChatWsClient> | null>(null);

  useEffect(() => {
    const client = createChatWsClient({
      url: `ws://${window.location.host}/chat`,
      onState: (state) => {
        setConnection(state);
        onAgentStatus(state === "connected" ? "running" : "disconnected");
      },
    });
    clientRef.current = client;
    client.onMessage((message) => {
      handleMessage(message, setRows, onAgentStatus);
    });
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [onAgentStatus]);

  useEffect(() => {
    const list = listRef.current;
    if (list !== null && rows.length >= 0) {
      list.scrollTop = list.scrollHeight;
    }
  }, [rows.length]);

  const statusText = useMemo(() => {
    if (connection === "connected") {
      return "Connected";
    }
    if (connection === "reconnecting") {
      return "Reconnecting";
    }
    return "Disconnected";
  }, [connection]);

  const send = (): void => {
    const text = value.trim();
    if (text.length === 0 || clientRef.current === null) {
      return;
    }
    const id = crypto.randomUUID();
    const message: ChatMessage = {
      type: "message",
      id,
      text,
    };
    setRows((previous) => {
      return [...previous, { id, text, pending: true, system: false }];
    });
    clientRef.current.send(message);
    setValue("");
  };

  return (
    <section className="chat-panel" aria-label="Chat panel">
      <header className="chat-header">
        <strong>Chat</strong>
        <span>
          <span
            className="status-dot"
            style={{ background: connectionColor(connection) }}
          />{" "}
          {statusText}
        </span>
      </header>

      <ul className="chat-list" ref={listRef}>
        {rows.map((row) => {
          return (
            <li
              key={row.id}
              className={`chat-item${row.system ? " chat-system" : ""}`}
            >
              <span>{row.text}</span>
              {!row.system ? (
                <small>{row.pending ? "pending" : "ack"}</small>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="chat-form">
        <input
          className="chat-input"
          type="text"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              send();
            }
          }}
          aria-label="Chat input"
        />
        <button type="button" className="btn btn-accent" onClick={send}>
          Send
        </button>
      </div>
    </section>
  );
};

const handleMessage = (
  message: ServerToClient,
  setRows: Dispatch<SetStateAction<readonly ChatRow[]>>,
  onAgentStatus: (state: AgentState) => void,
): void => {
  if (message.type === "ack") {
    setRows((previous) => {
      return previous.map((row) => {
        if (row.id !== message.id) {
          return row;
        }
        return { ...row, pending: false };
      });
    });
    return;
  }

  if (message.type === "error") {
    setRows((previous) => {
      return [
        ...previous,
        {
          id: crypto.randomUUID(),
          text: message.message,
          pending: false,
          system: true,
        },
      ];
    });
    return;
  }

  onAgentStatus(message.agent === "running" ? "running" : "idle");
};
