import type { HealthStatus, ProcessRuntimeState, ProcessStatus, ProjectStatus } from "../types/domain";

export const RUNNING_STATUSES = new Set<ProcessStatus>(["starting", "running"]);
export const FAILED_STATUSES = new Set<ProcessStatus>(["failed", "crashed", "blocked", "waiting_dependency"]);

export function deriveProjectStatus(states: ProcessRuntimeState[]): ProjectStatus {
  if (states.length === 0) return "stopped";

  const statuses = states.map((state) => state.currentStatus);
  const running = statuses.filter((status) => status === "running").length;
  const starting = statuses.some((status) => status === "starting" || status === "queued");
  const failed = statuses.filter((status) => FAILED_STATUSES.has(status)).length;
  const stopped = statuses.filter((status) => status === "stopped" || status === "idle").length;

  if (failed === statuses.length) return "failed";
  if (failed > 0) return "degraded";
  if (starting) return "starting";
  if (running === statuses.length) return "running";
  if (stopped === statuses.length) return "stopped";
  return "partial";
}

export function statusLabel(status: ProcessStatus | ProjectStatus | HealthStatus): string {
  return status.replace("_", " ");
}

export function statusTone(status: ProcessStatus | ProjectStatus | HealthStatus): "neutral" | "good" | "warn" | "bad" | "busy" {
  switch (status) {
    case "running":
    case "healthy":
      return "good";
    case "starting":
    case "queued":
    case "stopping":
      return "busy";
    case "degraded":
    case "partial":
    case "waiting_dependency":
    case "blocked":
      return "warn";
    case "failed":
    case "crashed":
    case "unhealthy":
      return "bad";
    default:
      return "neutral";
  }
}

export function isRuntimeBusy(status?: ProcessStatus): boolean {
  return status === "starting" || status === "stopping" || status === "queued";
}
