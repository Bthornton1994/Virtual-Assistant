import {
  ingestCatalogEvidencePacketAction,
  ingestCatalogEvidenceReviewAction,
  recordWorkCellGauntletReviewsAction,
  runWorkCellValidationAction,
} from "@/app/actions/work-cell";
import { Badge, Button, Card, Field, Input, Textarea } from "@/components/ui";
import type { WorkCellBundle } from "@/lib/work-cell";

function dollars(micros: number) {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}

function shortHash(hash: string | null | undefined) {
  return hash ? `sha256:${hash.slice(0, 16)}…` : "—";
}

function phaseTone(status: string): "good" | "bad" | "warn" | "info" | "neutral" {
  if (status === "completed") return "good";
  if (status === "failed") return "bad";
  if (status === "running") return "info";
  return "neutral";
}

function MetricGrid({ metrics }: { metrics: Record<string, number> }) {
  return (
    <div className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {Object.entries(metrics).map(([key, value]) => (
        <div key={key} className="flex items-baseline justify-between gap-2 border-b border-line py-1">
          <span className="text-muted">{key.replace(/([A-Z])/g, " $1").toLowerCase()}</span>
          <span className="font-mono font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}

function FindingsList({ title, items, tone }: { title: string; items: string[]; tone: "bad" | "warn" }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className={`text-xs font-medium uppercase tracking-[0.14em] ${tone === "bad" ? "text-bad" : "text-muted"}`}>{title}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Work Cell view for one Gauntlet attempt: who executed which phase, under
 * what frozen authority, producing which hashed artifact, and what the
 * deterministic validator concluded. Ingestion never repairs a malformed paste —
 * a rejected packet is reported and not stored.
 */
export function WorkCellSection({
  bundle,
  runId,
  cycleId,
  runStatus,
  manager,
}: {
  bundle: WorkCellBundle;
  runId: string;
  cycleId: string | null;
  runStatus: string;
  manager: boolean;
}) {
  const { assignments, packet, review, validation } = bundle;
  const running = runStatus === "running";
  const awaitingVerification = runStatus === "awaiting_verification";
  const hasWorkCell = assignments.length > 0 || packet !== null;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Work Cell</h2>
        <p className="max-w-3xl text-sm text-muted">
          Several replaceable executors carry one attempt: a research executor prepares typed evidence, an independent
          reviewer challenges it, and a deterministic validator owns the gate. AI workers produce evidence and judgments;
          they never own the counts, the hash, or the hard gate.
        </p>
      </div>

      <Card className="p-5">
        <p className="font-medium">Executor assignments</p>
        {assignments.length ? (
          <div className="mt-3 space-y-3">
            {assignments.map((assignment) => (
              <div key={assignment.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={phaseTone(assignment.status)}>{assignment.status}</Badge>
                  <span className="text-sm font-medium">{assignment.phase}</span>
                  <span className="text-sm text-muted">
                    {assignment.profile ? `${assignment.profile.displayName} (${assignment.profile.key})` : assignment.executorProfileId}
                  </span>
                  {assignment.profile ? <Badge>{assignment.profile.executorKind}</Badge> : null}
                  {assignment.profile ? <Badge tone={assignment.profile.status === "active" ? "good" : "warn"}>{assignment.profile.status}</Badge> : null}
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
                  <div>Input artifact: {assignment.inputArtifactId ?? "—"}</div>
                  <div>Output artifact: {assignment.outputArtifactId ?? "—"}</div>
                  <div>Human: {assignment.humanMinutes} min</div>
                  <div>
                    AI {dollars(assignment.aiCostMicros)} · tools {dollars(assignment.toolCostMicros)}
                  </div>
                </div>
                {Array.isArray(assignment.profile?.forbiddenActions) && assignment.profile.forbiddenActions.length ? (
                  <p className="mt-3 text-xs text-muted">
                    <span className="font-medium">Forbidden:</span>{" "}
                    {assignment.profile.forbiddenActions.map(String).join(" · ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">No executor has been assigned to this attempt yet.</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">1. Frozen evidence packet</p>
            {packet ? <Badge tone="good">frozen</Badge> : <Badge>not ingested</Badge>}
          </div>
          {packet ? (
            <div className="mt-3 space-y-1 text-sm">
              <p>
                <span className="text-muted">Executor: </span>
                {packet.payload.executorKey}
              </p>
              <p>
                <span className="text-muted">Market: </span>
                {packet.payload.market} · {packet.payload.products.length} product(s)
              </p>
              <p className="break-all font-mono text-[11px] text-muted">{shortHash(packet.contentHash)}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              Paste the research executor&apos;s raw output. It is validated before anything is stored.
            </p>
          )}

          {running && manager && !packet ? (
            <form action={ingestCatalogEvidencePacketAction} className="mt-5 space-y-4 border-t border-line pt-4">
              <input type="hidden" name="runId" value={runId} />
              {cycleId ? <input type="hidden" name="cycleId" value={cycleId} /> : null}
              <Field label="Executor key" hint="Defaults to the executorKey declared inside the packet.">
                <Input name="executorKey" placeholder="hermes-loadout-researcher-v1" />
              </Field>
              <Field label="Expected product IDs" hint="Optional. One per line or comma separated. Enforces exact batch coverage.">
                <Textarea name="expectedProductIds" placeholder="ks-sbd-7mm" />
              </Field>
              <Field label="Raw executor JSON" hint="Pasted verbatim. Malformed output is rejected, never repaired.">
                <Textarea name="raw" required rows={8} placeholder='{"schemaVersion":"catalog-evidence-packet/v1", ...}' />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Human minutes"><Input name="humanMinutes" type="number" min="0" step="0.1" defaultValue="0" /></Field>
                <Field label="AI cost (USD)"><Input name="aiCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field>
                <Field label="Tool cost (USD)"><Input name="toolCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field>
              </div>
              <Button type="submit">Validate and freeze packet</Button>
            </form>
          ) : null}
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">2. Independent review</p>
            {review ? <Badge tone="good">frozen</Badge> : <Badge>not ingested</Badge>}
          </div>
          {review ? (
            <div className="mt-3 space-y-1 text-sm">
              <p>
                <span className="text-muted">Reviewer: </span>
                {review.payload.reviewerExecutorKey}
              </p>
              <p>
                <span className="text-muted">Claims reviewed: </span>
                {review.payload.claimReviews.length}
              </p>
              <p className="break-all font-mono text-[11px] text-muted">reviews {shortHash(review.payload.evidencePacketHash)}</p>
              <p className="break-all font-mono text-[11px] text-muted">{shortHash(review.contentHash)}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">
              The reviewer receives the frozen packet and challenges it. It cannot modify the packet, and its review is
              accepted only if it references the exact packet hash above.
            </p>
          )}

          {running && manager && packet && !review ? (
            <form action={ingestCatalogEvidenceReviewAction} className="mt-5 space-y-4 border-t border-line pt-4">
              <input type="hidden" name="runId" value={runId} />
              {cycleId ? <input type="hidden" name="cycleId" value={cycleId} /> : null}
              <Field label="Reviewer key" hint="Defaults to the reviewerExecutorKey declared inside the review.">
                <Input name="executorKey" placeholder="grok-loadout-reviewer-v1" />
              </Field>
              <Field label="Raw reviewer JSON" hint={`Must reference evidencePacketHash ${packet.contentHash}`}>
                <Textarea name="raw" required rows={8} placeholder='{"schemaVersion":"catalog-evidence-review/v1", ...}' />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Human minutes"><Input name="humanMinutes" type="number" min="0" step="0.1" defaultValue="0" /></Field>
                <Field label="AI cost (USD)"><Input name="aiCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field>
                <Field label="Tool cost (USD)"><Input name="toolCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field>
              </div>
              <Button type="submit">Verify hash, validate, and freeze review</Button>
            </form>
          ) : null}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">3. Deterministic validation</p>
          {validation ? (
            <Badge tone={validation.gate.hardGatePass ? "good" : "bad"}>
              {validation.gate.hardGatePass ? "hard gate pass" : "hard gate fail"}
            </Badge>
          ) : (
            <Badge>not run</Badge>
          )}
        </div>

        {validation ? (
          <div className="mt-4 space-y-5">
            <div>
              {validation.gate.reasons.map((reason) => (
                <p key={reason} className="text-sm text-muted">
                  {reason}
                </p>
              ))}
              {validation.gate.authorityIncidents.length ? (
                <p className="mt-2 text-sm text-bad">
                  {validation.gate.authorityIncidents.length} authority incident(s) recorded. Authority incidents suspend
                  autonomy automatically.
                </p>
              ) : null}
            </div>

            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Packet metrics (computed, not reported)</p>
              <MetricGrid metrics={validation.packet.metrics as unknown as Record<string, number>} />
              <FindingsList title="Hard failures" items={validation.packet.hardFailures} tone="bad" />
              <FindingsList title="Warnings" items={validation.packet.warnings} tone="warn" />
            </div>

            {validation.review ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Review metrics (computed, not reported)</p>
                <MetricGrid metrics={validation.review.metrics as unknown as Record<string, number>} />
                <FindingsList title="Hard failures" items={validation.review.hardFailures} tone="bad" />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            The validator parses, hashes, counts, and gates. It calls no model and reaches no network, so the same frozen
            artifacts always produce the same verdict.
          </p>
        )}

        {running && manager && packet && !validation ? (
          <form action={runWorkCellValidationAction} className="mt-5 space-y-4 border-t border-line pt-4">
            <input type="hidden" name="runId" value={runId} />
            {cycleId ? <input type="hidden" name="cycleId" value={cycleId} /> : null}
            <Field label="Expected product IDs" hint="Optional. One per line or comma separated.">
              <Textarea name="expectedProductIds" />
            </Field>
            <Button type="submit" variant="secondary">Run deterministic validation</Button>
          </form>
        ) : null}

        {awaitingVerification && manager && cycleId && hasWorkCell ? (
          <form action={recordWorkCellGauntletReviewsAction} className="mt-5 space-y-3 border-t border-line pt-4">
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="cycleId" value={cycleId} />
            <p className="text-sm text-muted">
              Re-runs the deterministic validator over the frozen artifacts and records the result as the Gauntlet
              adversarial review. The hard gate comes from the validator, never from the reviewing agent&apos;s verdict.
            </p>
            <Button type="submit">Record work-cell verdict into the Gauntlet</Button>
          </form>
        ) : null}
      </Card>
    </section>
  );
}
