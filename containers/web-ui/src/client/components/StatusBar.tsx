import type { SystemStatus } from "../../shared/types.js";
import { formatPlaytime } from "../lib/playtime-format.js";

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
  playtimeSeconds,
  status,
}: {
  playtimeSeconds: number | undefined;
  status: SystemStatus;
}): JSX.Element => {
  const playtimeValue =
    playtimeSeconds === undefined ? "--" : formatPlaytime(playtimeSeconds);
  return (
    <div className="status-bar" role="status" aria-live="polite">
      <Pill label="Emulator" value={status.emulator} />
      <Pill label="Stream" value={status.stream} />
      <Pill label="Agent" value={status.agent} />
      <Pill
        label="Playtime"
        value={playtimeValue}
        indicatorColor="var(--accent)"
        preserveValueCase={true}
      />
    </div>
  );
};

const Pill = ({
  indicatorColor,
  label,
  preserveValueCase = false,
  value,
}: {
  indicatorColor?: string;
  label: string;
  preserveValueCase?: boolean;
  value: string;
}): JSX.Element => {
  const valueStyle = preserveValueCase
    ? { textTransform: "none", fontVariantNumeric: "tabular-nums" }
    : undefined;
  return (
    <div className="pill">
      <span
        className="pill-dot"
        style={{ background: indicatorColor ?? dotColor(value) }}
      />
      <span className="pill-label">{label}</span>
      <span className="pill-value" style={valueStyle}>
        {value}
      </span>
    </div>
  );
};
