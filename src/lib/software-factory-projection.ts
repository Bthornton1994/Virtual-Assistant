import type { Actor } from "@/lib/domain";
import type { EvidenceArtifact, EvidenceKind, OutcomeReceipt } from "@/lib/execution-primitives";
import {
  SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
  type SoftwareFactoryEvidenceKind,
  type SoftwareFactoryEvidenceRecord,
  type SoftwareFactoryReceipt,
  type SoftwareFactoryRun,
} from "@/lib/software-factory-run-manager";

/**
 * Maps Software Factory artifacts onto the existing Delegation Cloud evidence
 * and Outcome Receipt tables. GitHub/Grok/Cursor never become a parallel SoT.
 */
export const SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND: Record<
  SoftwareFactoryEvidenceKind,
  EvidenceKind
> = {
  repository_inspection: "source",
  task_packet: "other",
  worker_handoff: "communication",
  cursor_execution: "observation",
  pull_request: "source",
  ci: "test",
  test: "test",
  lint: "test",
  typecheck: "test",
  build: "test",
  browser: "test",
  agent_report: "observation",
  blocker: "observation",
  owner_decision: "other",
  other: "other",
};

export function projectSoftwareFactoryEvidenceArtifact(input: {
  factoryRun: SoftwareFactoryRun;
  evidence: SoftwareFactoryEvidenceRecord;
  actor: Actor;
  now: string;
}): EvidenceArtifact | { ok: false; failures: string[] } {
  if (!input.factoryRun.workstreamRunId) {
    return { ok: false, failures: ["Evidence can only project onto a Workstream Run."] };
  }
  return {
    id: input.evidence.evidenceId,
    organizationId: input.factoryRun.organizationId,
    runId: input.factoryRun.workstreamRunId,
    requestId: null,
    kind: SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND[input.evidence.kind],
    summary: input.evidence.summary,
    sourceUri: input.evidence.sourceUri,
    contentHash: input.evidence.contentHash,
    payload: {
      schemaVersion: SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
      factoryKind: input.evidence.kind,
      factoryRunId: input.factoryRun.id,
      taskId: input.factoryRun.taskId,
      conclusion: input.evidence.conclusion,
      satisfiedCriteria: input.evidence.satisfiedCriteria,
      mutatesRepository: false,
      recordedAt: input.evidence.recordedAt,
    },
    observedAt: input.evidence.recordedAt,
    createdBy: input.actor.id,
    createdAt: input.now,
  };
}

export function projectSoftwareFactoryOutcomeReceipt(input: {
  factoryRun: SoftwareFactoryRun;
  receipt: SoftwareFactoryReceipt;
  actor: Actor;
  now: string;
}): OutcomeReceipt | { ok: false; failures: string[] } {
  if (!input.factoryRun.workstreamRunId) {
    return { ok: false, failures: ["An Outcome Receipt requires a Workstream Run."] };
  }
  return {
    id: input.receipt.receiptId,
    organizationId: input.factoryRun.organizationId,
    runId: input.factoryRun.workstreamRunId,
    verificationStatus: input.receipt.verificationStatus,
    definitionOfDoneMet: input.receipt.definitionOfDoneMet,
    summary: input.receipt.summary,
    verificationNotes: [
      `packetHash=${input.receipt.packetHash}`,
      `ownerDecisionIds=${input.receipt.ownerDecisionIds.join(",") || "none"}`,
      "mergePerformed=false",
      "repositoryMutated=false",
    ].join(" "),
    actionsTaken: [
      "prepare_only",
      "no_merge",
      "no_deploy",
      "no_secret_change",
      "no_github_mutation",
    ],
    exceptions: input.receipt.unresolvedBlockers,
    unresolvedDecisions: input.receipt.verificationStatus === "passed" ? [] : input.receipt.unresolvedBlockers,
    qaScore: null,
    verifiedBy: input.actor.id,
    verifiedAt: input.receipt.verifiedAt,
    createdAt: input.now,
  };
}

export function isProjectedEvidenceArtifact(
  value: EvidenceArtifact | { ok: false; failures: string[] },
): value is EvidenceArtifact {
  return !("ok" in value);
}

export function isProjectedOutcomeReceipt(
  value: OutcomeReceipt | { ok: false; failures: string[] },
): value is OutcomeReceipt {
  return !("ok" in value);
}
