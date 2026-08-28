import Link from "next/link";
import {
  activateDelegationSpecAction,
  createDelegationSpecAction,
  createWorkstreamRunAction,
} from "@/app/actions/execution";
import { ActionClassBadge, Metric, PageHeader } from "@/components/product";
import { Badge, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { ACTION_CLASSES, ACTION_CLASS_COPY } from "@/lib/domain";
import { listDelegationSpecs, listWorkstreamRuns } from "@/lib/execution-primitives";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Execution Lab" };

function runTone(status: string): "good" | "bad" | "warn" | "info" | "neutral" {
  if (status === "verified") return "good";
  if (status === "failed" || status === "cancelled") return "bad";
  if (status === "awaiting_verification") return "warn";
  if (status === "running") return "info";
  return "neutral";
}

export default async function ExecutionLabPage() {
  const actor = await requireOps();
  const manager = actor.role === "ops_manager" || actor.role === "platform_admin";

  if (actor.source === "demo") {
    return (
      <div className="space-y-8">
        <PageHeader
          kicker="Execution Lab"
          title="Prove the work before automating it"
          description="Delegation Specs, execution evidence, and Outcome Receipts intentionally require the persistent workspace. The demo store does not simulate execution history."
        />
        <Card className="p-6">
          <p className="font-medium">Persistent workspace required</p>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            This feature records authority, execution evidence, verification, and measured delivery economics. Simulated records would undermine the purpose of the lab.
          </p>
        </Card>
      </div>
    );
  }

  const store = getWorkspace(actor);
  const [specs, runs, workstreams, organizations] = await Promise.all([
    listDelegationSpecs(actor),
    listWorkstreamRuns(actor),
    store.listWorkstreams(actor),
    store.listOrganizations(actor),
  ]);
  const workstreamById = new Map(workstreams.map((workstream) => [workstream.id, workstream]));
  const organizationById = new Map(organizations.map((organization) => [organization.id, organization]));
  const activeSpecs = specs.filter((spec) => spec.status === "active");
  const draftSpecs = specs.filter((spec) => spec.status === "draft");
  const awaiting = runs.filter((run) => run.status === "awaiting_verification");
  const verified = runs.filter((run) => run.status === "verified");

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Execution Lab"
        title="Prove the work before automating it"
        description="A Delegation Spec freezes the objective, authority, proof standard, and exception policy. Runs collect real evidence and economics. Only a verified run receives an Outcome Receipt."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Active specs" value={String(activeSpecs.length)} />
        <Metric label="Draft specs" value={String(draftSpecs.length)} />
        <Metric label="Awaiting verification" value={String(awaiting.length)} />
        <Metric label="Verified runs" value={String(verified.length)} />
      </div>

      {manager ? (
        <Card className="p-6">
          <div className="mb-5">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">New Delegation Spec</p>
            <h2 className="mt-1 text-lg font-semibold">Type the operating contract</h2>
            <p className="mt-1 text-sm text-muted">
              Activation freezes this version. Step 2 does not permit an agent to create or activate these contracts.
            </p>
          </div>
          <form action={createDelegationSpecAction} className="grid gap-5 lg:grid-cols-2">
            <Field label="Workstream">
              <select
                name="workstreamId"
                required
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="">Select workstream</option>
                {workstreams.map((workstream) => (
                  <option key={workstream.id} value={workstream.id}>
                    {organizationById.get(workstream.organizationId)?.name ?? "Organization"} · {workstream.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Action class" hint="This is an authority ceiling, not an autonomy level.">
              <select
                name="actionClass"
                defaultValue="prepare_only"
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
              >
                {ACTION_CLASSES.map((value) => (
                  <option key={value} value={value}>
                    {ACTION_CLASS_COPY[value].label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="lg:col-span-2">
              <Field label="Objective">
                <Input name="objective" required placeholder="What business condition should become true?" />
              </Field>
            </div>
            <Field label="Definition of done" hint="One observable criterion per line.">
              <Textarea name="definitionOfDone" required placeholder={"Every qualified opportunity has an owner\nEvery qualified opportunity has a valid next action"} />
            </Field>
            <Field label="Verification rules" hint="One proof requirement per line.">
              <Textarea name="verificationRules" placeholder={"Re-read every changed CRM record\nRecord the final state as evidence"} />
            </Field>
            <Field label="Trigger / cadence">
              <Input name="triggerDescription" placeholder="Daily at 08:00 and on relevant CRM change" />
            </Field>
            <Field label="SLA">
              <Input name="sla" placeholder="Complete by 09:00 local time" />
            </Field>
            <Field
              label="Economic ceilings (optional)"
              hint="JSON object. Use maxHumanMinutes, maxOwnerMinutes, maxAiCostMicros, or maxToolCostMicros. Existing recording flags remain allowed."
            >
              <Textarea
                name="economicEnvelope"
                placeholder={'{"maxHumanMinutes":60,"maxOwnerMinutes":15,"maxAiCostMicros":500000,"maxToolCostMicros":100000}'}
              />
            </Field>
            <Field label="Required inputs" hint="One system, record set, or source per line.">
              <Textarea name="requiredInputs" placeholder={"HubSpot pipeline\nAccount owner rules"} />
            </Field>
            <Field label="Authority rules" hint="What Delegation Cloud may do inside this spec.">
              <Textarea name="authorityRules" placeholder={"Read CRM\nPrepare changes\nWrite non-destructive internal CRM fields"} />
            </Field>
            <Field label="Approval points" hint="Actions that must stop for explicit approval.">
              <Textarea name="approvalPoints" placeholder={"Send external email\nChange commercial terms"} />
            </Field>
            <Field label="Exception policy" hint="Conditions that stop normal execution and escalate.">
              <Textarea name="exceptionPolicy" placeholder={"Conflicting source data\nMissing owner\nIntegration failure"} />
            </Field>
            <div className="lg:col-span-2">
              <Button type="submit">Create draft spec</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Delegation Specs</h2>
          <p className="text-sm text-muted">Drafts may be activated by an operations manager. Active versions are frozen.</p>
        </div>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {specs.length ? (
            specs.map((spec) => {
              const workstream = spec.workstreamId ? workstreamById.get(spec.workstreamId) : null;
              return (
                <div key={spec.id} className="flex flex-col gap-4 p-5 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={spec.status === "active" ? "good" : spec.status === "draft" ? "warn" : "neutral"}>{spec.status}</Badge>
                      <ActionClassBadge value={spec.actionClass} />
                      <span className="text-xs text-muted">v{spec.version}</span>
                    </div>
                    <p className="mt-2 font-medium">{spec.objective}</p>
                    <p className="mt-1 text-xs text-muted">
                      {organizationById.get(spec.organizationId)?.name ?? spec.organizationId} · {workstream?.name ?? "Unlinked workstream"}
                    </p>
                    <p className="mt-2 text-sm text-muted">
                      Done: {spec.definitionOfDone.length ? spec.definitionOfDone.join(" · ") : "No criteria"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {manager && spec.status === "draft" ? (
                      <form action={activateDelegationSpecAction}>
                        <input type="hidden" name="specId" value={spec.id} />
                        <Button type="submit" variant="secondary" size="sm">Activate</Button>
                      </form>
                    ) : null}
                    {spec.status === "active" ? (
                      <form action={createWorkstreamRunAction}>
                        <input type="hidden" name="specId" value={spec.id} />
                        <Button type="submit" size="sm">Create run</Button>
                      </form>
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-6 text-sm text-muted">No Delegation Specs exist yet.</div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Recent runs</h2>
          <p className="text-sm text-muted">Execution history is measured, evidence-backed, and separate from the existing request lifecycle.</p>
        </div>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {runs.length ? (
            runs.slice(0, 20).map((run) => {
              const spec = specs.find((item) => item.id === run.delegationSpecId);
              return (
                <Link key={run.id} href={`/ops/execution/runs/${run.id}`} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-bg-elevated">
                  <div>
                    <p className="text-sm font-medium">{spec?.objective ?? "Delegated workstream run"}</p>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(run.createdAt).toLocaleString()} · human {run.humanMinutes}m · owner {run.ownerMinutes}m
                    </p>
                  </div>
                  <Badge tone={runTone(run.status)}>{run.status.replaceAll("_", " ")}</Badge>
                </Link>
              );
            })
          ) : (
            <div className="p-6 text-sm text-muted">No workstream runs recorded yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
