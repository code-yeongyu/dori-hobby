import type { SystemStatus } from "../../shared/types.js";

const dotColor = (state: string): string => {
  if (state === "connected" || state === "live" || state === "running") {
    return "var(--accent-success)";
  }
  if (state === "connecting" || state === "idle") {
    return "var(--accent-warn)";
  }
  return "var(--accent-error)";
};

export const StatusBar = ({
  status,
}: {
  status: SystemStatus;
}): JSX.Element => {
  return (
    <div className="status-bar" role="status" aria-live="polite">
      <Pill label="Emulator" value={status.emulator} />
      <Pill label="Stream" value={status.stream} />
      <Pill label="Agent" value={status.agent} />
    </div>
  );
};

const Pill = ({
  label,
  value,
}: {
  label: string;
  value: string;
}): JSX.Element => {
  return (
    <div className="pill">
      <span className="pill-dot" style={{ background: dotColor(value) }} />
      <span className="pill-label">{label}</span>
      <span className="pill-value">{value}</span>
    </div>
  );
};
