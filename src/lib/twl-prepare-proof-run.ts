import { AuthzError, DomainError, isOpsRole, type Actor } from "@/lib/domain";
import {
  addEvidenceArtifact,
  getWorkstreamRunBundle,
  type EvidenceArtifact,
} from "@/lib/execution-primitives";
import {
  fetchPublicPullRequestMetadata,
  parsePublicPullRequestTarget,
  type GithubJsonFetcher,
  type PublicPullRequestTarget,
} from "@/lib/public-github-pr";
import { supabaseServer } from "@/lib/supabase/server";
import {
  TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
  TWL_PREPARE_PROOF_PR_SCHEMA,
  TWL_PREPARE_PROOF_SHADOW_KEY,
  TWL_PREPARE_PROOF_SPEC,
  evaluateTwlPrepareProofAccept,
  isTwlPrepareProofSpec,
  sealTwlPrepareProofPayload,
  summarizeTwlPrepareProof,
  type TwlPrepareProofAssignment,
} from "@/lib/twl-prepare-proof";

function canOperate(actor: Actor) {
  return isOpsRole(actor.role);
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

  const workerKind = input.workerKind;
  const workerKey =
    workerKind === "shadow"
      ? TWL_PREPARE_PROOF_SHADOW_KEY
      : String(input.workerKey || "").trim();
  const displayName =
    workerKind === "shadow"
      ? "SF-TWL prepare-only shadow"
      : String(input.displayName || "").trim();
  if (!workerKey || !displayName) {
    throw new DomainError("A human operator assignment needs both an operator id and a display name.");
  }

  const payload = sealTwlPrepareProofPayload({
    schemaVersion: TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
    workerKind,
    workerKey,
    displayName,
    mayOwnAccept: false as const,
    actionClass: "prepare_only" as const,
    assignedBy: actor.id,
    assignedAt: new Date().toISOString(),
  });

  const evidence = await addEvidenceArtifact(actor, runId, {
    kind: "observation",
    summary:
      workerKind === "shadow"
        ? "Assigned the prepare-only shadow worker. It cannot Accept, merge, deploy, or write to GitHub."
        : `Assigned human operator ${displayName}. This worker cannot Accept alone.`,
    sourceUri: null,
    payload,
  });

  await patchExecutorSummary(actor, runId, bundle.run.organizationId, {
    assignedWorker: {
      workerKind,
      workerKey,
      displayName,
      mayOwnAccept: false,
    },
  });

  return { evidence, assignment: payload as TwlPrepareProofAssignment };
}

export async function attachTwlPrepareProofPrEvidence(
  actor: Actor,
  runId: string,
  targetInput: Partial<PublicPullRequestTarget> = {},
  fetchJson?: GithubJsonFetcher,
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
  const metadata = await fetchPublicPullRequestMetadata(target, fetchJson);
  const payload = sealTwlPrepareProofPayload({
    schemaVersion: TWL_PREPARE_PROOF_PR_SCHEMA,
    owner: metadata.owner,
    repo: metadata.repo,
    pullNumber: metadata.pullNumber,
    htmlUrl: metadata.htmlUrl,
    headSha: metadata.headSha,
    baseSha: metadata.baseSha,
    title: metadata.title,
    state: metadata.state,
    draft: metadata.draft,
    upstreamMerged: metadata.upstreamMerged,
    ciConclusion: metadata.ciConclusion,
    mutatesRepository: false as const,
    mergePerformed: false as const,
    requestedMethod: "GET" as const,
    fetchedAt: new Date().toISOString(),
    source: "github-public-api" as const,
  });

  const evidence = await addEvidenceArtifact(actor, runId, {
    kind: "source",
    summary: `Read-only public PR ${metadata.owner}/${metadata.repo}#${metadata.pullNumber}. mutatesRepository=false; merge_performed=false.`,
    sourceUri: metadata.htmlUrl,
    payload,
  });

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
  spec: { actionClass: string; requiredInputs: string[] };
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
  spec: { actionClass: string; requiredInputs: string[] };
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
