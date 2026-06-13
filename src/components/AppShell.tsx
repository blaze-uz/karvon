import type { CSSProperties, KeyboardEvent, PointerEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { SidebarProjects } from "./SidebarProjects";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 242;
const SIDEBAR_WIDTH_STORAGE_KEY = "karvon:sidebar-width";

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState(() => readStoredSidebarWidth());
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent | globalThis.PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(event.clientX));
    };

    const stopResizing = () => {
      setIsResizing(false);
    };

    document.body.classList.add("is-resizing-sidebar");
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      document.body.classList.remove("is-resizing-sidebar");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizing]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const startResizing = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizing(true);
    setSidebarWidth(clampSidebarWidth(event.clientX));
  };

  const resizeFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    setSidebarWidth((currentWidth) => {
      if (event.key === "Home") return SIDEBAR_MIN_WIDTH;
      if (event.key === "End") return SIDEBAR_MAX_WIDTH;

      const direction = event.key === "ArrowRight" ? 1 : -1;
      const step = event.shiftKey ? 32 : 16;
      return clampSidebarWidth(currentWidth + direction * step);
    });
  };

  return (
    <div className="app-shell" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <SidebarProjects />
      <div
        className={`sidebar-resize-handle ${isResizing ? "active" : ""}`}
        role="separator"
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={startResizing}
        onKeyDown={resizeFromKeyboard}
      />
      <section className="workspace-surface">{children}</section>
    </div>
  );
}

function clampSidebarWidth(width: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readStoredSidebarWidth() {
  const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  return Number.isFinite(storedWidth) ? clampSidebarWidth(storedWidth) : SIDEBAR_DEFAULT_WIDTH;
}
