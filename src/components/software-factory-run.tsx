import {
  attachSoftwareFactoryEvidenceAction,
  bindSoftwareFactoryRunAction,
  freezeSoftwareFactoryPacketAction,
  inspectSoftwareFactoryRepositoryAction,
  recordSoftwareFactoryHandoffsAction,
  recordSoftwareFactoryOwnerDecisionAction,
  rejectSoftwareFactoryForbiddenAction,
  transitionSoftwareFactoryRunAction,
} from "@/app/actions/software-factory";
import { WorkCellActionForm } from "@/components/work-cell-action-form";
import { Badge, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { defaultSoftwareFactoryPacket, type SoftwareFactoryOverlay } from "@/lib/software-factory-persist";
import {
  SOFTWARE_FACTORY_ACTION_CLASS,
  SOFTWARE_FACTORY_FORBIDDEN_ACTIONS,
  SOFTWARE_FACTORY_RUN_INPUT,
  SOFTWARE_FACTORY_TRANSITIONS,
  softwareFactoryStaffControlsOpen,
} from "@/lib/software-factory-run-manager";
import type { WorkstreamRun } from "@/lib/execution-primitives";

function statusTone(status: string): "good" | "bad" | "warn" | "info" | "neutral" {
  if (status === "accepted") return "good";
  if (status === "rejected" || status === "cancelled") return "bad";
  if (status === "blocked" || status === "awaiting_owner") return "warn";
  if (status === "in_progress" || status === "verification") return "info";
  return "neutral";
}

export function SoftwareFactorySection({
  run,
  overlay,
}: {
  run: WorkstreamRun;
  overlay: SoftwareFactoryOverlay | null;
}) {
  const running = softwareFactoryStaffControlsOpen({
    workstreamStatus: run.status,
    lifecycleStatus: overlay?.run.lifecycleStatus ?? "intake",
  });

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Software Factory run</h2>
        <p className="max-w-3xl text-sm text-muted">
          Prepare-only overlay on this workstream. Delegation Cloud owns lifecycle, evidence,
          owner acceptance, and the Outcome Receipt. Grok and Cursor are not approved connectors.
          GitHub is evidence only. Merge is never performed here.
        </p>
      </div>

      {!overlay ? (
        <Card className="p-5">
          <p className="text-sm">
            No Software Factory overlay is bound yet. The spec must include {SOFTWARE_FACTORY_RUN_INPUT}.
          </p>
          <WorkCellActionForm action={bindSoftwareFactoryRunAction} className="mt-4 space-y-4">
            <input type="hidden" name="runId" value={run.id} />
            <Field label="Task id">
              <Input name="taskId" required defaultValue="SF-VA-001" />
            </Field>
            <Field label="Repository">
              <Input name="repository" required defaultValue="Bthornton1994/Loadout" />
            </Field>
            <Field label="Base branch">
              <Input name="baseBranch" required defaultValue="main" />
            </Field>
            <Field label="In scope" hint="One item per line. Frozen at bind time.">
              <Textarea
                name="inScope"
                required
                defaultValue={"Record the request as a Software Factory run.\nAttach hashed PR and verification evidence."}
              />
            </Field>
            <Field label="Acceptance criteria" hint="One item per line. Frozen at bind time.">
              <Textarea
                name="acceptanceCriteria"
                required
                defaultValue={"Delegation Spec and Workstream Run exist.\nTask packet is frozen and hashed.\nHistorical PR evidence is attached without mutation.\nMerge remains unperformed by Delegation Cloud."}
              />
            </Field>
            <Button type="submit">Bind Software Factory overlay</Button>
          </WorkCellActionForm>
        </Card>
      ) : (
        <SoftwareFactoryBoundSection run={run} overlay={overlay} running={running} />
      )}
    </section>
  );
}

function SoftwareFactoryBoundSection({
  run,
  overlay,
  running,
}: {
  run: WorkstreamRun;
  overlay: SoftwareFactoryOverlay;
  running: boolean;
}) {
  const factory = overlay.run;
  const nextStatuses = SOFTWARE_FACTORY_TRANSITIONS[factory.lifecycleStatus].filter((status) => status !== "accepted");
  const packet = factory.packet ?? defaultSoftwareFactoryPacket(factory);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={statusTone(factory.lifecycleStatus)}>{factory.lifecycleStatus.replaceAll("_", " ")}</Badge>
          <Badge tone="info">{SOFTWARE_FACTORY_ACTION_CLASS.replaceAll("_", " ")}</Badge>
          <Badge>may own authority: no</Badge>
          <Badge>merge performed: no</Badge>
        </div>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted">Task: </span>
            {factory.taskId}
          </p>
          <p>
            <span className="text-muted">Repository: </span>
            {factory.repository}@{factory.baseBranch}
          </p>
          <p className="break-all sm:col-span-2">
            <span className="text-muted">Packet hash: </span>
            <span className="font-mono text-xs">{factory.packetHash ?? "not frozen"}</span>
          </p>
        </div>
        {overlay.accept.ok ? (
          <p className="mt-3 text-sm text-muted">
            Deterministic factory checks are satisfied. An operations manager may still refuse the receipt.
          </p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm text-bad">
            {overlay.accept.failures.map((failure) => (
              <li key={failure}>• {failure}</li>
            ))}
          </ul>
        )}
        {overlay.problems.length ? (
          <ul className="mt-3 space-y-1 text-sm text-warn">
            {overlay.problems.map((problem) => (
              <li key={`${problem.class}-${problem.summary}`}>
                {problem.class.replaceAll("_", " ")}: {problem.summary}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-sm text-muted">
          Owner acceptance is recorded by the organization owner or a member on Approvals. Staff cannot record it.
          A Cursor or Grok success claim cannot accept this run.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Connectors</p>
          <ul className="mt-3 space-y-2 text-sm">
            {factory.connectors.map((connector) => (
              <li key={connector.key}>
                <span className="font-medium">{connector.key.replaceAll("_", " ")}</span>
                <span className="text-muted"> — {connector.available ? "available as evidence provider" : "not approved"}</span>
                <p className="text-muted">{connector.limitation}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Approvals</p>
          {overlay.approvals.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {overlay.approvals.map((approval) => (
                <li key={approval.id}>
                  {approval.kind.replaceAll("_", " ")} · {approval.status}
                  {approval.packetHash ? (
                    <p className="break-all font-mono text-[11px] text-muted">{approval.packetHash.slice(0, 16)}…</p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No owner decision is recorded yet.</p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Factory evidence</p>
        {overlay.evidence.length ? (
          <ul className="mt-3 space-y-2 text-sm">
            {overlay.evidence.map((item) => (
              <li key={item.evidenceId}>
                {item.kind.replaceAll("_", " ")} — {item.summary}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">No factory evidence is attached yet.</p>
        )}
      </Card>

      {running ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Lifecycle</p>
            <WorkCellActionForm action={transitionSoftwareFactoryRunAction} className="mt-4 space-y-4">
              <input type="hidden" name="runId" value={run.id} />
              <Field label="Next status">
                <select
                  name="to"
                  className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
                  defaultValue={nextStatuses[0] ?? factory.lifecycleStatus}
                >
                  {nextStatuses.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Button type="submit" variant="secondary">Transition</Button>
            </WorkCellActionForm>
            <p className="mt-3 text-xs text-muted">Accepted is issued only by a passing Outcome Receipt after owner acceptance.</p>
          </Card>

          <Card className="p-5">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Inspection and handoffs</p>
            <WorkCellActionForm action={inspectSoftwareFactoryRepositoryAction} className="mt-4 space-y-4">
              <input type="hidden" name="runId" value={run.id} />
              <Field label="Inspection notes">
                <Textarea name="notes" defaultValue="Prepare-only inspection. No live GitHub mutation." />
              </Field>
              <Button type="submit" variant="secondary">Record inspection</Button>
            </WorkCellActionForm>
            <WorkCellActionForm action={recordSoftwareFactoryHandoffsAction} className="mt-4 border-t border-line pt-4">
              <input type="hidden" name="runId" value={run.id} />
              <Button type="submit" variant="secondary">Record missing-connector handoffs</Button>
            </WorkCellActionForm>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Freeze packet</p>
            <WorkCellActionForm action={freezeSoftwareFactoryPacketAction} className="mt-4 space-y-4">
              <input type="hidden" name="runId" value={run.id} />
              <Field label="Task packet JSON" hint="STATUS must match the current factory lifecycle. The packet cannot authorize itself.">
                <Textarea name="packet" className="min-h-48 font-mono text-xs" defaultValue={JSON.stringify(packet, null, 2)} />
              </Field>
              <Button type="submit">Freeze packet</Button>
            </WorkCellActionForm>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Attach evidence</p>
            <WorkCellActionForm action={attachSoftwareFactoryEvidenceAction} className="mt-4 grid gap-4 lg:grid-cols-2">
              <input type="hidden" name="runId" value={run.id} />
              <Field label="Kind">
                <select
                  name="factoryKind"
                  defaultValue="pull_request"
                  className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
                >
                  <option value="pull_request">Pull request</option>
                  <option value="ci">CI</option>
                  <option value="test">Test</option>
                  <option value="agent_report">Agent report</option>
                  <option value="cursor_execution">Cursor execution</option>
                  <option value="blocker">Blocker</option>
                </select>
              </Field>
              <Field label="Source URI">
                <Input name="sourceUri" placeholder="https://github.com/Bthornton1994/Loadout/pull/26" />
              </Field>
              <div className="lg:col-span-2">
                <Field label="Summary">
                  <Textarea name="summary" required placeholder="What was observed? Historical evidence only." />
                </Field>
              </div>
              <Field label="Conclusion">
                <Input name="conclusion" defaultValue="recorded" />
              </Field>
              <Field label="Satisfied criteria" hint="One frozen criterion per line.">
                <Textarea name="satisfiedCriteria" />
              </Field>
              <div className="lg:col-span-2">
                <Button type="submit" variant="secondary">Attach factory evidence</Button>
              </div>
            </WorkCellActionForm>
          </Card>
        </div>
      ) : (
        <Card className="p-5">
          <p className="text-sm text-muted">
            Start the workstream run before recording inspection, packet, handoffs, or evidence. After verification,
            keep using this overlay to move the factory run to awaiting owner, then submit the workstream.
          </p>
        </Card>
      )}

      <Card className="p-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Closed actions</p>
        <p className="mt-2 text-sm text-muted">{SOFTWARE_FACTORY_FORBIDDEN_ACTIONS.join(", ").replaceAll("_", " ")}</p>
        <WorkCellActionForm action={rejectSoftwareFactoryForbiddenAction} className="mt-4">
          <input type="hidden" name="runId" value={run.id} />
          <input type="hidden" name="action" value="merge_pr" />
          <Button type="submit" variant="danger">Prove merge stays blocked</Button>
        </WorkCellActionForm>
      </Card>
    </div>
  );
}

export function SoftwareFactoryOwnerCard({
  factoryRunId,
  workstreamRunId,
  taskId,
  packetHash,
}: {
  factoryRunId: string;
  workstreamRunId: string | null;
  taskId: string;
  packetHash: string | null;
}) {
  return (
    <article className="rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">{taskId}</h2>
        <span className="rounded-full border border-line px-2 py-0.5 text-xs">owner acceptance</span>
        <span className="text-xs uppercase text-muted">awaiting owner</span>
      </div>
      <p className="mt-2 text-sm">
        This Software Factory run is waiting for an organization owner or member. Staff cannot record this decision.
        Approving does not merge or deploy anything.
      </p>
      <p className="mt-2 break-all font-mono text-[11px] text-muted">
        packet {packetHash ?? "missing"}
      </p>
      <WorkCellActionForm action={recordSoftwareFactoryOwnerDecisionAction} className="mt-4 space-y-3">
        <input type="hidden" name="factoryRunId" value={factoryRunId} />
        <input type="hidden" name="runId" value={workstreamRunId ?? ""} />
        <input type="hidden" name="status" value="approved" />
        <Field label="Rationale">
          <Textarea name="rationale" required placeholder="Why this prepare-only packet is accepted or rejected." />
        </Field>
        <Field label="Source refs" hint="Governance evidence outside the packet. One per line.">
          <Textarea name="sourceRefs" required defaultValue="governance:owner-acceptance" />
        </Field>
        <Button type="submit">Approve owner acceptance</Button>
      </WorkCellActionForm>
      <WorkCellActionForm action={recordSoftwareFactoryOwnerDecisionAction} className="mt-3 space-y-3">
        <input type="hidden" name="factoryRunId" value={factoryRunId} />
        <input type="hidden" name="runId" value={workstreamRunId ?? ""} />
        <input type="hidden" name="status" value="rejected" />
        <Field label="Rejection rationale">
          <Textarea name="rationale" required placeholder="Why this packet is rejected." />
        </Field>
        <Field label="Source refs">
          <Textarea name="sourceRefs" required defaultValue="governance:owner-rejection" />
        </Field>
        <Button type="submit" variant="secondary">Reject</Button>
      </WorkCellActionForm>
    </article>
  );
}
