import Link from "next/link";
import { createGauntletCycleAction } from "@/app/actions/gauntlet";
import { Metric, PageHeader } from "@/components/product";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { listDelegationSpecs } from "@/lib/execution-primitives";
import { listAutonomyProfiles, listGauntletCycles } from "@/lib/gauntlet";
import { getWorkspace } from "@/lib/workspace";

export const metadata = { title: "Gauntlet Control" };

function tone(status: string): "good" | "bad" | "warn" | "info" | "neutral" {
  if (status === "closed") return "good";
  if (status === "suspended" || status === "corrective_action") return "bad";
  if (status === "verification" || status === "impact_review" || status === "autonomy_review") return "warn";
  if (status === "executing") return "info";
  return "neutral";
}

export default async function GauntletPage() {
  const actor = await requireOps();
  const manager = actor.role === "ops_manager" || actor.role === "platform_admin";

  if (actor.source === "demo") {
    return (
      <div className="space-y-8">
        <PageHeader
          kicker="Gauntlet Control"
          title="Close the loop from observation to earned autonomy"
          description="The Gauntlet is intentionally persistent-only because its job is to preserve evidence, failures, impact, and autonomy history."
        />
        <Card className="p-6">
          <p className="font-medium">Persistent workspace required</p>
          <p className="mt-2 text-sm text-muted">Demo records cannot be used as autonomy evidence.</p>
        </Card>
      </div>
    );
  }

  const store = getWorkspace(actor);
  const [cycles, profiles, specs, workstreams, organizations] = await Promise.all([
    listGauntletCycles(actor),
    listAutonomyProfiles(actor),
    listDelegationSpecs(actor),
    store.listWorkstreams(actor),
    store.listOrganizations(actor),
  ]);
  const activeSpecs = specs.filter((spec) => spec.status === "active");
  const workstreamById = new Map(workstreams.map((workstream) => [workstream.id, workstream]));
  const orgById = new Map(organizations.map((organization) => [organization.id, organization]));
  const openCycles = cycles.filter((cycle) => !["closed", "suspended"].includes(cycle.status));
  const corrective = cycles.filter((cycle) => cycle.status === "corrective_action");
  const suspended = profiles.filter((profile) => profile.state === "suspended");
  const highAutonomy = profiles.filter((profile) => profile.currentLevel >= 2);

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Gauntlet Control"
        title="Every outcome re-enters evidence"
        description="Observe the business condition, lock the diagnosis, execute under a Delegation Spec, challenge the result, measure impact, then hold, promote, demote, or suspend autonomy. Recurring workstreams re-enter observation automatically after a closed cycle."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label="Open cycles" value={String(openCycles.length)} />
        <Metric label="Corrective action" value={String(corrective.length)} />
        <Metric label="Suspended profiles" value={String(suspended.length)} />
        <Metric label="Level 2+ profiles" value={String(highAutonomy.length)} />
      </div>

      {manager ? (
        <Card className="p-6">
          <div className="mb-5">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">New cycle</p>
            <h2 className="mt-1 text-lg font-semibold">Start with observation, not execution</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted">
              A cycle can only use an active Delegation Spec. Creating the cycle grants no new authority and does not start a workstream run.
            </p>
          </div>
          <form action={createGauntletCycleAction} className="grid gap-5 lg:grid-cols-2">
            <Field label="Active Delegation Spec">
              <select
                name="delegationSpecId"
                required
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="">Select spec</option>
                {activeSpecs.map((spec) => {
                  const workstream = spec.workstreamId ? workstreamById.get(spec.workstreamId) : null;
                  return (
                    <option key={spec.id} value={spec.id}>
                      {orgById.get(spec.organizationId)?.name ?? "Organization"} · {workstream?.name ?? "Workstream"} · v{spec.version}
                    </option>
                  );
                })}
              </select>
            </Field>
            <Field label="Re-entry mode" hint="Recurring/event cycles create the next observation cycle only after impact and autonomy review close cleanly.">
              <select
                name="recurrenceMode"
                defaultValue="manual"
                className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent"
              >
                <option value="manual">Manual</option>
                <option value="recurring">Recurring</option>
                <option value="event">Event-driven</option>
              </select>
            </Field>
            <div className="lg:col-span-2">
              <Field label="Initial hypothesis" hint="Optional. The locked diagnosis later records the actual selected hypothesis.">
                <Input name="hypothesis" placeholder="If we repair the binding constraint, the target business metric should improve without violating guardrails." />
              </Field>
            </div>
            <div className="lg:col-span-2">
              <Button type="submit">Create observation cycle</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Cycles</h2>
          <p className="text-sm text-muted">A passed technical run is only the middle of a Gauntlet cycle, not the end.</p>
        </div>
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {cycles.length ? (
            cycles.slice(0, 30).map((cycle) => {
              const workstream = workstreamById.get(cycle.workstreamId);
              return (
                <Link
                  key={cycle.id}
                  href={`/ops/gauntlet/cycles/${cycle.id}`}
                  className="flex flex-col gap-3 px-5 py-4 hover:bg-bg-elevated sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={tone(cycle.status)}>{cycle.status.replaceAll("_", " ")}</Badge>
                      <span className="text-xs text-muted">cycle {cycle.sequence}</span>
                      <span className="text-xs text-muted">{cycle.recurrenceMode}</span>
                    </div>
                    <p className="mt-2 text-sm font-medium">{workstream?.name ?? cycle.workstreamId}</p>
                    <p className="mt-1 max-w-3xl text-sm text-muted">{cycle.objectiveSnapshot}</p>
                  </div>
                  <span className="text-xs text-muted">{new Date(cycle.createdAt).toLocaleString()}</span>
                </Link>
              );
            })
          ) : (
            <div className="p-6 text-sm text-muted">No Gauntlet cycles yet.</div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Autonomy profiles</h2>
          <p className="text-sm text-muted">Authority and autonomy are separate. Promotion thresholds are workstream-specific and unset by default.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {profiles.length ? (
            profiles.map((profile) => {
              const workstream = workstreamById.get(profile.workstreamId);
              return (
                <Card key={profile.id} className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium">{workstream?.name ?? profile.workstreamId}</p>
                      <p className="mt-1 text-xs text-muted">{orgById.get(profile.organizationId)?.name ?? profile.organizationId}</p>
                    </div>
                    <Badge tone={profile.state === "suspended" ? "bad" : "good"}>{profile.state}</Badge>
                  </div>
                  <div className="mt-4 flex items-end gap-2">
                    <span className="text-3xl font-semibold">L{profile.currentLevel}</span>
                    <span className="pb-1 text-sm text-muted">of L{profile.maxLevel}</span>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Promotion: {profile.policy.minimumVerifiedRunsForPromotion === null ? "thresholds not configured" : "configured"} · policy v{profile.policyVersion}
                  </p>
                </Card>
              );
            })
          ) : (
            <Card className="p-6 text-sm text-muted">Autonomy profiles are created with the first Gauntlet cycle.</Card>
          )}
        </div>
      </section>
    </div>
  );
}
