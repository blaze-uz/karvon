import { CheckCircle2, Plus, ServerCog, Trash2, XCircle, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { useConfirm } from "../../components/ConfirmDialog";
import { useOrchestratorStore } from "../../stores/orchestratorStore";
import type { Machine, MachineFormInput } from "../../types/domain";

const emptyMachine: MachineFormInput = {
  name: "",
  hostname: "",
  sshUser: "",
  sshPort: 22,
  sshKeyPath: ""
};

interface DraftState extends MachineFormInput {
  editingId?: string;
}

export function MachinesView() {
  const machines = useOrchestratorStore((state) => state.machines);
  const processes = useOrchestratorStore((state) => state.processes);
  const results = useOrchestratorStore((state) => state.machineConnectionResults);
  const createMachine = useOrchestratorStore((state) => state.createMachine);
  const updateMachine = useOrchestratorStore((state) => state.updateMachine);
  const deleteMachine = useOrchestratorStore((state) => state.deleteMachine);
  const testMachineConnection = useOrchestratorStore((state) => state.testMachineConnection);
  const currentAction = useOrchestratorStore((state) => state.currentAction);
  const confirm = useConfirm();

  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState>(emptyMachine);

  const processCountByMachine = useMemo(() => {
    const map = new Map<string, number>();
    for (const process of processes) {
      const id = process.machineId ?? machines.find((m) => m.isDefaultLocal)?.id;
      if (!id) continue;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [processes, machines]);

  function openCreate() {
    setDraft({ ...emptyMachine });
    setFormOpen(true);
  }

  function openEdit(machine: Machine) {
    setDraft({
      name: machine.name,
      hostname: machine.hostname,
      sshUser: machine.sshUser,
      sshPort: machine.sshPort,
      sshKeyPath: machine.sshKeyPath ?? "",
      editingId: machine.id
    });
    setFormOpen(true);
  }

  async function submit() {
    if (!draft.name.trim() || !draft.hostname.trim() || !draft.sshUser.trim()) return;
    if (draft.editingId) {
      const existing = machines.find((m) => m.id === draft.editingId);
      if (!existing) return;
      await updateMachine({
        ...existing,
        name: draft.name.trim(),
        hostname: draft.hostname.trim(),
        sshUser: draft.sshUser.trim(),
        sshPort: draft.sshPort,
        sshKeyPath: draft.sshKeyPath?.trim() || undefined
      });
    } else {
      const ok = await createMachine({
        name: draft.name.trim(),
        hostname: draft.hostname.trim(),
        sshUser: draft.sshUser.trim(),
        sshPort: draft.sshPort,
        sshKeyPath: draft.sshKeyPath?.trim() || undefined
      });
      if (!ok) return;
    }
    setDraft({ ...emptyMachine });
    setFormOpen(false);
  }

  async function handleDelete(machine: Machine) {
    if (machine.isDefaultLocal) return;
    const referenced = processCountByMachine.get(machine.id) ?? 0;
    const message =
      referenced > 0
        ? `${machine.name} is referenced by ${referenced} process${referenced === 1 ? "" : "es"}. Remove or reassign those processes first.`
        : `Remove ${machine.name}?`;
    const ok = await confirm({ title: "Remove machine", message, confirmLabel: "Remove" });
    if (ok) await deleteMachine(machine.id);
  }

  return (
    <div className="page machines-view">
      <header className="page-header">
        <div>
          <p className="eyebrow">Machines</p>
          <h2>Hosts</h2>
          <p className="muted">
            Local Mac plus any remote Mac you can reach over SSH (Tailscale hostnames or IPs work).
          </p>
        </div>
        <button type="button" onClick={() => (formOpen ? setFormOpen(false) : openCreate())}>
          <Plus size={16} />
          {formOpen ? "Close" : "Add machine"}
        </button>
      </header>

      {formOpen ? (
        <section className="editor-panel">
          <div className="form-grid">
            <label>
              Name<span className="required-marker" aria-hidden="true">*</span>
              <input
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Mars"
              />
            </label>
            <label>
              Hostname or IP<span className="required-marker" aria-hidden="true">*</span>
              <input
                required
                value={draft.hostname}
                onChange={(event) => setDraft({ ...draft, hostname: event.target.value })}
                placeholder="marss-mac-mini or 100.123.15.93"
              />
            </label>
            <label>
              SSH user<span className="required-marker" aria-hidden="true">*</span>
              <input
                required
                value={draft.sshUser}
                onChange={(event) => setDraft({ ...draft, sshUser: event.target.value })}
                placeholder="milliykontent"
              />
            </label>
            <label>
              SSH port
              <input
                type="number"
                min={1}
                max={65535}
                value={draft.sshPort}
                onChange={(event) => setDraft({ ...draft, sshPort: Number(event.target.value) || 22 })}
              />
            </label>
            <label className="span-2">
              Private key path (optional)
              <input
                value={draft.sshKeyPath ?? ""}
                onChange={(event) => setDraft({ ...draft, sshKeyPath: event.target.value })}
                placeholder="/Users/me/.ssh/id_ed25519 (leave blank for ssh-agent)"
              />
            </label>
          </div>
          <div className="editor-actions">
            <button type="button" onClick={submit}>
              {draft.editingId ? "Save changes" : "Add machine"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="machine-cards">
        {machines.map((machine) => {
          const result = results[machine.id];
          const processCount = processCountByMachine.get(machine.id) ?? 0;
          const testing = currentAction?.key === `test-machine:${machine.id}`;
          return (
            <article key={machine.id} className="machine-card">
              <header>
                <ServerCog size={18} />
                <div>
                  <strong>{machine.name}</strong>
                  {machine.isDefaultLocal ? <span className="badge">local</span> : null}
                </div>
              </header>
              <dl>
                <div>
                  <dt>Host</dt>
                  <dd>{machine.hostname}</dd>
                </div>
                <div>
                  <dt>SSH</dt>
                  <dd>
                    {machine.sshUser}@{machine.hostname}:{machine.sshPort}
                  </dd>
                </div>
                {machine.sshKeyPath ? (
                  <div>
                    <dt>Key</dt>
                    <dd>{machine.sshKeyPath}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Processes</dt>
                  <dd>{processCount}</dd>
                </div>
                {result ? (
                  <div>
                    <dt>Last test</dt>
                    <dd className={result.ok ? "ok-text" : "danger-text"}>
                      {result.ok ? (
                        <>
                          <CheckCircle2 size={14} /> ok ({result.latencyMs}ms)
                        </>
                      ) : (
                        <>
                          <XCircle size={14} /> {result.detail || "failed"}
                        </>
                      )}
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="machine-card-actions">
                <button
                  type="button"
                  disabled={testing}
                  onClick={() => testMachineConnection(machine.id)}
                  title="Test SSH connection"
                >
                  <Zap size={14} /> {testing ? "Testing…" : "Test"}
                </button>
                {!machine.isDefaultLocal ? (
                  <>
                    <button type="button" onClick={() => openEdit(machine)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(machine)}
                      title="Remove machine"
                      className="danger"
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
