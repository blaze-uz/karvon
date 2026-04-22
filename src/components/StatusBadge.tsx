import type { HealthStatus, ProcessStatus, ProjectStatus } from "../types/domain";
import { statusLabel, statusTone } from "../lib/status";

type Status = ProcessStatus | ProjectStatus | HealthStatus;

export function StatusBadge({ status }: { status: Status }) {
  const tone = statusTone(status);
  return <span className={`status-badge ${tone}`}>{statusLabel(status)}</span>;
}
