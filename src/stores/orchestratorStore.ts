import { create } from "zustand";
import { api, ApiCallError, unwrap } from "../lib/api";
import { reportError } from "../lib/errorReporting";
import { notify } from "../lib/notifications";
import { deriveProjectStatus } from "../lib/status";
import type {
  ActivityEvent,
  AppConfig,
  AppSettings,
  DashboardSummary,
  DeployRunState,
  DeployScript,
  DeployScriptFormInput,
  ExternalProcess,
  ID,
  LogEntry,
  LogFilters,
  Machine,
  MachineConnectionResult,
  MachineFormInput,
  MetricSample,
  ProcessDefinition,
  ProcessFormInput,
  ProcessRuntimeState,
  Project,
  ProjectFilters,
  ProjectFormInput,
  ViewKey,
  Workspace
} from "../types/domain";

interface ActionState {
  key: string;
  label: string;
}

export interface OrchestratorError {
  message: string;
  code?: string;
  details?: string;
  retryable?: boolean;
}

interface AutoDeployTriggeredPayload {
  projectId: ID;
  projectName: string;
  branch: string;
  commitSha: string;
  commitShaShort: string;
}

function toOrchestratorError(error: unknown): OrchestratorError {
  if (error instanceof ApiCallError) {
    return { message: error.message, code: error.code, details: error.details, retryable: error.retryable };
  }
  return { message: error instanceof Error ? error.message : String(error) };
}

interface OrchestratorState {
  booted: boolean;
  view: ViewKey;
  workspaces: Workspace[];
  machines: Machine[];
  machineConnectionResults: Record<ID, MachineConnectionResult>;
  projects: Project[];
  processes: ProcessDefinition[];
  runtimeStates: Record<ID, ProcessRuntimeState>;
  externalProcesses: Record<ID, ExternalProcess[]>;
  deployScripts: Record<ID, DeployScript[]>;
  deployStates: Record<ID, DeployRunState>;
  logs: LogEntry[];
  activity: ActivityEvent[];
  metricsHistory: Record<ID, MetricSample[]>;
  settings?: AppSettings;
  selectedWorkspaceId?: ID;
  selectedProjectId?: ID;
  selectedProcessId?: ID;
  projectFilters: ProjectFilters;
  logFilters: LogFilters;
  dashboard?: DashboardSummary;
  currentAction?: ActionState;
  lastError?: OrchestratorError;
  dismissError: () => void;
  createMachine: (input: MachineFormInput) => Promise<boolean>;
  updateMachine: (machine: Machine) => Promise<void>;
  deleteMachine: (machineId: ID) => Promise<void>;
  testMachineConnection: (machineId: ID) => Promise<MachineConnectionResult | undefined>;
  initialize: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshDashboard: () => Promise<void>;
  loadMetricsHistory: (processId: ID) => Promise<void>;
  selectView: (view: ViewKey) => void;
  selectProject: (projectId: ID) => Promise<void>;
  selectProcess: (processId: ID) => void;
  createProject: (input: ProjectFormInput) => Promise<void>;
  updateProject: (project: Project) => Promise<void>;
  deleteProject: (projectId: ID) => Promise<void>;
  createProcess: (input: ProcessFormInput) => Promise<boolean>;
  updateProcess: (process: ProcessDefinition) => Promise<void>;
  deleteProcess: (processId: ID) => Promise<void>;
  startProcess: (processId: ID) => Promise<void>;
  stopProcess: (processId: ID) => Promise<void>;
  restartProcess: (processId: ID) => Promise<void>;
  startProject: (projectId: ID) => Promise<void>;
  startAutoStartProcesses: (projectId: ID) => Promise<void>;
  stopProject: (projectId: ID) => Promise<void>;
  restartProject: (projectId: ID) => Promise<void>;
  restartFailed: (projectId?: ID) => Promise<void>;
  loadExternalProcesses: (projectId: ID) => Promise<void>;
  stopExternalProcess: (projectId: ID, processGroupId: number) => Promise<void>;
  runHealthCheck: (processId: ID) => Promise<void>;
  clearLogs: (projectId?: ID) => Promise<void>;
  applyMediaGuardPreset: (basePath?: string) => Promise<boolean>;
  importConfig: (config: AppConfig) => Promise<void>;
  exportConfig: (redactSecrets?: boolean) => Promise<string>;
  exportConfigToPath: (path: string, redactSecrets?: boolean) => Promise<string>;
  exportLogs: () => Promise<string>;
  updateSettings: (settings: AppSettings) => Promise<void>;
  setProjectFilters: (filters: Partial<ProjectFilters>) => void;
  setLogFilters: (filters: Partial<LogFilters>) => void;
  loadDeployScripts: (projectId: ID) => Promise<void>;
  createDeployScript: (input: DeployScriptFormInput) => Promise<boolean>;
  updateDeployScript: (script: DeployScript) => Promise<void>;
  deleteDeployScript: (scriptId: ID, projectId: ID) => Promise<void>;
  reorderDeployScripts: (projectId: ID, orderedIds: ID[]) => Promise<void>;
  deployProject: (projectId: ID) => Promise<void>;
  cancelDeploy: (projectId: ID) => Promise<void>;
}

const defaultProjectFilters: ProjectFilters = {
  query: "",
  runningOnly: false,
  failedOnly: false,
  autoStartOnly: false
};

const defaultLogFilters: LogFilters = {
  query: "",
  stream: "all",
  level: "all",
  liveTail: true,
  paused: false
};
const LOG_HISTORY_WINDOW_MS = 5 * 60 * 1000;
const METRICS_HISTORY_WINDOW_MS = 10 * 60 * 1000;
const METRICS_HISTORY_HARD_CAP = 400;

function recentLogHistorySince() {
  return new Date(Date.now() - LOG_HISTORY_WINDOW_MS).toISOString();
}

let dashboardRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDashboardRefresh(refresh: () => Promise<void>) {
  if (dashboardRefreshTimer) return;
  dashboardRefreshTimer = setTimeout(() => {
    dashboardRefreshTimer = null;
    void refresh();
  }, 300);
}

function appendMetricsSample(
  history: Record<ID, MetricSample[]>,
  runtime: ProcessRuntimeState
): Record<ID, MetricSample[]> {
  if (typeof runtime.cpuUsage !== "number" && typeof runtime.memoryUsage !== "number") return history;
  const cutoffMs = Date.now() - METRICS_HISTORY_WINDOW_MS;
  const prev = history[runtime.processId] ?? [];
  const sample: MetricSample = {
    timestamp: new Date().toISOString(),
    cpuUsage: runtime.cpuUsage,
    memoryUsage: runtime.memoryUsage
  };
  let startIdx = 0;
  while (startIdx < prev.length && Date.parse(prev[startIdx].timestamp) < cutoffMs) startIdx += 1;
  const trimmed = startIdx === 0 ? prev : prev.slice(startIdx);
  const next = trimmed.length + 1 > METRICS_HISTORY_HARD_CAP
    ? [...trimmed.slice(trimmed.length + 1 - METRICS_HISTORY_HARD_CAP), sample]
    : [...trimmed, sample];
  return { ...history, [runtime.processId]: next };
}

function mergeRuntime(states: ProcessRuntimeState[]) {
  return states.reduce<Record<ID, ProcessRuntimeState>>((acc, state) => {
    acc[state.processId] = state;
    return acc;
  }, {});
}

function mergeProcesses(existing: ProcessDefinition[], incoming: ProcessDefinition[]) {
  const merged = new Map(existing.map((process) => [process.id, process]));
  for (const process of incoming) merged.set(process.id, process);
  return Array.from(merged.values());
}

async function safeAction<T>(set: (partial: Partial<OrchestratorState>) => void, action: ActionState, task: () => Promise<T>): Promise<T | undefined> {
  try {
    set({ currentAction: action, lastError: undefined });
    return await task();
  } catch (error) {
    set({ lastError: toOrchestratorError(error) });
    return undefined;
  } finally {
    set({ currentAction: undefined });
  }
}

function safeListener<T>(eventName: string, handler: (payload: T) => void) {
  return (payload: T) => {
    try {
      handler(payload);
    } catch (error) {
      reportError(`listener:${eventName}`, error);
    }
  };
}

function appendLogs(state: OrchestratorState, incoming: LogEntry[]): LogEntry[] {
  if (incoming.length === 0) return state.logs;
  const retention = state.settings?.logRetentionLines ?? 5000;
  const seen = new Set(state.logs.map((entry) => entry.id));
  const merged = state.logs.slice();
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push(entry);
  }
  if (merged.length > retention) merged.splice(0, merged.length - retention);
  return merged;
}

export const useOrchestratorStore = create<OrchestratorState>((set, get) => ({
  booted: false,
  view: "dashboard",
  workspaces: [],
  machines: [],
  machineConnectionResults: {},
  projects: [],
  processes: [],
  runtimeStates: {},
  externalProcesses: {},
  deployScripts: {},
  deployStates: {},
  logs: [],
  activity: [],
  metricsHistory: {},
  projectFilters: defaultProjectFilters,
  logFilters: defaultLogFilters,
  initialize: async () => {
    if (get().booted) return;
    api.on<LogEntry>(
      "process_log",
      safeListener<LogEntry>("process_log", (log) => {
        if (!log?.id) return;
        if (get().logFilters.paused) return;
        set((state) => ({ logs: appendLogs(state, [log]) }));
      })
    );
    api.on<LogEntry[]>(
      "process_log_batch",
      safeListener<LogEntry[]>("process_log_batch", (batch) => {
        if (!Array.isArray(batch) || batch.length === 0) return;
        if (get().logFilters.paused) return;
        const filtered = batch.filter((entry): entry is LogEntry => Boolean(entry && entry.id));
        if (filtered.length === 0) return;
        set((state) => ({ logs: appendLogs(state, filtered) }));
      })
    );
    const updateRuntime = (runtime: ProcessRuntimeState) => {
      if (!runtime?.processId) return;
      set((state) => ({ runtimeStates: { ...state.runtimeStates, [runtime.processId]: runtime } }));
      scheduleDashboardRefresh(get().refreshDashboard);
    };
    api.on<ProcessRuntimeState>("process_started", safeListener("process_started", updateRuntime));
    api.on<ProcessRuntimeState>("process_stopped", safeListener("process_stopped", updateRuntime));
    api.on<ProcessRuntimeState>("process_failed", safeListener("process_failed", updateRuntime));
    api.on<ProcessRuntimeState>(
      "process_health_changed",
      safeListener("process_health_changed", updateRuntime)
    );
    api.on<ProcessRuntimeState>(
      "process_metrics_changed",
      safeListener<ProcessRuntimeState>("process_metrics_changed", (runtime) => {
        if (!runtime?.processId) return;
        set((state) => ({
          runtimeStates: { ...state.runtimeStates, [runtime.processId]: runtime },
          metricsHistory: appendMetricsSample(state.metricsHistory, runtime)
        }));
      })
    );
    api.on<DeployRunState>(
      "deploy_state_changed",
      safeListener<DeployRunState>("deploy_state_changed", (run) => {
        if (!run?.projectId) return;
        set((state) => ({ deployStates: { ...state.deployStates, [run.projectId]: run } }));
      })
    );
    api.on<AutoDeployTriggeredPayload>(
      "auto_deploy_triggered",
      safeListener<AutoDeployTriggeredPayload>("auto_deploy_triggered", (payload) => {
        if (!payload?.projectId) return;
        if (!get().settings?.notificationsEnabled) return;
        notify(
          `Auto-deploying ${payload.projectName}`,
          `New commit ${payload.commitShaShort} on ${payload.branch}`
        );
      })
    );
    await get().refreshAll();
    set({ booted: true });
  },
  refreshAll: async () => {
    await safeAction(set, { key: "refresh", label: "Refreshing workspace" }, async () => {
      const [config, workspaces, machines, projects, runtimes, logs, dashboard, deployStates] = await Promise.all([
        api.getConfig().then(unwrap),
        api.listWorkspaces().then(unwrap),
        api.listMachines().then(unwrap),
        api.listProjects().then(unwrap),
        api.getAllRuntimeStates().then(unwrap),
        api.getLogHistory({ limit: 1000, since: recentLogHistorySince() }).then(unwrap),
        api.getDashboardSummary().then(unwrap),
        api.getAllDeployStates().then(unwrap)
      ]);
      const selectedProjectId = config.lastSelectedProjectId ?? projects[0]?.id;
      const deployScripts: Record<ID, DeployScript[]> = {};
      for (const script of config.deployScripts ?? []) {
        const bucket = deployScripts[script.projectId] ?? (deployScripts[script.projectId] = []);
        bucket.push(script);
      }
      set({
        workspaces,
        machines,
        projects,
        processes: config.processes,
        runtimeStates: mergeRuntime(runtimes),
        deployScripts,
        deployStates: deployStates.reduce<Record<ID, DeployRunState>>((acc, run) => {
          acc[run.projectId] = run;
          return acc;
        }, {}),
        logs,
        activity: config.activity,
        settings: config.settings,
        selectedWorkspaceId: config.workspaces.find((workspace) => workspace.isDefault)?.id ?? workspaces[0]?.id,
        selectedProjectId,
        selectedProcessId: config.lastSelectedProcessId,
        dashboard,
        view: selectedProjectId ? get().view : "dashboard"
      });
    });
  },
  refreshDashboard: async () => {
    try {
      set({ dashboard: await api.getDashboardSummary().then(unwrap) });
    } catch {
      // Dashboard updates are secondary to runtime actions.
    }
  },
  loadMetricsHistory: async (processId) => {
    try {
      const samples = await api.getProcessMetricsHistory(processId).then(unwrap);
      set((state) => ({ metricsHistory: { ...state.metricsHistory, [processId]: samples } }));
    } catch {
      // Metrics history is best-effort; do not surface as a global error.
    }
  },
  selectView: (view) => set({ view }),
  selectProject: async (projectId) => {
    await safeAction(set, { key: `select:${projectId}`, label: "Loading project" }, async () => {
      const detail = await api.getProjectDetail(projectId).then(unwrap);
      set((state) => ({
        selectedProjectId: projectId,
        selectedProcessId: detail.processes[0]?.id,
        processes: mergeProcesses(state.processes, detail.processes),
        runtimeStates: { ...state.runtimeStates, ...mergeRuntime(detail.runtimeStates) },
        view: "project"
      }));
    });
    void get().loadExternalProcesses(projectId);
  },
  selectProcess: (processId) => set({ selectedProcessId: processId, view: "process" }),
  createProject: async (input) => {
    await safeAction(set, { key: "create-project", label: "Creating project" }, async () => {
      const project = await api.createProject(input).then(unwrap);
      set((state) => ({ projects: [...state.projects, project], selectedProjectId: project.id, view: "project" }));
      await get().selectProject(project.id);
      await get().refreshDashboard();
    });
  },
  updateProject: async (project) => {
    await safeAction(set, { key: `update-project:${project.id}`, label: "Saving project" }, async () => {
      const saved = await api.updateProject(project).then(unwrap);
      set((state) => ({ projects: state.projects.map((item) => (item.id === saved.id ? saved : item)) }));
    });
  },
  deleteProject: async (projectId) => {
    await safeAction(set, { key: `delete-project:${projectId}`, label: "Deleting project" }, async () => {
      try {
        await api.stopProject(projectId).then(unwrap);
      } catch {
        // Deletion should still be possible if nothing is running or stop already failed.
      }
      await api.deleteProject(projectId).then(unwrap);
      const projects = get().projects.filter((project) => project.id !== projectId);
      set((state) => ({
        projects,
        processes: state.processes.filter((process) => process.projectId !== projectId),
        selectedProjectId: projects[0]?.id,
        selectedProcessId: undefined,
        view: projects[0] ? "project" : "dashboard"
      }));
      if (projects[0]) await get().selectProject(projects[0].id);
      await get().refreshDashboard();
    });
  },
  createProcess: async (input) => {
    const created = await safeAction(set, { key: "create-process", label: "Creating process" }, async () => {
      const process = await api.createProcessDefinition(input).then(unwrap);
      set((state) => ({ processes: [...state.processes, process], selectedProcessId: process.id }));
      await get().selectProject(input.projectId);
      return true;
    });
    return Boolean(created);
  },
  updateProcess: async (process) => {
    await safeAction(set, { key: `update-process:${process.id}`, label: "Saving process" }, async () => {
      const saved = await api.updateProcessDefinition(process).then(unwrap);
      set((state) => ({ processes: state.processes.map((item) => (item.id === saved.id ? saved : item)) }));
    });
  },
  deleteProcess: async (processId) => {
    await safeAction(set, { key: `delete-process:${processId}`, label: "Deleting process" }, async () => {
      await api.deleteProcessDefinition(processId).then(unwrap);
      set((state) => {
        const processes = state.processes.filter((process) => process.id !== processId);
        return { processes, selectedProcessId: processes[0]?.id };
      });
    });
  },
  startProcess: async (processId) => {
    await safeAction(set, { key: `start:${processId}`, label: "Starting process" }, async () => {
      const runtime = await api.startProcess(processId).then(unwrap);
      set((state) => ({ runtimeStates: { ...state.runtimeStates, [runtime.processId]: runtime } }));
      await get().refreshDashboard();
    });
  },
  stopProcess: async (processId) => {
    await safeAction(set, { key: `stop:${processId}`, label: "Stopping process" }, async () => {
      const runtime = await api.stopProcess(processId).then(unwrap);
      set((state) => ({ runtimeStates: { ...state.runtimeStates, [runtime.processId]: runtime } }));
      await get().refreshDashboard();
    });
  },
  restartProcess: async (processId) => {
    await safeAction(set, { key: `restart:${processId}`, label: "Restarting process" }, async () => {
      const runtime = await api.restartProcess(processId).then(unwrap);
      set((state) => ({ runtimeStates: { ...state.runtimeStates, [runtime.processId]: runtime } }));
      await get().refreshDashboard();
    });
  },
  startProject: async (projectId) => {
    await safeAction(set, { key: `start-project:${projectId}`, label: "Starting project" }, async () => {
      const detail = await api.startProject(projectId).then(unwrap);
      set((state) => ({ processes: mergeProcesses(state.processes, detail.processes), runtimeStates: { ...state.runtimeStates, ...mergeRuntime(detail.runtimeStates) } }));
      await get().refreshDashboard();
    });
  },
  startAutoStartProcesses: async (projectId) => {
    await safeAction(set, { key: `start-auto:${projectId}`, label: "Starting marked processes" }, async () => {
      const detail = await api.startAutoStartProcesses(projectId).then(unwrap);
      set((state) => ({ processes: mergeProcesses(state.processes, detail.processes), runtimeStates: { ...state.runtimeStates, ...mergeRuntime(detail.runtimeStates) } }));
      await get().refreshDashboard();
    });
  },
  stopProject: async (projectId) => {
    await safeAction(set, { key: `stop-project:${projectId}`, label: "Stopping project" }, async () => {
      const detail = await api.stopProject(projectId).then(unwrap);
      set((state) => ({ processes: mergeProcesses(state.processes, detail.processes), runtimeStates: { ...state.runtimeStates, ...mergeRuntime(detail.runtimeStates) } }));
      await get().refreshDashboard();
    });
  },
  restartProject: async (projectId) => {
    await safeAction(set, { key: `restart-project:${projectId}`, label: "Restarting project" }, async () => {
      const detail = await api.restartProject(projectId).then(unwrap);
      set((state) => ({ processes: mergeProcesses(state.processes, detail.processes), runtimeStates: { ...state.runtimeStates, ...mergeRuntime(detail.runtimeStates) } }));
      await get().refreshDashboard();
    });
  },
  restartFailed: async (projectId) => {
    await safeAction(set, { key: "restart-failed", label: "Restarting failed processes" }, async () => {
      const runtimes = await api.restartFailedProcesses(projectId).then(unwrap);
      set((state) => ({ runtimeStates: { ...state.runtimeStates, ...mergeRuntime(runtimes) } }));
      await get().refreshDashboard();
    });
  },
  loadExternalProcesses: async (projectId) => {
    try {
      const list = await api.listExternalProjectProcesses(projectId).then(unwrap);
      set((state) => ({ externalProcesses: { ...state.externalProcesses, [projectId]: list } }));
    } catch (error) {
      set({ lastError: toOrchestratorError(error) });
    }
  },
  dismissError: () => set({ lastError: undefined }),
  createMachine: async (input) => {
    const created = await safeAction(set, { key: "create-machine", label: "Adding machine" }, async () => {
      const machine = await api.createMachine(input).then(unwrap);
      set((state) => ({ machines: [...state.machines, machine] }));
      return true;
    });
    return Boolean(created);
  },
  updateMachine: async (machine) => {
    await safeAction(set, { key: `update-machine:${machine.id}`, label: "Saving machine" }, async () => {
      const saved = await api.updateMachine(machine).then(unwrap);
      set((state) => ({ machines: state.machines.map((item) => (item.id === saved.id ? saved : item)) }));
    });
  },
  deleteMachine: async (machineId) => {
    await safeAction(set, { key: `delete-machine:${machineId}`, label: "Removing machine" }, async () => {
      await api.deleteMachine(machineId).then(unwrap);
      set((state) => {
        const { [machineId]: _removed, ...rest } = state.machineConnectionResults;
        return {
          machines: state.machines.filter((machine) => machine.id !== machineId),
          machineConnectionResults: rest
        };
      });
    });
  },
  testMachineConnection: async (machineId) => {
    return safeAction(set, { key: `test-machine:${machineId}`, label: "Testing connection" }, async () => {
      const result = await api.testMachineConnection(machineId).then(unwrap);
      set((state) => ({
        machineConnectionResults: { ...state.machineConnectionResults, [machineId]: result }
      }));
      return result;
    });
  },
  stopExternalProcess: async (projectId, processGroupId) => {
    await safeAction(set, { key: `stop-external:${processGroupId}`, label: "Stopping process" }, async () => {
      await api.stopExternalProcess(processGroupId).then(unwrap);
      const list = await api.listExternalProjectProcesses(projectId).then(unwrap);
      set((state) => ({ externalProcesses: { ...state.externalProcesses, [projectId]: list } }));
    });
  },
  runHealthCheck: async (processId) => {
    await safeAction(set, { key: `health:${processId}`, label: "Running health check" }, async () => {
      const runtime = await api.runHealthCheck(processId).then(unwrap);
      set((state) => ({ runtimeStates: { ...state.runtimeStates, [runtime.processId]: runtime } }));
    });
  },
  clearLogs: async (projectId) => {
    await safeAction(set, { key: "clear-logs", label: "Clearing logs" }, async () => {
      await api.clearLogHistory(projectId).then(unwrap);
      set((state) => ({ logs: state.logs.filter((log) => projectId && log.projectId !== projectId) }));
    });
  },
  applyMediaGuardPreset: async (basePath) => {
    const applied = await safeAction(set, { key: "mediaguard-preset", label: "Syncing MediaGuard" }, async () => {
      await api.applyMediaGuardPreset(basePath).then(unwrap);
      await get().refreshAll();
      return true;
    });
    return Boolean(applied);
  },
  importConfig: async (config) => {
    await safeAction(set, { key: "import-config", label: "Importing config" }, async () => {
      await api.importConfig(config).then(unwrap);
      await get().refreshAll();
    });
  },
  exportConfig: async (redactSecrets = true) => api.exportConfig(redactSecrets).then(unwrap),
  exportConfigToPath: async (path, redactSecrets = true) =>
    api.exportConfigToPath(path, redactSecrets).then(unwrap),
  exportLogs: async () => api.exportLogs().then(unwrap),
  updateSettings: async (settings) => {
    await safeAction(set, { key: "settings", label: "Saving settings" }, async () => {
      const saved = await api.updateSettings(settings).then(unwrap);
      set({ settings: saved });
    });
  },
  setProjectFilters: (filters) => set((state) => ({ projectFilters: { ...state.projectFilters, ...filters } })),
  setLogFilters: (filters) => set((state) => ({ logFilters: { ...state.logFilters, ...filters } })),
  loadDeployScripts: async (projectId) => {
    try {
      const scripts = await api.listDeployScripts(projectId).then(unwrap);
      set((state) => ({ deployScripts: { ...state.deployScripts, [projectId]: scripts } }));
    } catch (error) {
      set({ lastError: toOrchestratorError(error) });
    }
  },
  createDeployScript: async (input) => {
    const created = await safeAction(set, { key: "create-deploy-script", label: "Adding deploy script" }, async () => {
      const script = await api.createDeployScript(input).then(unwrap);
      set((state) => {
        const bucket = state.deployScripts[script.projectId] ?? [];
        return {
          deployScripts: { ...state.deployScripts, [script.projectId]: [...bucket, script] }
        };
      });
      return true;
    });
    return Boolean(created);
  },
  updateDeployScript: async (script) => {
    await safeAction(set, { key: `update-deploy-script:${script.id}`, label: "Saving deploy script" }, async () => {
      const saved = await api.updateDeployScript(script).then(unwrap);
      set((state) => {
        const bucket = state.deployScripts[saved.projectId] ?? [];
        return {
          deployScripts: {
            ...state.deployScripts,
            [saved.projectId]: bucket.map((item) => (item.id === saved.id ? saved : item))
          }
        };
      });
    });
  },
  deleteDeployScript: async (scriptId, projectId) => {
    await safeAction(set, { key: `delete-deploy-script:${scriptId}`, label: "Deleting deploy script" }, async () => {
      await api.deleteDeployScript(scriptId).then(unwrap);
      set((state) => {
        const bucket = state.deployScripts[projectId] ?? [];
        return {
          deployScripts: {
            ...state.deployScripts,
            [projectId]: bucket.filter((item) => item.id !== scriptId)
          }
        };
      });
    });
  },
  reorderDeployScripts: async (projectId, orderedIds) => {
    await safeAction(set, { key: `reorder-deploy:${projectId}`, label: "Reordering deploy scripts" }, async () => {
      const scripts = await api.reorderDeployScripts(projectId, orderedIds).then(unwrap);
      set((state) => ({ deployScripts: { ...state.deployScripts, [projectId]: scripts } }));
    });
  },
  deployProject: async (projectId) => {
    await safeAction(set, { key: `deploy:${projectId}`, label: "Deploying project" }, async () => {
      const run = await api.deployProject(projectId).then(unwrap);
      set((state) => ({ deployStates: { ...state.deployStates, [projectId]: run } }));
    });
  },
  cancelDeploy: async (projectId) => {
    await safeAction(set, { key: `cancel-deploy:${projectId}`, label: "Cancelling deploy" }, async () => {
      const run = await api.cancelDeploy(projectId).then(unwrap);
      set((state) => ({ deployStates: { ...state.deployStates, [projectId]: run } }));
    });
  }
}));

export function selectCurrentProject(state: OrchestratorState): Project | undefined {
  return state.projects.find((project) => project.id === state.selectedProjectId);
}

export function selectCurrentProcess(state: OrchestratorState): ProcessDefinition | undefined {
  return state.processes.find((process) => process.id === state.selectedProcessId);
}

export function selectMachineForProcess(state: OrchestratorState, process: ProcessDefinition | undefined): Machine | undefined {
  if (!process) return undefined;
  if (process.machineId) {
    const explicit = state.machines.find((machine) => machine.id === process.machineId);
    if (explicit) return explicit;
  }
  return state.machines.find((machine) => machine.isDefaultLocal);
}

export function selectProjectStatus(state: OrchestratorState, projectId: ID) {
  const states = state.processes
    .filter((process) => process.projectId === projectId)
    .map((process) => state.runtimeStates[process.id])
    .filter(Boolean);
  return deriveProjectStatus(states);
}
