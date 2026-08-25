import Link from "next/link";
import {
  addGauntletImpactAssessmentAction,
  addGauntletObservationAction,
  addGauntletReviewAction,
  applyAutonomyDecisionAction,
  classifyGauntletFailureAction,
  createGauntletAttemptAction,
  diagnoseGauntletCycleAction,
  evaluateGauntletAutonomyAction,
  issueGauntletReceiptAction,
  resolveAndRetryGauntletFailureAction,
  updateAutonomyPolicyAction,
} from "@/app/actions/gauntlet";
import { PageHeader } from "@/components/product";
import { Badge, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { requireOps } from "@/lib/auth";
import { FAILURE_CLASSIFICATIONS, RETRY_DECISIONS } from "@/lib/gauntlet-policy";
import { getGauntletCycleBundle } from "@/lib/gauntlet";
import { getRunWorkCell } from "@/lib/work-cell";
import { correctiveActionFromPacket } from "@/lib/work-cell-operator";

export const metadata = { title: "Gauntlet cycle" };

type Row = Record<string, unknown>;

function tone(status: string): "good" | "bad" | "warn" | "info" | "neutral" {
  if (status === "closed" || status === "verified" || status === "passed") return "good";
  if (status === "suspended" || status === "failed" || status === "corrective_action") return "bad";
  if (status === "verification" || status === "impact_review" || status === "autonomy_review" || status === "awaiting_verification") return "warn";
  if (status === "executing" || status === "running") return "info";
  return "neutral";
}

function text(row: Row | null | undefined, key: string) {
  return row?.[key] === null || row?.[key] === undefined ? "" : String(row[key]);
}

function list(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

export default async function GauntletCyclePage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOps();
  const manager = actor.role === "ops_manager" || actor.role === "platform_admin";
  const { id } = await params;

  if (actor.source === "demo") {
    return (
      <div className="space-y-6">
        <PageHeader kicker="Gauntlet" title="Persistent workspace required" />
        <Link href="/ops/gauntlet" className="text-sm text-accent hover:underline">Back to Gauntlet</Link>
      </div>
    );
  }

  const bundle = await getGauntletCycleBundle(actor, id);
  const { cycle, profile } = bundle;
  const observations = bundle.observations as Row[];
  const diagnosis = bundle.diagnosis as Row | null;
  const runs = bundle.runs as Row[];
  const reviews = bundle.reviews as Row[];
  const failures = bundle.failures as Row[];
  const impact = bundle.impact as Row | null;
  const decisions = bundle.decisions as Row[];
  const executorAssignments = bundle.executorAssignments as Row[];
  const latestRun = runs.at(-1);
  const latestRunId = text(latestRun, "id");
  const latestRunStatus = text(latestRun, "status");
  const latestReview = reviews.filter((review) => text(review, "run_id") === latestRunId).at(-1);
  const latestRunHasWorkCell = executorAssignments.some((assignment) => text(assignment, "run_id") === latestRunId);
  const openFailure = failures.find((failure) => text(failure, "status") === "open");
  const proposedDecision = decisions.find((decision) => text(decision, "status") === "proposed");
  const failureRunId = text(openFailure, "run_id");
  const workCell =
    cycle.status === "corrective_action" && failureRunId ? await getRunWorkCell(actor, failureRunId) : null;
  const derived =
    workCell?.packet
      ? correctiveActionFromPacket({
          packet: workCell.packet.payload,
          review: workCell.review?.payload,
          frozenRecords: Object.fromEntries(
            (workCell.manifest?.inputRecords ?? []).map((entry) => [entry.productId, { id: entry.productId, ...entry.record }]),
          ),
        })
      : null;
  const AUTO_ROOT_CAUSE = "Terminal Gauntlet attempt has not yet been classified.";
  const AUTO_CORRECTIVE = "Classify the failure before deciding whether and how to retry.";
  const storedClassification = text(openFailure, "classification");
  const unclassified = !storedClassification || storedClassification === "unknown";
  const classificationDefault = unclassified
    ? (derived?.classification ?? storedClassification)
    : storedClassification;
  const retryDefault = unclassified
    ? ((derived?.retryDecision ?? text(openFailure, "retry_decision")) || "")
    : (text(openFailure, "retry_decision") || derived?.retryDecision || "");
  const storedRoot = text(openFailure, "root_cause");
  const rootCauseDefault =
    storedRoot && storedRoot !== AUTO_ROOT_CAUSE ? storedRoot : (derived?.reason || storedRoot);
  const storedCorrective = text(openFailure, "corrective_action");
  const derivedCorrective = derived
    ? [
        derived.reason,
        derived.droppedProductIds.length ? `Drop from freeze: ${derived.droppedProductIds.join(", ")}.` : "",
        derived.nextProductIds.length ? `Later freeze: ${derived.nextProductIds.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : "";
  const correctiveDefault =
    storedCorrective && storedCorrective !== AUTO_CORRECTIVE ? storedCorrective : (derivedCorrective || storedCorrective);

  const stages = ["observing", "executing", "verification", "corrective_action", "impact_review", "autonomy_review", "closed"];

  return (
    <div className="space-y-8">
      <PageHeader
        kicker={`Gauntlet cycle ${cycle.sequence}`}
        title={cycle.objectiveSnapshot}
        description={`Cycle ${cycle.id} · ${cycle.recurrenceMode} re-entry · Delegation Spec ${cycle.delegationSpecId}`}
        actions={<Link href="/ops/gauntlet" className="text-sm text-accent hover:underline">Back to Gauntlet</Link>}
      />

      <div className="flex flex-wrap gap-2">
        {stages.map((stage) => (
          <Badge key={stage} tone={stage === cycle.status ? tone(stage) : "neutral"}>{stage.replaceAll("_", " ")}</Badge>
        ))}
        {cycle.status === "suspended" ? <Badge tone="bad">suspended</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Current stage</p>
          <p className="mt-2 text-xl font-semibold">{cycle.status.replaceAll("_", " ")}</p>
          <p className="mt-2 text-sm text-muted">The database enforces stage order. A UI action cannot skip required evidence.</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Autonomy</p>
          <p className="mt-2 text-xl font-semibold">{profile ? `Level ${profile.currentLevel}` : "Level 0"}</p>
          <p className="mt-2 text-sm text-muted">{profile?.state ?? "active"} · promotion is approval-gated unless this workstream explicitly proves otherwise.</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Attempts</p>
          <p className="mt-2 text-xl font-semibold">{runs.length}</p>
          <p className="mt-2 text-sm text-muted">{failures.length} failure case{failures.length === 1 ? "" : "s"} recorded.</p>
        </Card>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">1. Observe and diagnose</h2>
          <p className="text-sm text-muted">Execution cannot begin until at least one observation exists and the diagnosis is locked.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <p className="font-medium">Observations</p>
            <div className="mt-3 space-y-3">
              {observations.length ? observations.map((observation) => (
                <div key={text(observation, "id")} className="rounded-lg border border-line p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">{text(observation, "signal_type")}</p>
                  <p className="mt-1 text-sm">{text(observation, "summary")}</p>
                  {text(observation, "source_uri") ? <p className="mt-1 break-all text-xs text-muted">{text(observation, "source_uri")}</p> : null}
                </div>
              )) : <p className="text-sm text-muted">No observations yet.</p>}
            </div>
            {cycle.status === "observing" ? (
              <form action={addGauntletObservationAction} className="mt-5 space-y-4 border-t border-line pt-4">
                <input type="hidden" name="cycleId" value={cycle.id} />
                <Field label="Signal type"><Input name="signalType" required placeholder="analytics, source change, customer signal, defect" /></Field>
                <Field label="Observation"><Textarea name="summary" required placeholder="What changed or what condition did we observe?" /></Field>
                <Field label="Source URI"><Input name="sourceUri" placeholder="https://..." /></Field>
                <Field label="Structured payload" hint="Optional JSON object"><Textarea name="payload" placeholder='{"metric":"stale_claims","value":195}' /></Field>
                <Button type="submit" size="sm">Add observation</Button>
              </form>
            ) : null}
          </Card>

          <Card className="p-5">
            <p className="font-medium">Locked diagnosis</p>
            {diagnosis ? (
              <div className="mt-3 space-y-3 text-sm">
                <div><span className="text-muted">Diagnosis: </span>{text(diagnosis, "diagnosis")}</div>
                <div><span className="text-muted">Binding constraint: </span>{text(diagnosis, "binding_constraint")}</div>
                <div><span className="text-muted">Selected action: </span>{text(diagnosis, "selected_action")}</div>
                <div><span className="text-muted">Hypothesis: </span>{text(diagnosis, "hypothesis")}</div>
              </div>
            ) : cycle.status === "observing" ? (
              <form action={diagnoseGauntletCycleAction} className="mt-4 space-y-4">
                <input type="hidden" name="cycleId" value={cycle.id} />
                <Field label="Diagnosis"><Textarea name="diagnosis" required placeholder="What does the evidence say is happening?" /></Field>
                <Field label="Binding constraint"><Input name="bindingConstraint" required placeholder="The specific constraint limiting the outcome" /></Field>
                <Field label="Selected action"><Textarea name="selectedAction" required placeholder="Smallest evidence-backed action to test" /></Field>
                <Field label="Hypothesis"><Textarea name="hypothesis" required placeholder="If we do X, Y should improve without violating Z." /></Field>
                <Field label="Evidence references" hint="One reference per line"><Textarea name="evidenceRefs" /></Field>
                <Button type="submit">Lock diagnosis and enter execution</Button>
              </form>
            ) : <p className="mt-3 text-sm text-muted">No diagnosis was recorded.</p>}
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">2. Execute and collect proof</h2>
          <p className="text-sm text-muted">Each retry is a new immutable attempt. Workstream execution still uses the existing evidence-bearing Execution Lab.</p>
        </div>
        <Card className="p-5">
          <div className="space-y-3">
            {runs.length ? runs.map((run) => {
              const cell = executorAssignments.filter((assignment) => text(assignment, "run_id") === text(run, "id"));
              return (
                <Link key={text(run, "id")} href={`/ops/execution/runs/${text(run, "id")}`} className="block rounded-lg border border-line px-4 py-3 hover:bg-bg-elevated">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">Attempt {text(run, "attempt_number")}</p>
                      <p className="mt-1 text-xs text-muted">Run {text(run, "id")} {text(run, "retry_of_run_id") ? `· retry of ${text(run, "retry_of_run_id")}` : ""}</p>
                    </div>
                    <Badge tone={tone(text(run, "status"))}>{text(run, "status").replaceAll("_", " ")}</Badge>
                  </div>
                  {cell.length ? (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                      <span className="text-xs uppercase tracking-wide text-muted">Work cell</span>
                      {cell.map((assignment) => {
                        const profile = assignment.executor_profiles as Row | null;
                        return (
                          <Badge key={`${text(assignment, "run_id")}-${text(assignment, "phase")}`} tone={tone(text(assignment, "status"))}>
                            {text(assignment, "phase")}: {profile ? text(profile, "key") : text(assignment, "executor_profile_id")}
                          </Badge>
                        );
                      })}
                    </div>
                  ) : null}
                </Link>
              );
            }) : <p className="text-sm text-muted">No execution attempt yet.</p>}
          </div>
          {cycle.status === "executing" ? (
            <form action={createGauntletAttemptAction} className="mt-4">
              <input type="hidden" name="cycleId" value={cycle.id} />
              <Button type="submit">Create governed attempt</Button>
            </form>
          ) : null}
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">3. Adversarial verification</h2>
          <p className="text-sm text-muted">A passing Gauntlet Outcome Receipt is database-blocked until an independent hard-gate review passes.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <p className="font-medium">Review history</p>
            <div className="mt-3 space-y-3">
              {reviews.length ? reviews.map((review) => (
                <div key={text(review, "id")} className="rounded-lg border border-line p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">{text(review, "reviewer_kind")} · {text(review, "reviewer_ref") || "unnamed verifier"}</span>
                    <Badge tone={text(review, "hard_gate_pass") === "true" ? "good" : "bad"}>{text(review, "verdict")}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted">{text(review, "notes")}</p>
                  {list(review.authority_incidents).length ? <p className="mt-2 text-xs text-bad">Authority incidents: {list(review.authority_incidents).length}</p> : null}
                </div>
              )) : <p className="text-sm text-muted">No adversarial review recorded.</p>}
            </div>
            {cycle.status === "verification" && latestRunStatus === "awaiting_verification" && latestRunHasWorkCell ? (
              <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
                This attempt is executed by a work cell. A run holds exactly one Gauntlet review, and on a work-cell run
                that slot belongs to the deterministic verdict — recording a separate review here would take it and leave
                the attempt unverifiable. Record findings in the Work Cell on the run page instead.
              </p>
            ) : null}

            {cycle.status === "verification" && latestRunStatus === "awaiting_verification" && !latestRunHasWorkCell ? (
              <form action={addGauntletReviewAction} className="mt-5 space-y-4 border-t border-line pt-4">
                <input type="hidden" name="cycleId" value={cycle.id} />
                <input type="hidden" name="runId" value={latestRunId} />
                <Field label="Reviewer type">
                  <select name="reviewerKind" defaultValue="human" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm">
                    <option value="human">Human</option><option value="deterministic">Deterministic</option><option value="agent">Agent</option><option value="hybrid">Hybrid</option>
                  </select>
                </Field>
                <Field label="Reviewer reference"><Input name="reviewerRef" placeholder="QA worker, CI gate, blind evaluator" /></Field>
                <Field label="Verdict">
                  <select name="verdict" defaultValue="inconclusive" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm">
                    <option value="inconclusive">Inconclusive</option><option value="passed">Passed</option><option value="failed">Failed</option>
                  </select>
                </Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hardGatePass" /> Hard safety/truth gate passed</label>
                <Field label="Challenged assumptions" hint="One per line"><Textarea name="challengedAssumptions" /></Field>
                <Field label="Defects" hint='JSON array, e.g. [{"severity":"high","finding":"..."}]'><Textarea name="defects" placeholder="[]" /></Field>
                <Field label="Evidence gaps" hint="One per line"><Textarea name="evidenceGaps" /></Field>
                <Field label="Authority incidents" hint="JSON array. Any item forces hard gate failure."><Textarea name="authorityIncidents" placeholder="[]" /></Field>
                <Field label="Review notes"><Textarea name="notes" /></Field>
                <Button type="submit">Record independent review</Button>
              </form>
            ) : null}
          </Card>

          <Card className="p-5">
            <p className="font-medium">Outcome Receipt</p>
            {cycle.status === "verification" && latestReview && manager ? (
              <form action={issueGauntletReceiptAction} className="mt-4 space-y-4">
                <input type="hidden" name="cycleId" value={cycle.id} />
                <input type="hidden" name="runId" value={latestRunId} />
                <Field label="Verification result">
                  <select name="verificationStatus" defaultValue={text(latestReview, "hard_gate_pass") === "true" ? "passed" : "failed"} className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm">
                    <option value="passed">Passed</option><option value="failed">Failed</option>
                  </select>
                </Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="definitionOfDoneMet" /> Definition of done met</label>
                <Field label="Summary"><Textarea name="summary" required /></Field>
                <Field label="Verification notes"><Textarea name="verificationNotes" /></Field>
                <Field label="Actions taken" hint="One per line"><Textarea name="actionsTaken" /></Field>
                <Field label="Exceptions" hint="One per line"><Textarea name="exceptions" /></Field>
                <Field label="Unresolved decisions" hint="One per line"><Textarea name="unresolvedDecisions" /></Field>
                <Field label="QA score"><Input name="qaScore" type="number" min="0" max="100" step="0.1" /></Field>
                <Button type="submit">Issue immutable receipt</Button>
              </form>
            ) : <p className="mt-3 text-sm text-muted">A manager can issue the receipt after independent review. Passing is blocked at the database boundary without a clean hard gate.</p>}
          </Card>
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">4. Corrective action</h2>
          <p className="text-sm text-muted">Terminal failed attempts automatically create an unclassified failure case. Classification determines the retry strategy.</p>
        </div>
        <Card className="p-5">
          {failures.length ? (
            <div className="space-y-4">
              {failures.map((failure) => (
                <div key={text(failure, "id")} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={text(failure, "status") === "open" ? "bad" : "good"}>{text(failure, "status")}</Badge>
                    <span className="text-sm font-medium">{text(failure, "classification")}</span>
                    <span className="text-xs text-muted">{text(failure, "severity")}</span>
                  </div>
                  <p className="mt-2 text-sm">{text(failure, "root_cause")}</p>
                  <p className="mt-1 text-sm text-muted">{text(failure, "corrective_action")}</p>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted">No failure cases.</p>}

          {cycle.status === "corrective_action" && openFailure ? (
            <div className="mt-5 grid gap-5 border-t border-line pt-5 lg:grid-cols-2">
              <form action={classifyGauntletFailureAction} className="space-y-4">
                <input type="hidden" name="cycleId" value={cycle.id} />
                <input type="hidden" name="failureId" value={text(openFailure, "id")} />
                <Field label="Classification">
                  <select name="classification" defaultValue={classificationDefault} className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm">
                    {FAILURE_CLASSIFICATIONS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
                  </select>
                </Field>
                <Field label="Severity">
                  <select name="severity" defaultValue={text(openFailure, "severity") || "medium"} className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm">
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                  </select>
                </Field>
                <Field label="Retry decision" hint="Work-cell identity mismatch prefills escalate human. Leave blank to derive from failure class.">
                  <select name="retryDecision" defaultValue={retryDefault} className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm">
                    <option value="">Derive automatically</option>{RETRY_DECISIONS.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
                  </select>
                </Field>
                <Field label="Root cause"><Textarea name="rootCause" required defaultValue={rootCauseDefault} /></Field>
                <Field label="Corrective action"><Textarea name="correctiveAction" required defaultValue={correctiveDefault} /></Field>
                {derived ? (
                  <p className="text-xs text-muted">
                    Prefills from the frozen work-cell packet. Not written until you submit. Does not retry Hermes on identity mismatch. No Loadout write.
                  </p>
                ) : null}
                <Button type="submit" variant="secondary">Update classification</Button>
              </form>
              <div>
                <p className="font-medium">Retry after correction</p>
                <p className="mt-2 text-sm text-muted">Resolve this failure and create a new immutable attempt. The failed attempt remains in history.</p>
                <form action={resolveAndRetryGauntletFailureAction} className="mt-4">
                  <input type="hidden" name="cycleId" value={cycle.id} />
                  <input type="hidden" name="failureId" value={text(openFailure, "id")} />
                  <input type="hidden" name="runId" value={text(openFailure, "run_id")} />
                  <Button type="submit">Resolve and create retry</Button>
                </form>
              </div>
            </div>
          ) : null}
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">5. Business-impact verification</h2>
          <p className="text-sm text-muted">Technical correctness is not business success. A verified run must still show whether the target condition improved, stayed flat, regressed, or remains inconclusive.</p>
        </div>
        <Card className="p-5">
          {impact ? (
            <div className="space-y-2 text-sm">
              <Badge tone={text(impact, "direction") === "improved" ? "good" : text(impact, "direction") === "regressed" ? "bad" : "warn"}>{text(impact, "direction")}</Badge>
              <p className="mt-2 font-medium">{text(impact, "primary_metric")}</p>
              <p className="text-muted">{text(impact, "interpretation")}</p>
              <p className="text-xs text-muted">Evidence quality: {text(impact, "evidence_quality")}</p>
            </div>
          ) : cycle.status === "impact_review" && manager ? (
            <form action={addGauntletImpactAssessmentAction} className="grid gap-4 lg:grid-cols-2">
              <input type="hidden" name="cycleId" value={cycle.id} />
              <Field label="Direction"><select name="direction" defaultValue="inconclusive" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm"><option value="improved">Improved</option><option value="neutral">Neutral</option><option value="regressed">Regressed</option><option value="inconclusive">Inconclusive</option></select></Field>
              <Field label="Evidence quality"><select name="evidenceQuality" defaultValue="weak" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm"><option value="weak">Weak</option><option value="moderate">Moderate</option><option value="strong">Strong</option></select></Field>
              <Field label="Hypothesis"><Textarea name="hypothesis" required defaultValue={text(diagnosis, "hypothesis")} /></Field>
              <Field label="Primary metric"><Input name="primaryMetric" required placeholder="Verified claim coverage, conversion, response latency..." /></Field>
              <Field label="Baseline" hint="JSON object"><Textarea name="baseline" required placeholder='{"value":195,"unit":"unverified claims"}' /></Field>
              <Field label="Observed" hint="JSON object"><Textarea name="observed" required placeholder='{"value":180,"unit":"unverified claims"}' /></Field>
              <Field label="Delta" hint="JSON object"><Textarea name="delta" required placeholder='{"absolute":-15}' /></Field>
              <Field label="Guardrails" hint="JSON array"><Textarea name="guardrails" placeholder="[]" /></Field>
              <Field label="Evidence refs" hint="One per line"><Textarea name="evidenceRefs" /></Field>
              <Field label="Interpretation"><Textarea name="interpretation" required /></Field>
              <div className="lg:col-span-2"><Button type="submit">Record impact assessment</Button></div>
            </form>
          ) : <p className="text-sm text-muted">Impact review opens only after a Gauntlet run receives a passing Outcome Receipt.</p>}
        </Card>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">6. Autonomy controller and re-entry</h2>
          <p className="text-sm text-muted">Authority incidents suspend automatically. Hard-gate failures and business regressions can demote automatically. Promotion remains workstream-specific and approval-gated by default.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <p className="font-medium">Policy</p>
            {profile ? (
              <>
                <p className="mt-2 text-sm text-muted">Level {profile.currentLevel} of {profile.maxLevel} · {profile.state} · policy v{profile.policyVersion}</p>
                {manager ? (
                  <form action={updateAutonomyPolicyAction} className="mt-4 space-y-4">
                    <input type="hidden" name="cycleId" value={cycle.id} />
                    <input type="hidden" name="profileId" value={profile.id} />
                    <Field label="Minimum verified runs"><Input name="minimumVerifiedRunsForPromotion" type="number" min="1" defaultValue={profile.policy.minimumVerifiedRunsForPromotion ?? ""} /></Field>
                    <Field label="Minimum average QA"><Input name="minimumQaScore" type="number" min="0" max="100" step="0.1" defaultValue={profile.policy.minimumQaScore ?? ""} /></Field>
                    <Field label="Maximum failure rate" hint="0 to 1"><Input name="maximumFailureRate" type="number" min="0" max="1" step="0.01" defaultValue={profile.policy.maximumFailureRate ?? ""} /></Field>
                    <Field label="Maximum exception rate" hint="0 to 1"><Input name="maximumExceptionRate" type="number" min="0" max="1" step="0.01" defaultValue={profile.policy.maximumExceptionRate ?? ""} /></Field>
                    <Field label="Maximum owner minutes per run"><Input name="maximumOwnerMinutesPerRun" type="number" min="0" step="0.1" defaultValue={profile.policy.maximumOwnerMinutesPerRun ?? ""} /></Field>
                    <div className="space-y-2 text-sm">
                      <label className="flex items-center gap-2"><input type="checkbox" name="requireImprovedImpactForPromotion" defaultChecked={profile.policy.requireImprovedImpactForPromotion} /> Require improved impact to promote</label>
                      <label className="flex items-center gap-2"><input type="checkbox" name="promotionRequiresApproval" defaultChecked={profile.policy.promotionRequiresApproval} /> Promotion requires manager approval</label>
                      <label className="flex items-center gap-2"><input type="checkbox" name="allowAutomaticPromotion" defaultChecked={profile.policy.allowAutomaticPromotion} /> Allow automatic promotion</label>
                      <label className="flex items-center gap-2"><input type="checkbox" name="autoDemoteOnHardGateFailure" defaultChecked={profile.policy.autoDemoteOnHardGateFailure} /> Auto-demote on hard-gate failure</label>
                      <label className="flex items-center gap-2"><input type="checkbox" name="autoDemoteOnRegression" defaultChecked={profile.policy.autoDemoteOnRegression} /> Auto-demote on business regression</label>
                      <label className="flex items-center gap-2"><input type="checkbox" name="autoSuspendOnAuthorityIncident" defaultChecked={profile.policy.autoSuspendOnAuthorityIncident} /> Auto-suspend on authority incident</label>
                    </div>
                    <Button type="submit" variant="secondary">Save workstream policy</Button>
                  </form>
                ) : null}
              </>
            ) : <p className="mt-2 text-sm text-muted">No autonomy profile.</p>}
          </Card>

          <Card className="p-5">
            <p className="font-medium">Decision history</p>
            <div className="mt-3 space-y-3">
              {decisions.length ? decisions.map((decision) => (
                <div key={text(decision, "id")} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={text(decision, "decision") === "promote" ? "good" : text(decision, "decision") === "suspend" || text(decision, "decision") === "demote" ? "bad" : "neutral"}>{text(decision, "decision")}</Badge>
                    <span className="text-sm">L{text(decision, "from_level")} → L{text(decision, "to_level")}</span>
                    <span className="text-xs text-muted">{text(decision, "status")}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">{text(decision, "reason")}</p>
                </div>
              )) : <p className="text-sm text-muted">No autonomy decision yet.</p>}
            </div>

            {cycle.status === "autonomy_review" && manager && !proposedDecision && decisions.length === 0 ? (
              <form action={evaluateGauntletAutonomyAction} className="mt-5 border-t border-line pt-4">
                <input type="hidden" name="cycleId" value={cycle.id} />
                <Button type="submit">Evaluate autonomy evidence</Button>
              </form>
            ) : null}

            {cycle.status === "autonomy_review" && manager && proposedDecision ? (
              <form action={applyAutonomyDecisionAction} className="mt-5 border-t border-line pt-4">
                <input type="hidden" name="cycleId" value={cycle.id} />
                <input type="hidden" name="decisionId" value={text(proposedDecision, "id")} />
                <p className="mb-3 text-sm text-muted">This promotion is evidence-eligible but approval-gated. Applying it closes this cycle; recurring/event workstreams automatically create the next observation cycle.</p>
                <Button type="submit">Approve and apply decision</Button>
              </form>
            ) : null}

            {cycle.status === "closed" && cycle.recurrenceMode !== "manual" ? (
              <p className="mt-5 border-t border-line pt-4 text-sm text-muted">Cycle closed. The database creates the next observation cycle automatically for this {cycle.recurrenceMode} workstream.</p>
            ) : null}
            {cycle.status === "suspended" ? (
              <p className="mt-5 border-t border-line pt-4 text-sm text-bad">Autonomy and re-entry are suspended. Recovery requires an explicit governance decision; the system will not brute-force through the incident.</p>
            ) : null}
          </Card>
        </div>
      </section>
    </div>
  );
}
