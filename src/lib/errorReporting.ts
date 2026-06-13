import { invoke } from "@tauri-apps/api/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const RECENT_ERROR_LIMIT = 50;
const recentErrors: FrontendErrorRecord[] = [];

export interface FrontendErrorRecord {
  source: string;
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: string;
  url?: string;
}

interface ReportErrorContext {
  componentStack?: string | null;
  url?: string;
}

export function reportError(source: string, error: unknown, context: ReportErrorContext = {}): void {
  const record = buildRecord(source, error, context);
  pushRecent(record);
  // eslint-disable-next-line no-console
  console.error(`[${source}]`, error);
  if (!isTauri) return;
  void invoke("log_frontend_error", { record }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("Failed to forward frontend error to backend:", err);
  });
}

export function getRecentFrontendErrors(): FrontendErrorRecord[] {
  return recentErrors.slice();
}

export function installGlobalErrorHandlers(): void {
  if (typeof window === "undefined") return;
  window.addEventListener("error", (event) => {
    reportError("window-error", event.error ?? event.message, { url: event.filename });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportError("unhandled-rejection", event.reason);
  });
}

function buildRecord(source: string, error: unknown, context: ReportErrorContext): FrontendErrorRecord {
  let message = "";
  let stack: string | undefined;
  if (error instanceof Error) {
    message = error.message;
    stack = error.stack;
  } else if (typeof error === "string") {
    message = error;
  } else if (error && typeof error === "object") {
    try {
      message = JSON.stringify(error);
    } catch {
      message = String(error);
    }
  } else {
    message = String(error);
  }
  return {
    source,
    message: message || "Unknown error",
    stack,
    componentStack: context.componentStack ?? undefined,
    timestamp: new Date().toISOString(),
    url: context.url ?? (typeof window !== "undefined" ? window.location?.href : undefined)
  };
}

function pushRecent(record: FrontendErrorRecord) {
  recentErrors.push(record);
  if (recentErrors.length > RECENT_ERROR_LIMIT) {
    recentErrors.splice(0, recentErrors.length - RECENT_ERROR_LIMIT);
  }
}
