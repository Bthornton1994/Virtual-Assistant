import Link from "next/link";
import { Suspense } from "react";
import {
  addEvidenceArtifactAction,
  startWorkstreamRunAction,
  submitWorkstreamRunAction,
  verifyWorkstreamRunAction,
} from "@/app/actions/execution";
import { ActionClassBadge, PageHeader } from "@/components/product";
import { Badge, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { WorkCellSection } from "@/components/work-cell";
import { requireOps } from "@/lib/auth";
import { checkEconomicEnvelope } from "@/lib/economic-envelope";
import { getWorkstreamRunBundle } from "@/lib/execution-primitives";
import { getRunWorkCell } from "@/lib/work-cell";
import {
  correctiveActionFromPacket,
  draftWorkCellReceipt,
  receiptFormDefaults,
  workCellSubmitDefaults,
} from "@/lib/work-cell-operator";

export const metadata = { title: "Execution run" };

function RunPageFallback() {
  return (
    <div className="space-y-6">
      <PageHeader kicker="Execution run" title="Loading run…" description="Refreshing the work cell after the last save." />
      <Card className="p-5">
        <p className="text-sm text-muted">The save may already have succeeded. This page is reloading frozen state.</p>
      </Card>
    </div>
  );
}

function dollars(micros: number) {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function statusTone(status: string): "good" | "bad" | "warn" | "info" | "neutral" {
  if (status === "verified") return "good";
  if (status === "failed" || status === "cancelled") return "bad";
  if (status === "awaiting_verification") return "warn";
  if (status === "running") return "info";
  return "neutral";
}

function declaredLimit(envelope: Record<string, unknown>, key: string, legacyKey: string) {
  const value = envelope[key] ?? envelope[legacyKey];
  return typeof value === "number" ? value : null;
}

export default function ExecutionRunPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<RunPageFallback />}>
      <ExecutionRunContent params={params} />
    </Suspense>
  );
}

async function ExecutionRunContent({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireOps();
  const manager = actor.role === "ops_manager" || actor.role === "platform_admin";
  const { id } = await params;

  if (actor.source === "demo") {
    return (
      <div className="space-y-6">
        <PageHeader kicker="Execution Lab" title="Persistent workspace required" />
        <Link href="/ops/execution" className="text-sm text-accent hover:underline">Back to Execution Lab</Link>
      </div>
    );
  }

  const { run, spec, evidence, receipt } = await getWorkstreamRunBundle(actor, id);
  const workCell = await getRunWorkCell(actor, id);
  // A work-cell run reserves its single Gauntlet review slot for the deterministic
  // verdict, which needs a completed validation. Submitting before that strands
  // the run, so the submit card is withheld until validation has run.
  const runHasWorkCell = workCell.assignments.length > 0 || workCell.packet !== null || workCell.manifest !== null;
  const workCellValidated = workCell.assignments.some(
    (assignment) => assignment.phase === "validate" && assignment.status === "completed" && assignment.outputArtifactId,
  );
  const submitBlockedByWorkCell = runHasWorkCell && !workCellValidated;
  const receiptDraft =
    workCell.packet && workCell.review && workCell.manifest
      ? receiptFormDefaults(
          draftWorkCellReceipt({
            packet: workCell.packet.payload,
            review: workCell.review.payload,
            expectedProductIds: workCell.manifest.expectedProductIds,
          }),
        )
      : null;
  const submitNotes = workCell.packet
    ? correctiveActionFromPacket({
        packet: workCell.packet.payload,
        review: workCell.review?.payload,
        frozenRecords: Object.fromEntries(
          (workCell.manifest?.inputRecords ?? []).map((entry) => [entry.productId, { id: entry.productId, ...entry.record }]),
        ),
      }).reason
    : "";
  const submitDefaults = runHasWorkCell
    ? workCellSubmitDefaults({
        assignments: workCell.assignments,
        prepareExecutorKey: workCell.manifest?.prepareExecutorKey,
        reviewExecutorKey: workCell.manifest?.reviewExecutorKey,
        notes: submitNotes,
      })
    : null;
  const economicCheck = checkEconomicEnvelope(spec.economicEnvelope, {
    humanMinutes: run.humanMinutes,
    ownerMinutes: run.ownerMinutes,
    aiCostMicros: run.aiCostMicros,
    toolCostMicros: run.toolCostMicros,
  });
  const economicDimensions = [
    { label: "Human", actual: run.humanMinutes, limit: declaredLimit(spec.economicEnvelope, "maxHumanMinutes", "max_human_minutes"), unit: "min" },
    { label: "Owner", actual: run.ownerMinutes, limit: declaredLimit(spec.economicEnvelope, "maxOwnerMinutes", "max_owner_minutes"), unit: "min" },
    { label: "AI", actual: run.aiCostMicros, limit: declaredLimit(spec.economicEnvelope, "maxAiCostMicros", "max_ai_cost_micros"), unit: "micros" },
    { label: "Tools", actual: run.toolCostMicros, limit: declaredLimit(spec.economicEnvelope, "maxToolCostMicros", "max_tool_cost_micros"), unit: "micros" },
  ];
  const hasNumericCeiling = economicDimensions.some((dimension) => dimension.limit !== null);

  return (
    <div className="space-y-8">
      <PageHeader
        kicker="Execution run"
        title={spec.objective}
        description={`Run ${run.id} · Delegation Spec v${spec.version}`}
        actions={<Link href="/ops/execution" className="text-sm text-accent hover:underline">Back to lab</Link>}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(run.status)}>{run.status.replaceAll("_", " ")}</Badge>
        <ActionClassBadge value={spec.actionClass} />
        <span className="text-xs text-muted">Started {run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}</span>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Economic envelope</p>
            <p className="mt-1 text-sm text-muted">
              {hasNumericCeiling
                ? economicCheck.ok
                  ? "Observed economics are within the declared ceilings."
                  : "A passing receipt is blocked until the overage is resolved or the run is recorded as failed."
                : "No numeric ceilings are declared for this spec."}
            </p>
          </div>
          <Badge tone={economicCheck.ok ? "good" : "bad"}>{economicCheck.ok ? "within limits" : "over limit"}</Badge>
        </div>
        <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
          {economicDimensions.map((dimension) => (
            <div key={dimension.label}>
              <p className="text-muted">{dimension.label}</p>
              <p className="font-medium">{dimension.actual} {dimension.unit}</p>
              <p className="text-xs text-muted">{dimension.limit === null ? "No ceiling" : "≤ " + dimension.limit + " " + dimension.unit}</p>
            </div>
          ))}
        </div>
        {!economicCheck.ok ? (
          <p className="mt-3 text-xs text-bad">{economicCheck.failures.join(" ")}</p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Definition of done</p>
          <ul className="mt-3 space-y-2 text-sm">
            {spec.definitionOfDone.map((item) => <li key={item}>• {item}</li>)}
          </ul>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Verification rules</p>
          {spec.verificationRules.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {spec.verificationRules.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No explicit verification rule was defined for this first version.</p>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Authority</p>
          {spec.authorityRules.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {spec.authorityRules.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted">No authority beyond the action class has been recorded.</p>
          )}
        </Card>
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Stop / approval conditions</p>
          <div className="mt-3 space-y-3 text-sm">
            <div>
              <p className="font-medium">Approvals</p>
              <p className="text-muted">{spec.approvalPoints.length ? spec.approvalPoints.join(" · ") : "None recorded"}</p>
            </div>
            <div>
              <p className="font-medium">Exceptions</p>
              <p className="text-muted">{spec.exceptionPolicy.length ? spec.exceptionPolicy.join(" · ") : "None recorded"}</p>
            </div>
          </div>
        </Card>
      </div>

      {run.status === "planned" ? (
        <Card className="p-6">
          <h2 className="font-semibold">Start observed execution</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Starting this run records execution time. It does not grant any new authority or trigger an agent.
          </p>
          <form action={startWorkstreamRunAction} className="mt-4">
            <input type="hidden" name="runId" value={run.id} />
            <Button type="submit">Start run</Button>
          </form>
        </Card>
      ) : null}

      <WorkCellSection
        bundle={workCell}
        runId={run.id}
        cycleId={run.gauntletCycleId}
        runStatus={run.status}
        manager={manager}
      />

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Evidence</h2>
          <p className="text-sm text-muted">Evidence is append-only. Once the run leaves execution, new evidence cannot be added.</p>
        </div>
        {run.status === "running" ? (
          <Card className="p-6">
            <form action={addEvidenceArtifactAction} className="grid gap-4 lg:grid-cols-2">
              <input type="hidden" name="runId" value={run.id} />
              <Field label="Evidence kind">
                <select name="kind" defaultValue="observation" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-accent">
                  <option value="observation">Observation</option>
                  <option value="source">Source</option>
                  <option value="before_after">Before / after</option>
                  <option value="test">Test</option>
                  <option value="deployment">Deployment</option>
                  <option value="communication">Communication</option>
                  <option value="reconciliation">Reconciliation</option>
                  <option value="other">Other</option>
                </select>
              </Field>
              <Field label="Source URI" hint="Optional pointer to the source or system record.">
                <Input name="sourceUri" placeholder="https://... or system://record/id" />
              </Field>
              <div className="lg:col-span-2">
                <Field label="Evidence summary">
                  <Textarea name="summary" required placeholder="What was observed or verified?" />
                </Field>
              </div>
              <div className="lg:col-span-2">
                <Field label="Structured payload" hint="Optional JSON object. Use this for counts, before/after values, IDs, or machine-readable evidence.">
                  <Textarea name="payload" placeholder={'{"recordsChecked": 37, "recordsChanged": 5}'} />
                </Field>
              </div>
              <div className="lg:col-span-2"><Button type="submit" variant="secondary">Append evidence</Button></div>
            </form>
          </Card>
        ) : null}
        <div className="divide-y divide-line rounded-xl border border-line bg-surface">
          {evidence.length ? evidence.map((item) => (
            <div key={item.id} className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{item.kind.replaceAll("_", " ")}</Badge>
                <span className="text-xs text-muted">{new Date(item.observedAt).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-sm">{item.summary}</p>
              {item.sourceUri ? <p className="mt-1 break-all text-xs text-muted">Source: {item.sourceUri}</p> : null}
              {item.contentHash ? <p className="mt-1 font-mono text-[11px] text-muted">sha256:{item.contentHash.slice(0, 16)}…</p> : null}
            </div>
          )) : <div className="p-5 text-sm text-muted">No evidence has been attached to this run yet.</div>}
        </div>
      </section>

      {run.status === "running" && submitBlockedByWorkCell ? (
        <Card className="p-6">
          <h2 className="font-semibold">Submit for independent verification</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            This run is executed by a work cell. Run deterministic work-cell validation above before submitting it —
            a work-cell run&apos;s single Gauntlet review slot is reserved for the deterministic verdict, and submitting
            before validation completes would leave the attempt with no way to fill it.
          </p>
        </Card>
      ) : null}

      {run.status === "running" && !submitBlockedByWorkCell ? (
        <Card className="p-6">
          <h2 className="font-semibold">Submit for independent verification</h2>
          <p className="mt-1 text-sm text-muted">Record actual delivery economics before freezing the run for review.</p>
          {submitDefaults ? (
            <p className="mt-2 text-sm text-muted">
              Economics and executor keys are prefilled from work-cell assignments. Owner minutes stay 0 unless you measured them. Submitting still freezes the run.
            </p>
          ) : null}
          <form action={submitWorkstreamRunAction} className="mt-5 grid gap-4 lg:grid-cols-2">
            <input type="hidden" name="runId" value={run.id} />
            <Field label="Human intervention (minutes)"><Input name="humanMinutes" type="number" min="0" step="0.1" defaultValue={submitDefaults?.humanMinutes ?? "0"} /></Field>
            <Field label="Owner intervention (minutes)"><Input name="ownerMinutes" type="number" min="0" step="0.1" defaultValue={submitDefaults?.ownerMinutes ?? "0"} /></Field>
            <Field label="AI cost (USD)"><Input name="aiCost" type="number" min="0" step="0.0001" defaultValue={submitDefaults?.aiCostUsd ?? "0"} /></Field>
            <Field label="Tool/API cost (USD)"><Input name="toolCost" type="number" min="0" step="0.0001" defaultValue={submitDefaults?.toolCostUsd ?? "0"} /></Field>
            <div className="lg:col-span-2">
              <Field label="Executor summary" hint="Optional JSON object describing which executor performed which part.">
                <Textarea
                  name="executorSummary"
                  defaultValue={submitDefaults?.executorSummary ?? ""}
                  placeholder={'{"research":"human","linkCheck":"script","analysis":"grok"}'}
                />
              </Field>
            </div>
            <div className="lg:col-span-2"><Field label="Run notes"><Textarea name="notes" defaultValue={submitDefaults?.notes ?? ""} placeholder="Unexpected behavior, assumptions, or context for the verifier." /></Field></div>
            <div className="lg:col-span-2"><Button type="submit">Freeze and submit for verification</Button></div>
          </form>
        </Card>
      ) : null}

      {run.status === "awaiting_verification" && manager ? (
        <Card className="p-6">
          <h2 className="font-semibold">Issue Outcome Receipt</h2>
          <p className="mt-1 text-sm text-muted">The verifier decides whether the frozen run actually met its contract. The receipt is immutable.</p>
          {receiptDraft ? (
            <p className="mt-2 text-sm text-muted">
              Fields are prefilled from the work-cell draft ({receiptDraft.verificationStatus}). This does not issue the
              receipt. A passing receipt still requires definition of done and a clean hard gate.
            </p>
          ) : null}
          <form action={verifyWorkstreamRunAction} className="mt-5 grid gap-4 lg:grid-cols-2">
            <input type="hidden" name="runId" value={run.id} />
            <div className="lg:col-span-2 flex items-center gap-2 rounded-md border border-line bg-bg-elevated p-3">
              <input
                id="definitionOfDoneMet"
                name="definitionOfDoneMet"
                type="checkbox"
                className="h-4 w-4"
                defaultChecked={receiptDraft?.definitionOfDoneMet === true}
              />
              <label htmlFor="definitionOfDoneMet" className="text-sm">Definition of done is fully met</label>
            </div>
            <div className="lg:col-span-2"><Field label="Receipt summary"><Textarea name="summary" required defaultValue={receiptDraft?.summary ?? ""} placeholder="What outcome was actually achieved?" /></Field></div>
            <div className="lg:col-span-2"><Field label="Verification notes"><Textarea name="verificationNotes" defaultValue={receiptDraft?.verificationNotes ?? ""} placeholder="How was the evidence checked? What remains uncertain?" /></Field></div>
            <Field label="Actions taken" hint="One per line."><Textarea name="actionsTaken" defaultValue={receiptDraft?.actionsTaken ?? ""} /></Field>
            <Field label="Exceptions" hint="One per line."><Textarea name="exceptions" defaultValue={receiptDraft?.exceptions ?? ""} /></Field>
            <Field label="Unresolved decisions" hint="One per line."><Textarea name="unresolvedDecisions" defaultValue={receiptDraft?.unresolvedDecisions ?? ""} /></Field>
            <Field label="QA score (0–100)"><Input name="qaScore" type="number" min="0" max="100" step="0.1" /></Field>
            <div className="lg:col-span-2 flex flex-wrap gap-2">
              <Button type="submit" name="verificationStatus" value="passed">Pass and issue receipt</Button>
              <Button type="submit" name="verificationStatus" value="failed" variant="danger">Fail and issue receipt</Button>
            </div>
          </form>
        </Card>
      ) : null}

      {run.status === "awaiting_verification" && !manager ? (
        <Card className="p-5"><p className="text-sm text-muted">This run is frozen. An operations manager must perform independent verification.</p></Card>
      ) : null}

      <Card className="p-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Observed economics</p>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
          <div><p className="text-muted">Human</p><p className="font-medium">{run.humanMinutes} min</p></div>
          <div><p className="text-muted">Owner</p><p className="font-medium">{run.ownerMinutes} min</p></div>
          <div><p className="text-muted">AI</p><p className="font-medium">{dollars(run.aiCostMicros)}</p></div>
          <div><p className="text-muted">Tools</p><p className="font-medium">{dollars(run.toolCostMicros)}</p></div>
        </div>
      </Card>

      {receipt ? (
        <Card className="border-line-strong p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Outcome Receipt</p>
              <h2 className="mt-1 text-xl font-semibold">{receipt.summary}</h2>
            </div>
            <Badge tone={receipt.verificationStatus === "passed" ? "good" : "bad"}>{receipt.verificationStatus}</Badge>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div><p className="text-xs font-medium text-muted">Definition of done</p><p className="mt-1 text-sm">{receipt.definitionOfDoneMet ? "Met" : "Not met"}</p></div>
            <div><p className="text-xs font-medium text-muted">QA score</p><p className="mt-1 text-sm">{receipt.qaScore ?? "Not scored"}</p></div>
            <div className="lg:col-span-2"><p className="text-xs font-medium text-muted">Verification notes</p><p className="mt-1 whitespace-pre-wrap text-sm">{receipt.verificationNotes || "No additional notes."}</p></div>
            <div><p className="text-xs font-medium text-muted">Actions taken</p><p className="mt-1 text-sm">{receipt.actionsTaken.length ? receipt.actionsTaken.join(" · ") : "None recorded"}</p></div>
            <div><p className="text-xs font-medium text-muted">Exceptions</p><p className="mt-1 text-sm">{receipt.exceptions.length ? receipt.exceptions.join(" · ") : "None recorded"}</p></div>
            <div className="lg:col-span-2"><p className="text-xs font-medium text-muted">Unresolved decisions</p><p className="mt-1 text-sm">{receipt.unresolvedDecisions.length ? receipt.unresolvedDecisions.join(" · ") : "None"}</p></div>
          </div>
          <p className="mt-5 text-xs text-muted">Verified {new Date(receipt.verifiedAt).toLocaleString()} · Receipt {receipt.id}</p>
        </Card>
      ) : null}
    </div>
  );
}
