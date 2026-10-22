import { describe, expect, it } from "vitest";
import type { Actor } from "@/lib/domain";
import type { EvidenceKind } from "@/lib/execution-primitives";
import {
  SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND,
  isProjectedEvidenceArtifact,
  isProjectedOutcomeReceipt,
  projectSoftwareFactoryEvidenceArtifact,
  projectSoftwareFactoryOutcomeReceipt,
} from "@/lib/software-factory-projection";
import {
  SOFTWARE_FACTORY_ACTION_CLASS,
  SOFTWARE_FACTORY_EVIDENCE_KINDS,
  SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
  SOFTWARE_FACTORY_RECEIPT_SCHEMA_VERSION,
  type SoftwareFactoryEvidenceKind,
  type SoftwareFactoryEvidenceRecord,
  type SoftwareFactoryReceipt,
  type SoftwareFactoryRun,
} from "@/lib/software-factory-run-manager";

const NOW = "2026-09-04T12:00:00.000Z";

const actor: Actor = {
  id: "manager-1",
  email: "manager-1@delegation.cloud",
  name: "manager-1",
  role: "ops_manager",
  organizationId: null,
  operatorId: null,
  source: "demo",
};

function factoryRun(workstreamRunId: string | null): SoftwareFactoryRun {
  return {
    id: "sfr-1",
    organizationId: "org-northline",
    taskId: "SF-LOAD-001",
    workstreamRunId,
    delegationSpecId: "spec-1",
    lifecycleStatus: "awaiting_owner",
    actionClass: SOFTWARE_FACTORY_ACTION_CLASS,
    mayOwnAuthoritativeState: false,
    mergeAuthorizedForHuman: false,
    mergePerformed: false,
    repository: "Bthornton1994/Loadout",
    baseBranch: "main",
    frozenInScope: ["Record evidence"],
    frozenAcceptanceCriteria: ["Owner acceptance is recorded outside the packet."],
    packet: null,
    packetHash: "a".repeat(64),
    version: 1,
    connectors: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function evidence(kind: SoftwareFactoryEvidenceKind): SoftwareFactoryEvidenceRecord {
  return {
    schemaVersion: SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
    evidenceId: `ev-${kind}`,
    kind,
    summary: `${kind} leftover projection`,
    sourceUri: null,
    contentHash: "b".repeat(64),
    conclusion: "recorded",
    satisfiedCriteria: [],
    recordedAt: NOW,
    mutatesRepository: false,
  };
}

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
    summary: "Leftover projection receipt",
    packetHash: "a".repeat(64),
    evidenceHashes: ["b".repeat(64)],
    ownerDecisionIds: [],
    unresolvedBlockers: ["Merge remains blocked"],
    authorityIncidents: 0,
    mergePerformed: false,
    repositoryMutated: false,
    verifiedAt: NOW,
    ...overrides,
  };
}

describe("software-factory leftover projection gates", () => {
  it("refuses leftover evidence and leftover receipts that are not bound to a Workstream Run", () => {
    const unbound = factoryRun(null);
    const projectedEvidence = projectSoftwareFactoryEvidenceArtifact({
      factoryRun: unbound,
      evidence: evidence("pull_request"),
      actor,
      now: NOW,
    });
    const projectedReceipt = projectSoftwareFactoryOutcomeReceipt({
      factoryRun: unbound,
      receipt: receipt(),
      actor,
      now: NOW,
    });

    expect(isProjectedEvidenceArtifact(projectedEvidence)).toBe(false);
    expect(isProjectedOutcomeReceipt(projectedReceipt)).toBe(false);
    expect(projectedEvidence).toEqual({
      ok: false,
      failures: ["Evidence can only project onto a Workstream Run."],
    });
    expect(projectedReceipt).toEqual({
      ok: false,
      failures: ["An Outcome Receipt requires a Workstream Run."],
    });
  });

  it("maps leftover Software Factory evidence kinds onto leftover artifact kinds without mutation", () => {
    const expected: Record<SoftwareFactoryEvidenceKind, EvidenceKind> = {
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

    expect(SOFTWARE_FACTORY_EVIDENCE_KINDS).toEqual(Object.keys(expected));
    for (const kind of SOFTWARE_FACTORY_EVIDENCE_KINDS) {
      expect(SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND[kind], kind).toBe(expected[kind]);
    }

    const projected = projectSoftwareFactoryEvidenceArtifact({
      factoryRun: factoryRun("wsr-1"),
      evidence: evidence("ci"),
      actor,
      now: NOW,
    });
    expect(isProjectedEvidenceArtifact(projected)).toBe(true);
    if (!isProjectedEvidenceArtifact(projected)) throw new Error("expected projected evidence");
    expect(projected.kind).toBe("test");
    expect(projected.runId).toBe("wsr-1");
    expect(projected.payload.mutatesRepository).toBe(false);
    expect(projected.payload.factoryKind).toBe("ci");
  });

  it("does not treat leftover failed receipts as passed, and does not copy leftover blockers onto a passed receipt", () => {
    const failed = projectSoftwareFactoryOutcomeReceipt({
      factoryRun: factoryRun("wsr-1"),
      receipt: receipt(),
      actor,
      now: NOW,
    });
    expect(isProjectedOutcomeReceipt(failed)).toBe(true);
    if (!isProjectedOutcomeReceipt(failed)) throw new Error("expected projected receipt");
    expect(failed.verificationStatus).toBe("failed");
    expect(failed.definitionOfDoneMet).toBe(false);
    expect(failed.unresolvedDecisions).toEqual(["Merge remains blocked"]);
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
        lifecycleStatus: "accepted",
        unresolvedBlockers: ["stale leftover blocker"],
      }),
      actor,
      now: NOW,
    });
    expect(isProjectedOutcomeReceipt(passed)).toBe(true);
    if (!isProjectedOutcomeReceipt(passed)) throw new Error("expected projected receipt");
    expect(passed.verificationStatus).toBe("passed");
    expect(passed.unresolvedDecisions).toEqual([]);
    expect(passed.exceptions).toEqual(["stale leftover blocker"]);
  });
});
