import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatRow } from "../App.js";
import type { ChatConnectionState } from "../lib/chat-ws.js";

interface ChatPanelProps {
  readonly connection: ChatConnectionState;
  readonly rows: readonly ChatRow[];
  readonly onSend: (text: string) => string | undefined;
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

const connectionLabel = (state: ChatConnectionState): string => {
  if (state === "connected") {
    return "Connected";
  }
  if (state === "reconnecting") {
    return "Reconnecting";
  }
  return "Disconnected";
};

export const ChatPanel = ({
  connection,
  rows,
  onSend,
}: ChatPanelProps): JSX.Element => {
  const [value, setValue] = useState<string>("");
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowCount = rows.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: ref-based scroll, runs after each rows update by design.
  useEffect(() => {
    const list = listRef.current;
    if (list !== null) {
      list.scrollTop = list.scrollHeight;
    }
  }, [rowCount]);

  const statusText = useMemo(() => connectionLabel(connection), [connection]);

  const submit = (): void => {
    const id = onSend(value);
    if (id !== undefined) {
      setValue("");
    }
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
        {rows.map((row) => (
          <li
            key={row.id}
            className={`chat-item${row.system ? " chat-system" : ""}`}
          >
            <span>{row.text}</span>
            {!row.system ? (
              <small>{row.pending ? "pending" : "ack"}</small>
            ) : null}
          </li>
        ))}
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
              submit();
            }
          }}
          placeholder="Nudge Dori..."
          aria-label="Chat input"
        />
        <button type="button" className="btn btn-accent" onClick={submit}>
          Send
        </button>
      </div>
    </section>
  );
};
