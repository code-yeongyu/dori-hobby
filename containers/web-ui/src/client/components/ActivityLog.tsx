import { useEffect, useMemo, useRef } from "react";
import type { AgentAction, AgentThinking } from "../../shared/types.js";

export type ActivityEntry = AgentAction | AgentThinking;

interface ActivityLogProps {
  readonly entries: readonly ActivityEntry[];
}

const ACTION_PREFIX: Record<AgentAction["action"], string> = {
  button: "Press",
  touch: "Touch",
  screenshot: "Capture",
};

const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
};

export const ActivityLog = ({ entries }: ActivityLogProps): JSX.Element => {
  const listRef = useRef<HTMLOListElement | null>(null);
  const visible = useMemo(() => entries.slice(-200), [entries]);

  // Auto-scroll to the latest entry whenever the entry list grows.
  // biome-ignore lint/correctness/useExhaustiveDependencies: ref-based scroll, runs after each entries update by design.
  useEffect(() => {
    const list = listRef.current;
    if (list === null) {
      return;
    }
    list.scrollTop = list.scrollHeight;
  }, [entries]);

  return (
    <section className="activity-log" aria-label="Agent activity log">
      <header className="activity-log-header">
        <strong>Activity</strong>
        <span className="activity-log-count">{visible.length} entries</span>
      </header>

      {visible.length === 0 ? (
        <div className="activity-log-empty">
          <span>Waiting for the agent to start...</span>
        </div>
      ) : (
        <ol className="activity-log-list" ref={listRef}>
          {visible.map((entry) => {
            if (entry.type === "agent-action") {
              return (
                <li key={entry.id} className="activity-row activity-action">
                  <span className="activity-time">
                    {formatTime(entry.timestamp)}
                  </span>
                  <span className={`activity-badge action-${entry.action}`}>
                    {ACTION_PREFIX[entry.action]}
                  </span>
                  <span className="activity-detail">{entry.detail}</span>
                </li>
              );
            }
            return (
              <li key={entry.id} className="activity-row activity-thinking">
                <span className="activity-time">
                  {formatTime(entry.timestamp)}
                </span>
                <span className="activity-badge thinking">Think</span>
                <span className="activity-thinking-text">{entry.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
