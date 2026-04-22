import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Copy, Download, Pause, Play, Trash2 } from "lucide-react";
import { formatClock } from "../lib/time";
import type { LogEntry } from "../types/domain";

interface LiveLogViewerProps {
  logs: LogEntry[];
  paused: boolean;
  liveTail: boolean;
  onPausedChange: (paused: boolean) => void;
  onLiveTailChange: (liveTail: boolean) => void;
  onClear?: () => void;
  onExport?: () => void;
}

export function LiveLogViewer({ logs, paused, liveTail, onPausedChange, onLiveTailChange, onClear, onExport }: LiveLogViewerProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return logs
      .filter((log) => {
        if (seen.has(log.id)) return false;
        seen.add(log.id);
        return true;
      })
      .slice(-4000);
  }, [logs]);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 16
  });

  if (liveTail && !paused && parentRef.current) {
    window.requestAnimationFrame(() => parentRef.current?.scrollTo({ top: parentRef.current.scrollHeight }));
  }

  const copyVisible = async () => {
    const text = rows
      .slice(-200)
      .map((log) => `[${log.timestamp}] ${log.stream} ${log.level}: ${log.message}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
  };

  return (
    <section className="log-viewer">
      <header className="log-toolbar">
        <div>
          <p className="eyebrow">Live logs</p>
          <strong>{rows.length.toLocaleString()} lines</strong>
        </div>
        <div className="icon-toolbar">
          <button type="button" onClick={() => onPausedChange(!paused)} title={paused ? "Resume stream" : "Pause stream"}>
            {paused ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button className={liveTail ? "active" : ""} type="button" onClick={() => onLiveTailChange(!liveTail)} title="Toggle live tail">
            Tail
          </button>
          <button type="button" onClick={copyVisible} title="Copy visible log block">
            <Copy size={16} />
          </button>
          <button type="button" onClick={onExport} title="Export logs">
            <Download size={16} />
          </button>
          <button type="button" onClick={onClear} title="Clear local log view">
            <Trash2 size={16} />
          </button>
        </div>
      </header>
      <div ref={parentRef} className="log-scroll">
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const log = rows[virtualRow.index];
            return (
              <div
                key={log.id}
                className={`log-line ${log.level}`}
                style={{ transform: `translateY(${virtualRow.start}px)`, position: "absolute", top: 0, left: 0, width: "100%" }}
              >
                <span className="log-time">{formatClock(log.timestamp)}</span>
                <span className={`log-stream ${log.stream}`}>{log.stream}</span>
                <span className="log-message">{log.message}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
