import type { ReactNode } from "react";
import { SidebarProjects } from "./SidebarProjects";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <SidebarProjects />
      <section className="workspace-surface">{children}</section>
    </div>
  );
}
