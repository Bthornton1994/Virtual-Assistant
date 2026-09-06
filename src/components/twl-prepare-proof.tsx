import {
  assignTwlPrepareProofWorkerAction,
  attachTwlPrepareProofPrEvidenceAction,
} from "@/app/actions/twl-prepare-proof";
import { WorkCellActionForm } from "@/components/work-cell-action-form";
import { TwlPrepareProofAssignFields } from "@/components/twl-prepare-proof-assign-fields";
import { Badge, Button, Card, Field, Input } from "@/components/ui";
import type { Operator } from "@/lib/domain";
import { TWL_DEFAULT_PR_TARGET } from "@/lib/public-github-pr";
import {
  TWL_PREPARE_PROOF_FORBIDDEN_ACTIONS,
  TWL_PREPARE_PROOF_SPEC,
} from "@/lib/twl-prepare-proof";
import { previewTwlPrepareProof } from "@/lib/twl-prepare-proof-run";
import type { EvidenceArtifact, WorkstreamRun } from "@/lib/execution-primitives";

function releaseTone(decision: string): "good" | "warn" | "bad" | "neutral" {
  if (decision === "ready_for_human_review") return "good";
  if (decision === "escalate") return "bad";
  if (decision === "hold") return "warn";
  return "neutral";
}

export function TwlPrepareProofSection({
  spec,
  run,
  evidence,
  actorRole,
  operators,
}: {
  spec: { actionClass: string; requiredInputs: readonly string[] };
  run: WorkstreamRun;
  evidence: EvidenceArtifact[];
  actorRole: string;
  operators: Operator[];
}) {
  const preview = previewTwlPrepareProof({ spec, run, evidence, actorRole });
  const running = run.status === "running";
  const humanOperators = operators.filter((operator) => operator.status === "active");

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Prepare-only public PR proof</h2>
        <p className="max-w-3xl text-sm text-muted">
          QA proof {TWL_PREPARE_PROOF_SPEC.key}. This is not a live always-on operator. The assigned
          worker can attach read-only public GitHub metadata. Accept still requires an operations
          manager and the hashed evidence. Merge, deploy, secrets, and GitHub writes stay closed.
        </p>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{run.status.replaceAll("_", " ")}</Badge>
          <Badge tone="info">{TWL_PREPARE_PROOF_SPEC.actionClass.replaceAll("_", " ")}</Badge>
          <Badge tone={releaseTone(preview.verdict.release.decision)}>
            {preview.verdict.release.decision.replaceAll("_", " ")}
          </Badge>
        </div>
        <p className="mt-3 text-sm">{preview.verdict.release.reason}</p>
        <p className="mt-2 text-xs text-muted">
          merge_performed=false · mutatesRepository=false · deploy unauthorized
        </p>
        {preview.verdict.failures.length ? (
          <ul className="mt-3 space-y-1 text-sm text-bad">
            {preview.verdict.failures.map((failure) => (
              <li key={failure}>• {failure}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Deterministic checks are satisfied. An operations manager may still refuse the receipt.
          </p>
        )}
        {preview.verdict.escalation.required ? (
          <p className="mt-3 text-sm text-bad">
            Escalate to an operations manager: {preview.verdict.escalation.reasons.join(", ")}.
          </p>
        ) : null}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Assigned worker</p>
          {preview.assignment ? (
            <div className="mt-3 space-y-1 text-sm">
              <p>
                <span className="text-muted">Kind: </span>
                {preview.assignment.workerKind.replaceAll("_", " ")}
              </p>
              <p>
                <span className="text-muted">Name: </span>
                {preview.assignment.displayName}
              </p>
              <p>
                <span className="text-muted">May Accept: </span>
                no
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">No worker is assigned yet.</p>
          )}
          {running ? (
            <WorkCellActionForm action={assignTwlPrepareProofWorkerAction} className="mt-4 space-y-4 border-t border-line pt-4">
              <input type="hidden" name="runId" value={run.id} />
              <TwlPrepareProofAssignFields operators={humanOperators} />
              <Button type="submit" variant="secondary">Assign worker</Button>
            </WorkCellActionForm>
          ) : (
            <p className="mt-3 text-sm text-muted">Start the run before assigning a worker.</p>
          )}
        </Card>

        <Card className="p-5">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Public PR evidence</p>
          {preview.pr ? (
            <div className="mt-3 space-y-1 text-sm">
              <p>
                <span className="text-muted">PR: </span>
                <a className="text-accent underline" href={preview.pr.htmlUrl} rel="noreferrer" target="_blank">
                  {preview.pr.owner}/{preview.pr.repo}#{preview.pr.pullNumber}
                </a>
              </p>
              <p className="break-all">
                <span className="text-muted">Head: </span>
                <span className="font-mono text-xs">{preview.pr.headSha}</span>
              </p>
              <p className="break-all">
                <span className="text-muted">Base: </span>
                <span className="font-mono text-xs">{preview.pr.baseSha}</span>
              </p>
              <p>
                <span className="text-muted">CI: </span>
                {preview.pr.ciConclusion ?? "not reported"}
              </p>
              <p className="break-all font-mono text-[11px] text-muted">sha256:{preview.pr.payloadHash.slice(0, 16)}…</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">No public PR metadata has been hashed onto this run.</p>
          )}
          {running ? (
            <WorkCellActionForm action={attachTwlPrepareProofPrEvidenceAction} className="mt-4 space-y-4 border-t border-line pt-4">
              <input type="hidden" name="runId" value={run.id} />
              <Field label="Owner">
                <Input name="owner" defaultValue={TWL_DEFAULT_PR_TARGET.owner} />
              </Field>
              <Field label="Repository">
                <Input name="repo" defaultValue={TWL_DEFAULT_PR_TARGET.repo} />
              </Field>
              <Field label="Pull number" hint="Public repository only. GET metadata. No merge or comment write.">
                <Input name="pullNumber" type="number" min={1} defaultValue={String(TWL_DEFAULT_PR_TARGET.pullNumber)} />
              </Field>
              <Button type="submit">Attach public PR evidence</Button>
            </WorkCellActionForm>
          ) : (
            <p className="mt-3 text-sm text-muted">Start the run before attaching public PR evidence.</p>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted">Closed actions</p>
        <p className="mt-2 text-sm text-muted">
          {TWL_PREPARE_PROOF_FORBIDDEN_ACTIONS.join(", ").replaceAll("_", " ")}
        </p>
      </Card>
    </section>
  );
}
