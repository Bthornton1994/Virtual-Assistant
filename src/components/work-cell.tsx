import {
  freezeWorkCellInputManifestAction,
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
 * The Work Cell view for one Gauntlet attempt.
 *
 * The stage order is enforced by the server, and the forms follow it: the input
 * manifest freezes the expected batch before any evidence exists, and every
 * later stage reads the batch from there. There is deliberately no executor-key
 * field and no repeated "expected product IDs" box — both were routes by which
 * an operator could relabel an artifact or validate against a different set than
 * the one finally recorded.
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
  const { manifest, assignments, packet, review, validation, rejections } = bundle;
  const running = runStatus === "running";
  const awaitingVerification = runStatus === "awaiting_verification";
  // Gate the verdict control on validation having actually completed. Gating on
  // "has a work cell" would offer a button the database refuses, and surface a
  // trigger message about impersonation rather than the real precondition.
  const validationComplete = assignments.some(
    (assignment) => assignment.phase === "validate" && assignment.status === "completed" && assignment.outputArtifactId,
  );

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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">0. Frozen input manifest</p>
          {manifest ? <Badge tone="good">frozen</Badge> : <Badge>not frozen</Badge>}
        </div>
        {manifest ? (
          <div className="mt-3 space-y-3 text-sm">
            <p>
              <span className="text-muted">Market: </span>
              {manifest.market}
            </p>
            <p>
              <span className="text-muted">Expected products: </span>
              {manifest.expectedProductIds.join(", ")}
            </p>
            <p className="break-all font-mono text-[11px] text-muted">input {shortHash(manifest.inputHash)}</p>
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">
                Frozen input records ({manifest.inputRecords.length})
              </p>
              <Textarea
                readOnly
                rows={6}
                className="mt-1 font-mono text-[11px]"
                value={JSON.stringify(
                  Object.fromEntries(manifest.inputRecords.map((entry) => [entry.productId, entry.record])),
                  null,
                  2,
                )}
              />
              <p className="mt-1 text-xs text-muted">
                Select all and copy this exact JSON to hand to Hermes, then to Grok. Both executors must work from these
                frozen records, not a live repository lookup.
              </p>
            </div>
            <p className="text-xs text-muted">
              Every later stage validates against this batch automatically. It cannot be retyped or substituted per stage.
            </p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Freeze exactly what this attempt must cover before any executor evidence is ingested.
          </p>
        )}

        {running && manager && !manifest ? (
          <form action={freezeWorkCellInputManifestAction} className="mt-5 space-y-4 border-t border-line pt-4">
            <input type="hidden" name="runId" value={runId} />
            {cycleId ? <input type="hidden" name="cycleId" value={cycleId} /> : null}
            <Field label="Market"><Input name="market" required placeholder="US" /></Field>
            <Field label="Expected product IDs" hint="One per line or comma separated. This becomes immutable run provenance.">
              <Textarea name="expectedProductIds" required rows={4} placeholder={"ks-sbd-7mm\nbelt-sbd-13mm"} />
            </Field>
            <Field
              label="Frozen input records"
              hint="One JSON object mapping each expected product ID to its exact catalog record. This is what gets frozen and handed to both executors — not a live repository lookup performed later."
            >
              <Textarea
                name="inputRecords"
                required
                rows={6}
                className="font-mono text-[11px]"
                placeholder={'{\n  "ks-sbd-7mm": { "thickness": "7mm" },\n  "belt-sbd-13mm": { "width": "4in" }\n}'}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Prepare executor key" hint="Must be a registered researcher.">
                <Input name="prepareExecutorKey" required defaultValue="hermes-loadout-researcher-v1" />
              </Field>
              <Field label="Review executor key" hint="Must be a registered reviewer, and different from the researcher.">
                <Input name="reviewExecutorKey" required defaultValue="grok-loadout-reviewer-v1" />
              </Field>
            </div>
            <p className="text-xs text-muted">
              Naming the executors here, before any output exists, is what makes relabeling impossible later: ingestion
              requires each artifact&apos;s own declared executor key to match this frozen plan.
            </p>
            <Button type="submit">Freeze input manifest</Button>
          </form>
        ) : null}
      </Card>

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
              Paste the research executor&apos;s raw output. It is validated against the frozen manifest before anything is
              stored as evidence.
            </p>
          )}

          {running && manager && manifest && !packet ? (
            <form action={ingestCatalogEvidencePacketAction} className="mt-5 space-y-4 border-t border-line pt-4">
              <input type="hidden" name="runId" value={runId} />
              {cycleId ? <input type="hidden" name="cycleId" value={cycleId} /> : null}
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
              accepted only if it references the exact packet hash.
            </p>
          )}

          {running && manager && packet && !review ? (
            <form action={ingestCatalogEvidenceReviewAction} className="mt-5 space-y-4 border-t border-line pt-4">
              <input type="hidden" name="runId" value={runId} />
              {cycleId ? <input type="hidden" name="cycleId" value={cycleId} /> : null}
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

      {rejections.length ? (
        <Card className="p-5">
          <p className="font-medium">Rejected executor attempts</p>
          <p className="mt-1 text-sm text-muted">
            These outputs were refused and never became evidence. They are kept immutable so a failed executor attempt can
            still be classified and costed.
          </p>
          <div className="mt-3 space-y-3">
            {rejections.map((rejection) => (
              <div key={rejection.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="bad">rejected</Badge>
                  <span className="text-sm font-medium">{rejection.phase}</span>
                  <span className="text-xs text-muted">{rejection.declaredExecutorKey}</span>
                </div>
                <p className="mt-2 break-all font-mono text-[11px] text-muted">raw {shortHash(rejection.rawOutputHash)}</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {rejection.hardFailures.slice(0, 5).map((failure) => (
                    <li key={failure}>• {failure}</li>
                  ))}
                </ul>
                {rejection.hardFailures.length > 5 ? (
                  <p className="mt-1 text-xs text-muted">+{rejection.hardFailures.length - 5} more</p>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

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

            {validation.benchmark.reviewerPresent ? (
              <div className="rounded-lg border border-line p-4">
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Reviewer benchmark</p>
                <p className="mt-2 text-sm text-muted">
                  How well the reviewer performed. This is separate from whether the attempt is verifiable — a reviewer that
                  catches a real defect scores well here while the attempt correctly fails.
                </p>
                <MetricGrid
                  metrics={{
                    claimsReviewed: validation.benchmark.claimsReviewed,
                    independentVerifications: validation.benchmark.independentVerifications,
                    rejectedClaims: validation.benchmark.rejectedClaims,
                    inconclusiveClaims: validation.benchmark.inconclusiveClaims,
                    newFindings: validation.benchmark.newFindings,
                    highSeverityNewFindings: validation.benchmark.highSeverityNewFindings,
                  }}
                />
                {validation.benchmark.reviewerCaughtDefectStructuralValidationMissed ? (
                  <p className="mt-3 text-sm">
                    The reviewer surfaced a defect structural validation did not. Good reviewer performance, failed attempt.
                  </p>
                ) : null}
              </div>
            ) : null}

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
            artifacts always produce the same verdict. It runs once both executor artifacts exist.
          </p>
        )}

        {running && manager && packet && review && !validation ? (
          <form action={runWorkCellValidationAction} className="mt-5 space-y-3 border-t border-line pt-4">
            <input type="hidden" name="runId" value={runId} />
            {cycleId ? <input type="hidden" name="cycleId" value={cycleId} /> : null}
            <p className="text-sm text-muted">Validates the frozen packet and review against the frozen input manifest.</p>
            <Button type="submit" variant="secondary">Run deterministic validation</Button>
          </form>
        ) : null}

        {running && manager && packet && !review ? (
          <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
            Deterministic validation opens once the independent review has been ingested. Validating a half-built cell would
            produce a report that looks authoritative while describing an incomplete attempt.
          </p>
        ) : null}

        {awaitingVerification && manager && cycleId && validationComplete ? (
          <form action={recordWorkCellGauntletReviewsAction} className="mt-5 space-y-3 border-t border-line pt-4">
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="cycleId" value={cycleId} />
            <p className="text-sm text-muted">
              Re-runs the deterministic validator over the frozen artifacts and records one authoritative Gauntlet review.
              Its verdict incorporates the reviewer&apos;s conclusions, so a rejected claim cannot yield a passing receipt.
            </p>
            <Button type="submit">Record work-cell verdict into the Gauntlet</Button>
          </form>
        ) : null}
      </Card>
    </section>
  );
}
