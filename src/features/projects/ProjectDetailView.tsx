import { Copy, Edit3, ExternalLink, FolderOpen, Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../components/StatusBadge";
import { api } from "../../lib/api";
import { formatMemory, formatMemoryLimit, normalizeMemoryLimitMb, parseMemoryLimitInput } from "../../lib/memory";
import { deriveProjectStatus, isRuntimeBusy } from "../../lib/status";
import { envToText, formatPath, formatRelativeTime, normalizeCliText, parseEnvInput, parseListInput } from "../../lib/time";
import { useOrchestratorStore } from "../../stores/orchestratorStore";
import type { ProcessDefinition, ProcessFormInput, ProcessRuntimeState } from "../../types/domain";

const technicalInputProps = {
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false
} as const;

function defaultProcess(projectId: string): ProcessFormInput {
  return {
    projectId,
    name: "",
    key: "",
    command: "",
    args: [],
    workingDirectory: "",
    env: {},
    memoryLimitMb: undefined,
    autoStart: true,
    restartPolicy: { kind: "never" },
    dependsOn: [],
    healthCheck: { kind: "none" },
    logMode: "combined",
    group: "",
    visible: true
  };
}

export function ProjectDetailView() {
  const selectedProjectId = useOrchestratorStore((state) => state.selectedProjectId);
  const projects = useOrchestratorStore((state) => state.projects);
  const processes = useOrchestratorStore((state) => state.processes);
  const runtimeStates = useOrchestratorStore((state) => state.runtimeStates);
  const selectProcess = useOrchestratorStore((state) => state.selectProcess);
  const updateProject = useOrchestratorStore((state) => state.updateProject);
  const createProcess = useOrchestratorStore((state) => state.createProcess);
  const updateProcess = useOrchestratorStore((state) => state.updateProcess);
  const deleteProcess = useOrchestratorStore((state) => state.deleteProcess);
  const deleteProject = useOrchestratorStore((state) => state.deleteProject);
  const startProcess = useOrchestratorStore((state) => state.startProcess);
  const stopProcess = useOrchestratorStore((state) => state.stopProcess);
  const restartProcess = useOrchestratorStore((state) => state.restartProcess);
  const startProject = useOrchestratorStore((state) => state.startProject);
  const stopProject = useOrchestratorStore((state) => state.stopProject);
  const restartProject = useOrchestratorStore((state) => state.restartProject);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<ProcessFormInput | null>(null);
  const [processFormError, setProcessFormError] = useState<string>();

  const project = useMemo(() => projects.find((item) => item.id === selectedProjectId), [projects, selectedProjectId]);
  const projectProcesses = useMemo(() => processes.filter((process) => process.projectId === selectedProjectId), [processes, selectedProjectId]);
  const processStates = useMemo(
    () => projectProcesses.map((process) => runtimeStates[process.id]).filter((state): state is ProcessRuntimeState => Boolean(state)),
    [projectProcesses, runtimeStates]
  );
  const status = deriveProjectStatus(processStates);
  const runningCount = processStates.filter((state) => state.currentStatus === "running").length;
  const projectMemoryUsage = processStates.reduce((total, state) => total + (state.memoryUsage ?? 0), 0);

  if (!project) {
    return (
      <main className="empty-state">
        <FolderOpen size={24} />
        <span>Select a project from the sidebar.</span>
      </main>
    );
  }

  const submitProcess = async () => {
    if (!draft) return;

    const name = draft.name.trim();
    const key = draft.key.trim();
    const command = draft.command.trim();

    if (!name || !key || !command) {
      setProcessFormError("Name, Key, and Command fields are required.");
      return;
    }

    if (projectProcesses.some((process) => process.key === key)) {
      setProcessFormError(`Process key "${key}" already exists in this project.`);
      return;
    }

    const existingKeys = new Set(projectProcesses.map((process) => process.key));
    const missingDependency = draft.dependsOn.find((dependency) => !existingKeys.has(dependency));
    if (missingDependency) {
      setProcessFormError(`Dependency "${missingDependency}" does not exist in this project.`);
      return;
    }

    setProcessFormError(undefined);
    const created = await createProcess({
      ...draft,
      name,
      key,
      command,
      memoryLimitMb: normalizeMemoryLimitMb(draft.memoryLimitMb),
      workingDirectory: draft.workingDirectory?.trim() || undefined,
      group: draft.group?.trim() || undefined
    });

    if (created) {
      setFormOpen(false);
      setDraft(null);
      return;
    }

    setProcessFormError("Process could not be created. Check the app error message for details.");
  };

  const copyProjectPath = async () => {
    await navigator.clipboard.writeText(project.rootPath);
  };

  return (
    <main className="solo-project-show">
      <header className="solo-project-topbar">
        <div className="solo-project-title">
          <h2>{project.name}</h2>
          <button type="button" title="Edit project name">
            <Edit3 size={13} />
          </button>
          <span className="solo-running-pill">
            <span />
            {runningCount}/{projectProcesses.length} Running
          </span>
        </div>
        <div className="solo-project-actions">
          <button type="button" onClick={() => startProject(project.id)}>
            <Play size={14} />
            Start auto-starting
          </button>
          <button type="button" onClick={() => startProject(project.id)}>
            <Play size={14} />
            Start all
          </button>
          <button type="button" onClick={() => restartProject(project.id)} title="Restart all">
            <RotateCcw size={14} />
          </button>
          <button type="button" onClick={() => window.confirm("Stop all processes in this project?") && stopProject(project.id)} title="Stop all">
            <Square size={14} />
          </button>
        </div>
      </header>

      <div className="solo-project-scroll">
        <div className="solo-project-column">
          <SoloSection title="Overview">
            <div className="solo-detail-card">
              <SoloDetailRow
                title="Directory"
                subtitle={formatPath(project.rootPath)}
                actions={
                  <>
                    <button type="button" onClick={copyProjectPath} title="Copy directory">
                      <Copy size={14} />
                    </button>
                    <button type="button" onClick={() => api.openProjectFolderInFinder(project.id)} title="Open directory">
                      <FolderOpen size={14} />
                    </button>
                  </>
                }
              />
              <SoloDetailRow
                title="Config"
                subtitle="Project configuration file"
                value="None"
                actions={
                  <button type="button" onClick={() => setFormOpen(true)}>
                    Create process
                  </button>
                }
              />
              <SoloDetailRow title="Commands" subtitle="Running and total command count" value={`${runningCount} Running  -  ${projectProcesses.length} Total`} tone={runningCount ? "good" : "neutral"} />
              <SoloDetailRow title="RAM" subtitle="Current combined process memory" value={project.memoryLimitMb ? `${formatMemory(projectMemoryUsage)} / ${formatMemoryLimit(project.memoryLimitMb)}` : formatMemory(projectMemoryUsage)} />
            </div>
          </SoloSection>

          <SoloSection title="Settings">
            <div className="solo-detail-card">
              <SoloDetailRow title="Auto Start" subtitle="Auto-start commands will run when this app launches" actions={<SoloSwitch checked={project.autoStart} />} />
              <SoloDetailRow
                title="Project RAM cap"
                subtitle="Stop project commands when combined usage crosses this cap"
                value={formatMemoryLimit(project.memoryLimitMb)}
                actions={<MemoryLimitInput value={project.memoryLimitMb} onCommit={(memoryLimitMb) => updateProject({ ...project, memoryLimitMb })} />}
              />
              <SoloDetailRow
                title="Editor"
                subtitle="Override the default editor for this project"
                actions={
                  <button type="button" className="solo-select-button">
                    use default
                  </button>
                }
              />
              <SoloDetailRow
                title="Icon"
                subtitle="Display a small icon next to the project name"
                actions={
                  <span className="solo-icon-control">
                    <span className="solo-mark">{project.name.slice(0, 2).toUpperCase()}</span>
                    <button type="button">customize</button>
                  </span>
                }
              />
            </div>
          </SoloSection>

          <SoloSection title="Notifications">
            <div className="solo-detail-card">
              <SoloDetailRow title="Crash & exit alerts" subtitle="Get notified when commands crash or exit unexpectedly" actions={<SoloSwitch checked />} />
              <SoloDetailRow title="Terminal alerts" subtitle="Get notified when commands ring the bell or request attention" actions={<SoloSwitch checked />} />
            </div>
          </SoloSection>

          <SoloSection
            title="Commands"
            action={
              <button
                type="button"
                onClick={() => {
                  setDraft(defaultProcess(project.id));
                  setProcessFormError(undefined);
                  setFormOpen(!formOpen);
                }}
              >
                <Plus size={14} />
                Add command
              </button>
            }
          >
            {formOpen && draft ? (
              <div className="editor-panel inline solo-command-editor">
                <div className="form-grid">
                  <label>
                    Name
                    <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Vite dev server" />
                  </label>
                  <label>
                    Key
                    <input {...technicalInputProps} value={draft.key} onChange={(event) => setDraft({ ...draft, key: event.target.value })} placeholder="vite" />
                  </label>
                  <label>
                    Command
                    <input {...technicalInputProps} value={draft.command} onChange={(event) => setDraft({ ...draft, command: normalizeCliText(event.target.value) })} placeholder="npm" />
                  </label>
                  <label>
                    Args
                    <input {...technicalInputProps} value={draft.args.join(", ")} onChange={(event) => setDraft({ ...draft, args: parseListInput(event.target.value) })} placeholder="run, dev" />
                  </label>
                  <label>
                    Working directory
                    <input {...technicalInputProps} value={draft.workingDirectory} onChange={(event) => setDraft({ ...draft, workingDirectory: event.target.value })} placeholder={project.rootPath} />
                  </label>
                  <label>
                    Depends on keys
                    <input {...technicalInputProps} value={draft.dependsOn.join(", ")} onChange={(event) => setDraft({ ...draft, dependsOn: parseListInput(event.target.value) })} placeholder="api, redis" />
                  </label>
                  <label>
                    Group
                    <input {...technicalInputProps} value={draft.group} onChange={(event) => setDraft({ ...draft, group: event.target.value })} placeholder="workers" />
                  </label>
                  <label>
                    Env
                    <textarea {...technicalInputProps} value={envToText(draft.env)} onChange={(event) => setDraft({ ...draft, env: parseEnvInput(event.target.value) })} placeholder="NODE_ENV=development" />
                  </label>
                  <label>
                    Memory limit (MB)
                    <input
                      type="number"
                      min={64}
                      step={64}
                      value={draft.memoryLimitMb ?? ""}
                      onChange={(event) => setDraft({ ...draft, memoryLimitMb: normalizeMemoryLimitMb(event.target.valueAsNumber) })}
                      placeholder="Off"
                    />
                  </label>
                  <label className="checkbox-line">
                    <input type="checkbox" checked={draft.autoStart} onChange={(event) => setDraft({ ...draft, autoStart: event.target.checked })} />
                    Include in project start
                  </label>
                </div>
                {processFormError ? <div className="form-error">{processFormError}</div> : null}
                <div className="editor-actions">
                  <button type="button" onClick={submitProcess}>
                    Create process
                  </button>
                </div>
              </div>
            ) : null}

            <div className="solo-detail-card">
              {projectProcesses.map((process) => (
                <CommandRow
                  key={process.id}
                  process={process}
                  runtime={runtimeStates[process.id]}
                  onSelect={() => selectProcess(process.id)}
                  onStart={() => startProcess(process.id)}
                  onStop={() => stopProcess(process.id)}
                  onRestart={() => restartProcess(process.id)}
                  onMemoryLimitCommit={(memoryLimitMb) => updateProcess({ ...process, memoryLimitMb })}
                  onDelete={() => {
                    if (window.confirm(`Delete ${process.name}?`)) void deleteProcess(process.id);
                  }}
                />
              ))}
              {!projectProcesses.length ? <p className="solo-empty-row">No commands configured.</p> : null}
            </div>
          </SoloSection>

          <button
            className="solo-remove-project"
            type="button"
            onClick={() => {
              if (window.confirm(`Delete project "${project.name}" and its process definitions?`)) void deleteProject(project.id);
            }}
          >
            <Trash2 size={14} />
            Remove project
          </button>
        </div>
      </div>
    </main>
  );
}

function SoloSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="solo-detail-section">
      <div className="solo-detail-section-heading">
        <span>{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

function SoloDetailRow({
  title,
  subtitle,
  value,
  tone = "neutral",
  actions
}: {
  title: string;
  subtitle: string;
  value?: string;
  tone?: "neutral" | "good";
  actions?: ReactNode;
}) {
  return (
    <div className="solo-detail-row">
      <span className="solo-detail-row-copy">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      {value ? <span className={`solo-detail-value ${tone}`}>{value}</span> : null}
      {actions ? <span className="solo-detail-actions">{actions}</span> : null}
    </div>
  );
}

function CommandRow({
  process,
  runtime,
  onSelect,
  onStart,
  onStop,
  onRestart,
  onMemoryLimitCommit,
  onDelete
}: {
  process: ProcessDefinition;
  runtime?: ProcessRuntimeState;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onMemoryLimitCommit: (memoryLimitMb?: number) => void;
  onDelete: () => void;
}) {
  return (
    <div className="solo-command-row">
      <button type="button" className="solo-command-main" onClick={onSelect}>
        <span className={`runtime-dot ${runtime?.currentStatus ?? "stopped"}`} />
        <span>
          <strong>{process.name}</strong>
          <small>{formatProcessCommand(process)}</small>
        </span>
      </button>
      <StatusBadge status={runtime?.currentStatus ?? "stopped"} />
      <MemoryLimitInput value={process.memoryLimitMb} onCommit={onMemoryLimitCommit} compact />
      <span className="solo-command-meta">
        {runtime?.memoryUsage
          ? formatMemory(runtime.memoryUsage)
          : runtime?.pid
            ? `pid ${runtime.pid}`
            : runtime?.startedAt
              ? formatRelativeTime(runtime.startedAt)
              : process.autoStart
                ? "auto"
                : "manual"}
      </span>
      <span className="solo-command-actions">
        <button disabled={isRuntimeBusy(runtime?.currentStatus)} type="button" onClick={onStart} title="Start">
          <Play size={14} />
        </button>
        <button disabled={isRuntimeBusy(runtime?.currentStatus)} type="button" onClick={onStop} title="Stop">
          <Square size={14} />
        </button>
        <button disabled={isRuntimeBusy(runtime?.currentStatus)} type="button" onClick={onRestart} title="Restart">
          <RotateCcw size={14} />
        </button>
        <button type="button" onClick={onDelete} title="Delete">
          <Trash2 size={14} />
        </button>
      </span>
    </div>
  );
}

function MemoryLimitInput({
  value,
  onCommit,
  compact = false
}: {
  value?: number;
  onCommit: (memoryLimitMb?: number) => void;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState(value ? String(value) : "");

  useEffect(() => {
    setDraft(value ? String(value) : "");
  }, [value]);

  const commit = () => {
    const next = parseMemoryLimitInput(draft);
    setDraft(next ? String(next) : "");
    if (next !== value) onCommit(next);
  };

  return (
    <label className={`memory-limit-field ${compact ? "compact" : ""}`}>
      <span>RAM</span>
      <input
        type="number"
        min={64}
        step={64}
        value={draft}
        onBlur={commit}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="Off"
      />
    </label>
  );
}

function SoloSwitch({ checked }: { checked: boolean }) {
  return (
    <span className={`solo-switch ${checked ? "checked" : ""}`} aria-hidden="true">
      <span />
    </span>
  );
}

function formatProcessCommand(process: ProcessDefinition) {
  return [process.command, ...process.args].filter(Boolean).join(" ") || process.key;
}
