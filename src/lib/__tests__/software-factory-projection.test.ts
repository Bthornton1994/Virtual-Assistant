import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/domain";
import {
  SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND,
  isProjectedEvidenceArtifact,
  isProjectedOutcomeReceipt,
  projectSoftwareFactoryEvidenceArtifact,
  projectSoftwareFactoryOutcomeReceipt,
} from "@/lib/software-factory-projection";
import {
  SOFTWARE_FACTORY_ACTION_CLASS,
  SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
  SOFTWARE_FACTORY_RECEIPT_SCHEMA_VERSION,
  type SoftwareFactoryEvidenceRecord,
  type SoftwareFactoryReceipt,
  type SoftwareFactoryRun,
} from "@/lib/software-factory-run-manager";

const NOW = "2026-09-18T10:00:00.000Z";
const HASH = "a".repeat(64);

const operator: Actor = {
  id: "operator-1",
  email: "operator-1@delegation.cloud",
  name: "Operator",
  role: "operator",
  organizationId: null,
  operatorId: "op-1",
  source: "demo",
};

function factoryRun(workstreamRunId: string | null): SoftwareFactoryRun {
  return {
    id: "sfr-1",
    organizationId: "org-northline",
    taskId: "SF-LOAD-001",
    workstreamRunId,
    delegationSpecId: "spec-1",
    lifecycleStatus: "in_progress",
    actionClass: SOFTWARE_FACTORY_ACTION_CLASS,
    mayOwnAuthoritativeState: false,
    mergeAuthorizedForHuman: false,
    mergePerformed: false,
    repository: "Bthornton1994/Loadout",
    baseBranch: "main",
    frozenInScope: [],
    frozenAcceptanceCriteria: [],
    packet: null,
    packetHash: null,
    version: 1,
    connectors: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const evidence: SoftwareFactoryEvidenceRecord = {
  schemaVersion: SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
  evidenceId: "ev-pr-1",
  kind: "pull_request",
  summary: "Historical Loadout PR evidence.",
  sourceUri: "https://github.com/Bthornton1994/Loadout/pull/26",
  conclusion: "pass",
  satisfiedCriteria: [],
  contentHash: HASH,
  recordedAt: NOW,
  mutatesRepository: false,
};

function receipt(overrides: Partial<SoftwareFactoryReceipt> = {}): SoftwareFactoryReceipt {
  return {
    schemaVersion: SOFTWARE_FACTORY_RECEIPT_SCHEMA_VERSION,
    receiptId: "receipt-1",
    factoryRunId: "sfr-1",
    workstreamRunId: "wsr-1",
    taskId: "SF-LOAD-001",
    verificationStatus: "failed",
    definitionOfDoneMet: false,
    lifecycleStatus: "awaiting_owner",
    summary: "Owner merge approval recorded. Merge was not performed.",
    packetHash: HASH,
    evidenceHashes: [HASH],
    ownerDecisionIds: [],
    unresolvedBlockers: ["Merge remains blocked"],
    authorityIncidents: 0,
    mergePerformed: false,
    repositoryMutated: false,
    verifiedAt: NOW,
    ...overrides,
  };
}

describe("Software Factory projection onto canonical evidence", () => {
  it("maps factory evidence kinds onto existing artifact kinds", () => {
    expect(SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND.repository_inspection).toBe("source");
    expect(SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND.ci).toBe("test");
    expect(SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND.blocker).toBe("observation");
    expect(SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND.owner_decision).toBe("other");
  });

  it("refuses to project evidence or receipts without a Workstream Run", () => {
    const unbound = factoryRun(null);
    const projectedEvidence = projectSoftwareFactoryEvidenceArtifact({
      factoryRun: unbound,
      evidence,
      actor: operator,
      now: NOW,
    });
    expect(isProjectedEvidenceArtifact(projectedEvidence)).toBe(false);
    expect(projectedEvidence).toEqual({
      ok: false,
      failures: ["Evidence can only project onto a Workstream Run."],
    });

    const projectedReceipt = projectSoftwareFactoryOutcomeReceipt({
      factoryRun: unbound,
      receipt: receipt(),
      actor: operator,
      now: NOW,
    });
    expect(isProjectedOutcomeReceipt(projectedReceipt)).toBe(false);
    expect(projectedReceipt).toEqual({
      ok: false,
      failures: ["An Outcome Receipt requires a Workstream Run."],
    });
  });

  it("projects bound evidence onto the Workstream Run without claiming a merge", () => {
    const projected = projectSoftwareFactoryEvidenceArtifact({
      factoryRun: factoryRun("wsr-1"),
      evidence,
      actor: operator,
      now: NOW,
    });
    expect(isProjectedEvidenceArtifact(projected)).toBe(true);
    if (!isProjectedEvidenceArtifact(projected)) throw new Error("expected evidence artifact");
    expect(projected.runId).toBe("wsr-1");
    expect(projected.organizationId).toBe("org-northline");
    expect(projected.kind).toBe("source");
    expect(projected.payload.mutatesRepository).toBe(false);
    expect(projected.payload.factoryRunId).toBe("sfr-1");
    expect(projected.createdBy).toBe(operator.id);
  });

  it("copies unresolved blockers only when the receipt did not pass", () => {
    const failed = projectSoftwareFactoryOutcomeReceipt({
      factoryRun: factoryRun("wsr-1"),
      receipt: receipt(),
      actor: operator,
      now: NOW,
    });
    expect(isProjectedOutcomeReceipt(failed)).toBe(true);
    if (!isProjectedOutcomeReceipt(failed)) throw new Error("expected receipt");
    expect(failed.unresolvedDecisions).toEqual(["Merge remains blocked"]);
    expect(failed.verificationNotes).toMatch(/mergePerformed=false/);
    expect(failed.actionsTaken).toEqual([
      "prepare_only",
      "no_merge",
      "no_deploy",
      "no_secret_change",
      "no_github_mutation",
    ]);

    const passed = projectSoftwareFactoryOutcomeReceipt({
      factoryRun: factoryRun("wsr-1"),
      receipt: receipt({
        verificationStatus: "passed",
        definitionOfDoneMet: true,
        unresolvedBlockers: [],
      }),
      actor: operator,
      now: NOW,
    });
    expect(isProjectedOutcomeReceipt(passed)).toBe(true);
    if (!isProjectedOutcomeReceipt(passed)) throw new Error("expected receipt");
    expect(passed.unresolvedDecisions).toEqual([]);
  });
});
