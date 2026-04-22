import { useEffect } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { AppShell } from "./components/AppShell";
import { CommandPalette } from "./components/CommandPalette";
import { DashboardOverview } from "./features/dashboard/DashboardOverview";
import { LogsView } from "./features/logs/LogsView";
import { ProcessDetailPanel } from "./features/processes/ProcessDetailPanel";
import { ProjectDetailView } from "./features/projects/ProjectDetailView";
import { ProjectsView } from "./features/projects/ProjectsView";
import { SettingsView } from "./features/settings/SettingsView";
import { useOrchestratorStore } from "./stores/orchestratorStore";

function App() {
  const booted = useOrchestratorStore((state) => state.booted);
  const initialize = useOrchestratorStore((state) => state.initialize);
  const view = useOrchestratorStore((state) => state.view);
  const currentAction = useOrchestratorStore((state) => state.currentAction);
  const lastError = useOrchestratorStore((state) => state.lastError);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const content = {
    dashboard: <DashboardOverview />,
    projects: <ProjectsView />,
    project: <ProjectDetailView />,
    process: <ProcessDetailPanel />,
    logs: <LogsView />,
    settings: <SettingsView />
  }[view];

  return (
    <AppShell>
      {!booted ? (
        <main className="empty-state">
          <Loader2 className="spin" size={24} />
          <span>Loading local workspace</span>
        </main>
      ) : (
        content
      )}

      <CommandPalette />

      {currentAction ? (
        <div className="action-toast">
          <Loader2 className="spin" size={16} />
          <span>{currentAction.label}</span>
        </div>
      ) : null}

      {lastError ? (
        <div className="error-toast">
          <AlertTriangle size={16} />
          <span>{lastError}</span>
        </div>
      ) : null}
    </AppShell>
  );
}

export default App;
