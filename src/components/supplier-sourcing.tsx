import {
  freezeSupplierSourcingInputManifestAction,
  ingestSupplierSourcingPacketAction,
  ingestSupplierSourcingReviewAction,
  runSupplierSourcingValidationAction,
  submitSupplierSourcingRunAction,
  approveSupplierOutreachAction,
} from "@/app/actions/supplier-sourcing";
import { WorkCellActionForm } from "@/components/work-cell-action-form";
import { Badge, Button, Card, Field, Input, Textarea } from "@/components/ui";
import type { SupplierSourcingBundle } from "@/lib/supplier-sourcing-run";

const PILOT_CANDIDATES = "[\n  {\n    \"candidateId\": \"calm-cloud-rice\",\n    \"productId\": \"calm-cloud-rice\",\n    \"productName\": \"Cloud Rice Calm Bin\",\n    \"brand\": \"Grounded Curated\",\n    \"modelOrVariant\": null,\n    \"category\": \"calming\",\n    \"desiredFulfillmentModes\": [\n      \"supplier-direct\",\n      \"partner-fulfilled\"\n    ],\n    \"kitAssemblyRequired\": true,\n    \"knownSourceUrls\": [],\n    \"constraints\": [\n      \"Prototype brand label only; do not treat it as a supplier identity.\",\n      \"No Grounded-owned inventory.\",\n      \"Preserve all unknown compliance, availability, shipping, returns, and seller-of-record facts.\"\n    ]\n  },\n  {\n    \"candidateId\": \"tool-chew-necklace\",\n    \"productId\": \"tool-chew-necklace\",\n    \"productName\": \"Tide Chew Necklace Set\",\n    \"brand\": \"Soft Circuit Studio\",\n    \"modelOrVariant\": null,\n    \"category\": \"tools\",\n    \"desiredFulfillmentModes\": [\n      \"supplier-direct\",\n      \"partner-fulfilled\"\n    ],\n    \"kitAssemblyRequired\": true,\n    \"knownSourceUrls\": [],\n    \"constraints\": [\n      \"Prototype catalog identity only; do not infer a supplier relationship from the brand label.\",\n      \"No Grounded-owned inventory.\",\n      \"Require product-specific oral-use, compliance, availability, shipping, returns, and seller-of-record evidence.\"\n    ]\n  },\n  {\n    \"candidateId\": \"tool-weighted-lap\",\n    \"productId\": \"tool-weighted-lap\",\n    \"productName\": \"River Stone Weighted Lap Pad\",\n    \"brand\": \"Harbor Hands OT\",\n    \"modelOrVariant\": null,\n    \"category\": \"tools\",\n    \"desiredFulfillmentModes\": [\n      \"supplier-direct\",\n      \"partner-fulfilled\"\n    ],\n    \"kitAssemblyRequired\": true,\n    \"knownSourceUrls\": [],\n    \"constraints\": [\n      \"Prototype catalog identity only; do not infer a supplier relationship from the brand label.\",\n      \"No Grounded-owned inventory.\",\n      \"Require product-specific weight, safety, compliance, availability, shipping, returns, and seller-of-record evidence.\"\n    ]\n  },\n  {\n    \"candidateId\": \"alert-dino-dig\",\n    \"productId\": \"alert-dino-dig\",\n    \"productName\": \"High-Tactile Dino Dig\",\n    \"brand\": \"Interest Forge\",\n    \"modelOrVariant\": null,\n    \"category\": \"alerting\",\n    \"desiredFulfillmentModes\": [\n      \"supplier-direct\",\n      \"partner-fulfilled\"\n    ],\n    \"kitAssemblyRequired\": true,\n    \"knownSourceUrls\": [],\n    \"constraints\": [\n      \"Prototype catalog identity only; do not infer a supplier relationship from the brand label.\",\n      \"No Grounded-owned inventory.\",\n      \"Require exact loose-part, choking, material, compliance, availability, shipping, returns, and seller-of-record evidence.\"\n    ]\n  },\n  {\n    \"candidateId\": \"theme-fairy-garden\",\n    \"productId\": \"theme-fairy-garden\",\n    \"productName\": \"Moss Fairy Quiet Garden\",\n    \"brand\": \"Nest & Notice\",\n    \"modelOrVariant\": null,\n    \"category\": \"themed\",\n    \"desiredFulfillmentModes\": [\n      \"supplier-direct\",\n      \"partner-fulfilled\"\n    ],\n    \"kitAssemblyRequired\": true,\n    \"knownSourceUrls\": [],\n    \"constraints\": [\n      \"Prototype catalog identity only; do not infer a supplier relationship from the brand label.\",\n      \"No Grounded-owned inventory.\",\n      \"Require exact loose-part, choking, material, compliance, availability, shipping, returns, and seller-of-record evidence.\"\n    ]\n  },\n  {\n    \"candidateId\": \"hw-weighted-sled-station\",\n    \"productId\": \"hw-weighted-sled-station\",\n    \"productName\": \"Weighted Sled Push Station\",\n    \"brand\": \"MoveWell Kits\",\n    \"modelOrVariant\": null,\n    \"category\": \"heavy-work\",\n    \"desiredFulfillmentModes\": [\n      \"supplier-direct\",\n      \"partner-fulfilled\"\n    ],\n    \"kitAssemblyRequired\": true,\n    \"knownSourceUrls\": [],\n    \"constraints\": [\n      \"Prototype catalog identity only; do not infer a supplier relationship from the brand label.\",\n      \"No Grounded-owned inventory.\",\n      \"Require exact product, weight, safety, compliance, availability, shipping, returns, and seller-of-record evidence.\"\n    ]\n  }\n]";
const PILOT_OBJECTIVE =
  "Identify public primary-source supplier-direct or partner-fulfilled options for a bounded six-product Grounded pilot and determine whether kit assembly can be fulfilled without Grounded-owned inventory.";
const GROUNDED_SHA = "d9198744a7b4c9243ea05151f1f7daadc74bb85a";
const PREPARE_EXECUTOR = "grok-grounded-supplier-researcher-v1";
const REVIEW_EXECUTOR = "grok-grounded-supplier-reviewer-v1";

function shortHash(hash: string | null | undefined) {
  return hash ? "sha256:" + hash.slice(0, 16) + "…" : "—";
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

function FailureList({ title, items, tone = "bad" }: { title: string; items: string[]; tone?: "bad" | "warn" }) {
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <p className={tone === "bad" ? "text-xs font-medium uppercase tracking-[0.14em] text-bad" : "text-xs font-medium uppercase tracking-[0.14em] text-muted"}>{title}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.map((item) => <li key={item}>• {item}</li>)}
      </ul>
    </div>
  );
}

/**
 * Supplier sourcing is a distinct work-cell lane. Grok prepares public-source
 * research and draft messages; the server validates hashes and authority, while
 * an operations manager controls submission and any later human approval.
 */
export function SupplierSourcingSection({
  bundle,
  runId,
  runStatus,
  manager,
}: {
  bundle: SupplierSourcingBundle;
  runId: string;
  runStatus: string;
  manager: boolean;
}) {
  const { manifest, assignments, packet, review, validation, rejections } = bundle;
  const running = runStatus === "running";
  const awaitingVerification = runStatus === "awaiting_verification";

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Supplier sourcing work cell</h2>
        <p className="max-w-3xl text-sm text-muted">
          Grok researches public primary sources and prepares candidate evidence. It may draft a supplier inquiry, but it
          cannot send, create a relationship, claim acceptance, purchase, hold inventory, edit Grounded, or publish a kit.
          Delegation Cloud remains the authority and the deterministic validator remains the gate.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">0. Frozen supplier brief</p>
          {manifest ? <Badge tone="good">frozen</Badge> : <Badge>not frozen</Badge>}
        </div>
        {manifest ? (
          <div className="mt-3 space-y-3 text-sm">
            <p><span className="text-muted">Objective: </span>{manifest.objective}</p>
            <p><span className="text-muted">Market: </span>{manifest.market}</p>
            <p><span className="text-muted">Candidates: </span>{manifest.candidates.map((candidate) => candidate.candidateId).join(", ")}</p>
            <p className="break-all font-mono text-[11px] text-muted">input {shortHash(manifest.inputHash)}</p>
            <Textarea
              readOnly
              rows={7}
              className="font-mono text-[11px]"
              value={JSON.stringify(manifest.candidates, null, 2)}
            />
            <p className="text-xs text-muted">
              This is the immutable research scope. Later forms do not accept a replacement product list or executor identity.
            </p>
            {bundle.prompt ? (
              <Field label="Exact Grok prompt" hint="Copy this exact prompt into the authenticated Grok research session. Return only the typed JSON object.">
                <Textarea readOnly rows={12} className="font-mono text-[11px]" value={bundle.prompt} />
              </Field>
            ) : null}
          </div>
        ) : running && manager ? (
          <WorkCellActionForm action={freezeSupplierSourcingInputManifestAction} className="mt-5 space-y-4 border-t border-line pt-4">
            <input type="hidden" name="runId" value={runId} />
            <input type="hidden" name="prepareExecutorKey" value={PREPARE_EXECUTOR} />
            <input type="hidden" name="reviewExecutorKey" value={REVIEW_EXECUTOR} />
            <Field label="Objective">
              <Input name="objective" required defaultValue={PILOT_OBJECTIVE} />
            </Field>
            <Field label="Market">
              <Input name="market" required defaultValue="US" />
            </Field>
            <Field label="Grounded repository">
              <Input name="catalogRepository" defaultValue="Bthornton1994/Grounded" />
            </Field>
            <Field label="Grounded repository SHA" hint="Pinned catalog identity source; this does not mark any product verified.">
              <Input name="catalogRepositorySha" defaultValue={GROUNDED_SHA} pattern="[0-9a-fA-F]{40}" />
            </Field>
            <Field label="Frozen candidate input" hint="This six-product pilot is copied from the verified Grounded catalog identity snapshot. It is not supplier evidence.">
              <Textarea name="candidates" required rows={15} className="font-mono text-[11px]" defaultValue={PILOT_CANDIDATES} />
            </Field>
            <p className="text-xs text-muted">
              Freezing creates one immutable evidence artifact. It does not contact Grok, suppliers, or Grounded commerce.
            </p>
            <Button type="submit">Freeze supplier brief</Button>
          </WorkCellActionForm>
        ) : (
          <p className="mt-3 text-sm text-muted">The supplier brief can only be frozen while this attempt is running.</p>
        )}
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
                  <span className="text-sm text-muted">{assignment.profile?.displayName ?? assignment.profile?.key ?? assignment.executorProfileId}</span>
                  {assignment.profile ? <Badge>{assignment.profile.executorKind}</Badge> : null}
                  {assignment.profile ? <Badge tone={assignment.profile.status === "active" ? "good" : "warn"}>{assignment.profile.status}</Badge> : null}
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
                  <div>Input artifact: {assignment.inputArtifactId ?? "—"}</div>
                  <div>Output artifact: {assignment.outputArtifactId ?? "—"}</div>
                  <div>Human: {assignment.humanMinutes} min</div>
                  <div>AI {assignment.aiCostMicros} micros · tools {assignment.toolCostMicros} micros</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">No supplier executor phase has been recorded yet.</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">1. Grok prepare packet</p>
            {packet ? <Badge tone="good">accepted</Badge> : <Badge>not ingested</Badge>}
          </div>
          {packet ? (
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="text-muted">Executor: </span>{packet.payload.executorKey}</p>
              <p><span className="text-muted">Candidates: </span>{packet.payload.candidates.length}</p>
              <p className="break-all font-mono text-[11px] text-muted">packet {shortHash(packet.contentHash)}</p>
              <div className="space-y-2">
                {packet.payload.candidates.map((candidate) => (
                  <div key={candidate.candidateId} className="rounded-lg border border-line p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{candidate.candidateId}</span>
                      <Badge tone={candidate.status === "candidate" ? "warn" : "neutral"}>{candidate.status}</Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      Supplier identity: {candidate.supplierIdentity.status}; supplier-direct: {candidate.fulfillment.supplierDirect.status};
                      partner-fulfilled: {candidate.fulfillment.partnerFulfilled.status}; kit assembly: {candidate.fulfillment.kitAssembly.status}.
                    </p>
                    <p className="mt-1 text-xs text-muted">Outreach draft: {candidate.outreachDraft.status}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">Authority report: {JSON.stringify(packet.payload.authorityReport)}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Paste the exact JSON returned by Grok. Surrounding prose is rejected, not repaired.</p>
          )}
          {running && manager && manifest && !packet ? (
            <WorkCellActionForm action={ingestSupplierSourcingPacketAction} className="mt-5 space-y-4 border-t border-line pt-4">
              <Field label="Raw Grok packet" hint="Must be supplier-sourcing-packet/v1 and match the frozen input hash and executor key.">
                <Textarea name="raw" required rows={12} className="font-mono text-[11px]" placeholder='{"schemaVersion":"supplier-sourcing-packet/v1", ...}' />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Human minutes"><Input name="humanMinutes" type="number" min="0" step="0.1" defaultValue="0" /></Field>
                <Field label="AI cost (USD)"><Input name="aiCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field>
                <Field label="Tool cost (USD)"><Input name="toolCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field>
              </div>
              <Button type="submit">Validate and freeze Grok packet</Button>
            </WorkCellActionForm>
          ) : null}
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">2. Independent Grok review</p>
            {review ? <Badge tone="good">accepted</Badge> : <Badge>not ingested</Badge>}
          </div>
          {review ? (
            <div className="mt-3 space-y-2 text-sm">
              <p><span className="text-muted">Reviewer: </span>{review.payload.reviewerExecutorKey}</p>
              <p><span className="text-muted">Candidate reviews: </span>{review.payload.candidateReviews.length}</p>
              <p className="break-all font-mono text-[11px] text-muted">packet {shortHash(review.payload.evidencePacketHash)}</p>
              <p><span className="text-muted">Communication disposition: </span>{review.payload.communicationDisposition}</p>
              <FailureList title="Review evidence gaps" items={review.payload.candidateReviews.flatMap((item) => item.evidenceGaps)} tone="warn" />
              <p className="text-xs text-muted">Authority report: {JSON.stringify(review.payload.authorityReport)}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">The second Grok pass challenges supplier identity, fulfillment, compliance, and communication assumptions. It cannot modify the packet.</p>
          )}
          {running && manager && packet && !review ? (
            <WorkCellActionForm action={ingestSupplierSourcingReviewAction} className="mt-5 space-y-4 border-t border-line pt-4">
              <Field label="Raw Grok review" hint={"Must reference packet hash " + packet.contentHash}>
                <Textarea name="raw" required rows={12} className="font-mono text-[11px]" placeholder='{"schemaVersion":"supplier-sourcing-review/v1", ...}' />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Human minutes"><Input name="humanMinutes" type="number" min="0" step="0.1" defaultValue="0" /></Field>
                <Field label="AI cost (USD)"><Input name="aiCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field>
                <Field label="Tool cost (USD)"><Input name="toolCost" type="number" min="0" step="0.0001" defaultValue="0" /></Field>
              </div>
              <Button type="submit">Validate and freeze Grok review</Button>
            </WorkCellActionForm>
          ) : null}
        </Card>
      </div>

      {rejections.length ? (
        <Card className="p-5">
          <p className="font-medium">Rejected executor outputs</p>
          <p className="mt-1 text-sm text-muted">Rejected raw outputs remain immutable audit artifacts and never become supplier evidence.</p>
          <div className="mt-3 space-y-3">
            {rejections.map((rejection) => (
              <div key={rejection.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="bad">rejected</Badge>
                  <span className="text-sm font-medium">{rejection.phase}</span>
                  <span className="text-xs text-muted">{rejection.declaredExecutorKey}</span>
                </div>
                <p className="mt-2 break-all font-mono text-[11px] text-muted">raw {shortHash(rejection.rawOutputHash)}</p>
                <FailureList title="Hard failures" items={rejection.hardFailures} />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">3. Deterministic validation</p>
          {validation ? (
            <Badge tone={validation.hardGatePass ? "good" : "bad"}>{validation.hardGatePass ? "hard gate pass" : "hard gate fail"}</Badge>
          ) : (
            <Badge>not run</Badge>
          )}
        </div>
        {validation ? (
          <div className="mt-4">
            <p className="text-sm text-muted">A pass means the packet and review are contract-valid. It does not verify a supplier relationship, inventory, compliance approval, or a Grounded catalog write.</p>
            <MetricGrid metrics={validation.packet.metrics as unknown as Record<string, number>} />
            <FailureList title="Hard failures" items={validation.hardFailures} />
            <FailureList title="Warnings" items={validation.warnings} tone="warn" />
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">Validation is deterministic and local to the frozen artifacts. It makes no model or network call.</p>
        )}
        {running && manager && packet && review && !validation ? (
          <WorkCellActionForm action={runSupplierSourcingValidationAction} className="mt-5 border-t border-line pt-4">
            <input type="hidden" name="runId" value={runId} />
            <Button type="submit" variant="secondary">Run deterministic supplier validation</Button>
          </WorkCellActionForm>
        ) : null}
      </Card>

      {packet && validation ? (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">4. Supplier communication handoff</p>
            <Badge tone={runStatus === "verified" ? "warn" : "neutral"}>
              {runStatus === "verified" ? "human approval available" : "blocked until receipt"}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">
            Grok can prepare an inquiry, but it cannot send it. A message may be approved only after this run has a passing
            Outcome Receipt, and the destination must be a public channel cited by the reviewed candidate. Approval records an
            exact draft; a qualified delivery connector is still required before any message leaves Grounded.
          </p>
          <div className="mt-4 space-y-4">
            {packet.payload.candidates.map((candidate) => {
              const draft = candidate.outreachDraft;
              const existingApproval = bundle.approvals.find((approval) => approval.candidateId === candidate.candidateId);
              const eligible =
                candidate.status === "candidate" &&
                candidate.supplierIdentity.status === "exact" &&
                candidate.productFit.status === "exact" &&
                (candidate.fulfillment.supplierDirect.status === "supported" ||
                  candidate.fulfillment.partnerFulfilled.status === "supported") &&
                draft.status === "draft" &&
                draft.channel !== null &&
                draft.destination !== null &&
                draft.subject !== null &&
                draft.body !== null;
              return (
                <div key={candidate.candidateId} className="rounded-lg border border-line p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{candidate.candidateId}</span>
                    <Badge tone={eligible ? "warn" : "neutral"}>{eligible ? "eligible for review" : "not eligible"}</Badge>
                    {existingApproval ? <Badge tone="good">approval recorded</Badge> : null}
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    Identity {candidate.supplierIdentity.status}; product fit {candidate.productFit.status}; supplier-direct{" "}
                    {candidate.fulfillment.supplierDirect.status}; partner-fulfilled {candidate.fulfillment.partnerFulfilled.status};
                    seller of record {candidate.fulfillment.sellerOfRecord.value}.
                  </p>
                  {draft.status === "draft" ? (
                    <div className="mt-3 space-y-2">
                      <p className="text-sm font-medium">{draft.subject}</p>
                      <p className="whitespace-pre-wrap text-sm text-muted">{draft.body}</p>
                      <p className="break-all text-xs text-muted">
                        Proposed destination: {draft.destination} · cited facts: {draft.factsUsedSourceUrls.join(", ")}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-muted">Grok did not prepare a draft for this candidate.</p>
                  )}
                  {existingApproval ? (
                    <p className="mt-3 break-all font-mono text-[11px] text-muted">
                      approved {existingApproval.approvedAt} · expires {existingApproval.expiresAt} · draft {shortHash(existingApproval.draftHash)}
                    </p>
                  ) : null}
                  {runStatus === "verified" && manager && eligible && !existingApproval ? (
                    <WorkCellActionForm action={approveSupplierOutreachAction} className="mt-4 space-y-3 border-t border-line pt-4">
                      <input type="hidden" name="runId" value={runId} />
                      <input type="hidden" name="candidateId" value={candidate.candidateId} />
                      <Field label="Channel">
                        <select
                          name="channel"
                          defaultValue={draft.channel ?? ""}
                          className="min-h-11 w-full rounded-lg border border-line bg-surface px-3 text-sm"
                        >
                          {candidate.publicContactChannels.map((channel) => (
                            <option key={channel.channel + ":" + channel.value} value={channel.channel}>
                              {channel.channel}: {channel.value}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Destination" hint="Must exactly match a cited public contact channel.">
                        <Input name="destination" defaultValue={draft.destination ?? ""} required />
                      </Field>
                      <Field label="Subject">
                        <Input name="subject" defaultValue={draft.subject ?? ""} required />
                      </Field>
                      <Field label="Exact message body">
                        <Textarea name="body" defaultValue={draft.body ?? ""} required rows={7} />
                      </Field>
                      <input type="hidden" name="factsUsedSourceUrls" value={JSON.stringify(draft.factsUsedSourceUrls)} />
                      <Field label="Approval expires at" hint="Use an explicit UTC ISO timestamp; expired approvals cannot be delivered.">
                        <Input
                          name="expiresAt"
                          type="text"
                          required
                          placeholder="2026-09-04T00:00:00.000Z"
                        />
                      </Field>
                      <p className="text-xs text-muted">
                        This action stores human approval only. It does not send, schedule, or create a supplier relationship.
                      </p>
                      <Button type="submit" variant="secondary">Record exact draft approval</Button>
                    </WorkCellActionForm>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {running && manager && packet && review && validation ? (
        <Card className="border-line-strong p-5">
          <p className="font-medium">Submit this bounded sourcing attempt</p>
          <p className="mt-1 text-sm text-muted">
            Submission freezes the run and records the deterministic supplier-sourcing verdict into the Gauntlet. It does not
            contact suppliers, approve a relationship, modify Grounded, or publish a kit.
          </p>
          <WorkCellActionForm action={submitSupplierSourcingRunAction} className="mt-4">
            <input type="hidden" name="runId" value={runId} />
            <Button type="submit">Freeze and submit for verification</Button>
          </WorkCellActionForm>
        </Card>
      ) : null}

      {awaitingVerification ? (
        <Card className="p-5">
          <p className="font-medium">Verification handoff</p>
          <p className="mt-1 text-sm text-muted">
            The deterministic Gauntlet review has been recorded. An operations manager must issue the normal immutable Outcome Receipt.
            External supplier communication remains a separate human-approved capability and is not automatically sent.
          </p>
        </Card>
      ) : null}

      {runStatus === "verified" ? (
        <Card className="p-5">
          <p className="font-medium">Communication boundary</p>
          <p className="mt-1 text-sm text-muted">
            This sourcing run is verified, but no supplier message is transmitted automatically. A separate exact-draft approval
            artifact and an approved delivery connector are still required.
          </p>
        </Card>
      ) : null}
    </section>
  );
}
