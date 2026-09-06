import { AuthzError, DomainError, isOpsRole, type Actor } from "@/lib/domain";
import { getWorkstreamRunBundle, type EvidenceArtifact, type EvidenceKind } from "@/lib/execution-primitives";
import { parsePublicPullRequestTarget } from "@/lib/public-github-pr";
import { supabaseServer } from "@/lib/supabase/server";
import {
  TWL_PREPARE_PROOF_SPEC,
  evaluateTwlPrepareProofAccept,
  isTwlPrepareProofSpec,
  parseTwlPrepareProofAssignment,
  parseTwlPrepareProofPrEvidence,
  summarizeTwlPrepareProof,
} from "@/lib/twl-prepare-proof";

function canOperate(actor: Actor) {
  return isOpsRole(actor.role);
}

function mapEvidenceRow(row: Record<string, unknown>): EvidenceArtifact {
  const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? (row.payload as Record<string, unknown>)
    : {};
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    runId: String(row.run_id),
    requestId: (row.request_id as string) ?? null,
    kind: row.kind as EvidenceKind,
    summary: String(row.summary ?? ""),
    sourceUri: (row.source_uri as string) ?? null,
    contentHash: (row.content_hash as string) ?? null,
    payload,
    observedAt: String(row.observed_at),
    createdBy: (row.created_by as string) ?? null,
    createdAt: String(row.created_at),
  };
}

async function loadEvidenceById(artifactId: string) {
  const db = await supabaseServer();
  if (!db) throw new DomainError("Execution primitives require Supabase.");
  const { data, error } = await db.from("evidence_artifacts").select("*").eq("id", artifactId).maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) throw new DomainError("The reserved TWL evidence writer did not persist an artifact.");
  return mapEvidenceRow(data as Record<string, unknown>);
}

async function patchExecutorSummary(
  actor: Actor,
  runId: string,
  organizationId: string,
  patch: Record<string, unknown>,
) {
  const db = await supabaseServer();
  if (!db) throw new DomainError("Execution primitives require Supabase.");
  const { data, error } = await db
    .from("workstream_runs")
    .select("executor_summary")
    .eq("id", runId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  const current =
    data?.executor_summary && typeof data.executor_summary === "object" && !Array.isArray(data.executor_summary)
      ? (data.executor_summary as Record<string, unknown>)
      : {};
  const { error: updateError } = await db
    .from("workstream_runs")
    .update({
      executor_summary: {
        ...current,
        proofKey: TWL_PREPARE_PROOF_SPEC.key,
        ...patch,
      },
    })
    .eq("id", runId)
    .eq("organization_id", organizationId);
  if (updateError) throw new DomainError(updateError.message);
  void actor;
}

export async function assignTwlPrepareProofWorker(
  actor: Actor,
  runId: string,
  input: { workerKind: "human_operator" | "shadow"; workerKey?: string; displayName?: string },
) {
  if (!canOperate(actor)) throw new AuthzError("Only operations staff can assign a prepare-only worker.");
  const bundle = await getWorkstreamRunBundle(actor, runId);
  if (!isTwlPrepareProofSpec(bundle.spec)) {
    throw new DomainError("This run is not the SF-TWL-PREPARE-PROOF-01 contract.");
  }
  if (bundle.spec.actionClass !== "prepare_only") {
    throw new DomainError("This proof only runs under prepare_only.");
  }
  if (bundle.run.status !== "running") {
    throw new DomainError("Start the run before assigning a worker. Evidence cannot be attached until then.");
  }

  const workerKey = input.workerKind === "human_operator" ? String(input.workerKey || "").trim() : null;
  if (input.workerKind === "human_operator" && !workerKey) {
    throw new DomainError("A human operator assignment needs an operator id.");
  }

  const db = await supabaseServer();
  if (!db) throw new DomainError("Execution primitives require Supabase.");
  const { data: artifactId, error } = await db.rpc("twl_prepare_proof_assign_worker", {
    p_run_id: runId,
    p_worker_kind: input.workerKind,
    p_worker_key: workerKey,
  });
  if (error) throw new DomainError(error.message);
  if (!artifactId) throw new DomainError("The database assignment writer did not return an evidence artifact id.");

  const evidence = await loadEvidenceById(String(artifactId));
  const parsed = parseTwlPrepareProofAssignment(evidence.payload);
  if (!parsed.success) {
    throw new DomainError("The database assignment writer returned evidence outside the frozen TWL assignment schema.");
  }
  const assignment = parsed.data;

  await patchExecutorSummary(actor, runId, bundle.run.organizationId, {
    assignedWorker: {
      workerKind: assignment.workerKind,
      workerKey: assignment.workerKey,
      displayName: assignment.displayName,
      mayOwnAccept: false,
    },
  });

  return { evidence, assignment };
}

export async function attachTwlPrepareProofPrEvidence(
  actor: Actor,
  runId: string,
  targetInput: { owner?: string; repo?: string; pullNumber?: string | number } = {},
) {
  if (!canOperate(actor)) throw new AuthzError("Only operations staff can attach public PR evidence.");
  const bundle = await getWorkstreamRunBundle(actor, runId);
  if (!isTwlPrepareProofSpec(bundle.spec)) {
    throw new DomainError("This run is not the SF-TWL-PREPARE-PROOF-01 contract.");
  }
  if (bundle.spec.actionClass !== "prepare_only") {
    throw new DomainError("This proof only runs under prepare_only.");
  }
  if (bundle.run.status !== "running") {
    throw new DomainError("Start the run before attaching public PR evidence.");
  }

  const target = parsePublicPullRequestTarget(targetInput);
  const db = await supabaseServer();
  if (!db) throw new DomainError("Execution primitives require Supabase.");
  const { data: artifactId, error } = await db.rpc("twl_prepare_proof_attach_public_pr", {
    p_run_id: runId,
    p_owner: target.owner,
    p_repo: target.repo,
    p_pull_number: target.pullNumber,
  });
  if (error) throw new DomainError(error.message);
  if (!artifactId) throw new DomainError("The database public-GitHub reader did not return an evidence artifact id.");

  const evidence = await loadEvidenceById(String(artifactId));
  const parsed = parseTwlPrepareProofPrEvidence(evidence.payload);
  if (!parsed.success) {
    throw new DomainError("The database public-GitHub reader returned evidence outside the frozen TWL PR schema.");
  }
  const payload = parsed.data;
  const metadata = {
    owner: payload.owner,
    repo: payload.repo,
    pullNumber: payload.pullNumber,
    htmlUrl: payload.htmlUrl,
    headSha: payload.headSha,
    baseSha: payload.baseSha,
    title: payload.title,
    state: payload.state,
    draft: payload.draft,
    upstreamMerged: payload.upstreamMerged,
    ciConclusion: payload.ciConclusion,
  };

  await patchExecutorSummary(actor, runId, bundle.run.organizationId, {
    publicPr: {
      owner: metadata.owner,
      repo: metadata.repo,
      pullNumber: metadata.pullNumber,
      htmlUrl: metadata.htmlUrl,
      headSha: metadata.headSha,
      baseSha: metadata.baseSha,
      ciConclusion: metadata.ciConclusion,
      mutatesRepository: false,
      mergePerformed: false,
    },
  });

  return { evidence, metadata, payload };
}

export function previewTwlPrepareProof(bundle: {
  spec: { actionClass: string; requiredInputs: readonly string[] };
  run: { executorSummary: Record<string, unknown> };
  evidence: EvidenceArtifact[];
  actorRole: string;
}) {
  return summarizeTwlPrepareProof({
    spec: bundle.spec,
    evidence: bundle.evidence,
    actorRole: bundle.actorRole,
    executorSummary: bundle.run.executorSummary,
  });
}

export function acceptGateForTwlPrepareProof(bundle: {
  spec: { actionClass: string; requiredInputs: readonly string[] };
  run: { executorSummary: Record<string, unknown> };
  evidence: EvidenceArtifact[];
  actorRole: string;
}) {
  return evaluateTwlPrepareProofAccept({
    spec: bundle.spec,
    evidence: bundle.evidence,
    actorRole: bundle.actorRole,
    executorSummary: bundle.run.executorSummary,
  });
}
