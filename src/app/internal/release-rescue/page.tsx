import Link from "next/link";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { logoutInternalOperatorAction, startInternalRunAction } from "@/app/actions/release-rescue-internal";
import { RETENTION_POLICIES } from "@/lib/release-rescue-intake";
import { loadAllowlist } from "@/lib/release-rescue-internal/allowlist";
import { resolveCheckoutHead } from "@/lib/release-rescue-internal/git-source";
import { INTERNAL_PATH, requireOperator } from "@/lib/release-rescue-internal/request-guard";
import { checkoutFor, listRuns, sweepRetention } from "@/lib/release-rescue-internal/store";

const REFUSALS: Record<string, string> = {
  repository_not_allowlisted: "That repository is not on the internal allowlist, so nothing was read.",
  ownership_not_confirmed: "Confirm the repository is ours to review before starting a run.",
  retention_policy_unknown: "Choose one of the offered retention policies.",
};

const STATUS_TONE = {
  blocked: "bad",
  awaiting_review: "warn",
  signed: "good",
  purged: "neutral",
} as const;

export default async function InternalReleaseRescuePage({
  searchParams,
}: {
  searchParams: Promise<{ refused?: string }>;
}) {
  const operator = await requireOperator();
  // Retention is applied every time the list is read, so nothing outlives its
  // deadline because nobody ran the sweep.
  sweepRetention();
  const { refused } = await searchParams;
  const allowlist = loadAllowlist();
  const targets = await Promise.all(
    allowlist.repositories.map(async (entry) => {
      const checkout = checkoutFor(entry.repositoryRef);
      const head = checkout ? await resolveCheckoutHead(checkout, entry.defaultBranch) : null;
      return { entry, checkout, head };
    }),
  );
  const runs = listRuns();

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Release Rescue, internal</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Signed in as <strong>{operator.displayName}</strong>.
          </p>
        </div>
        <form action={logoutInternalOperatorAction}>
          <Button type="submit" variant="secondary">
            Sign out
          </Button>
        </form>
      </header>

      {refused ? (
        <p className="rounded-md bg-bad-bg px-3 py-2 text-sm text-bad" role="alert">
          {REFUSALS[refused] ?? "The run was refused."}
        </p>
      ) : null}

      <section aria-labelledby="start-heading" className="space-y-4">
        <h2 id="start-heading" className="text-lg font-semibold">
          Start a review
        </h2>
        <p className="text-sm text-ink-soft">
          One repository, one application and one critical workflow per review, read read-only from a local clone at
          one pinned commit. Only allowlisted repositories appear here.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {targets.map(({ entry, checkout, head }) => (
            <Card key={entry.repositoryRef} className="p-4">
              <h3 className="font-semibold">{entry.repositoryRef}</h3>
              <p className="mt-1 text-xs text-ink-soft">
                {entry.application.name}: {entry.criticalWorkflow.name}
              </p>
              {checkout ? (
                <form action={startInternalRunAction} className="mt-4 space-y-3">
                  <input type="hidden" name="repositoryRef" value={entry.repositoryRef} />
                  <div>
                    <Label htmlFor={`sha-${entry.repositoryRef}`}>Commit to review (full sha)</Label>
                    <Input
                      id={`sha-${entry.repositoryRef}`}
                      name="commitSha"
                      defaultValue={head ?? ""}
                      pattern="[0-9a-f]{40}"
                      required
                      className="font-mono text-xs"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`retention-${entry.repositoryRef}`}>Retention after delivery</Label>
                    <select
                      id={`retention-${entry.repositoryRef}`}
                      name="retentionPolicy"
                      defaultValue="minimum_7_day"
                      className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-2 text-sm"
                    >
                      {RETENTION_POLICIES.map((policy) => (
                        <option key={policy} value={policy}>
                          {policy}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" name="ownershipConfirmed" value="yes" required className="mt-1" />
                    <span>This repository is ours, and I am authorized to review it.</span>
                  </label>
                  <Button type="submit">Run review</Button>
                </form>
              ) : (
                <p className="mt-4 text-sm text-warn">
                  BLOCKED: no local clone configured. Run{" "}
                  <code className="text-xs">npm run rr:local -- checkout:set {entry.repositoryRef} /path/to/clone</code>
                </p>
              )}
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="runs-heading" className="space-y-3">
        <h2 id="runs-heading" className="text-lg font-semibold">
          Runs
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-ink-soft">No runs yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-2">Repository</th>
                <th>Commit</th>
                <th>Status</th>
                <th>Verdict</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.runId} className="border-t border-line">
                  <td className="py-2">
                    <Link className="underline underline-offset-4" href={`${INTERNAL_PATH}/runs/${run.runId}`}>
                      {run.repositoryRef}
                    </Link>
                  </td>
                  <td className="font-mono text-xs">{run.commitSha?.slice(0, 12) ?? "none"}</td>
                  <td>
                    <Badge tone={STATUS_TONE[run.status]}>{run.status.replace("_", " ")}</Badge>
                  </td>
                  <td>{run.accounting.verdict ?? "none"}</td>
                  <td className="text-xs">{run.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
