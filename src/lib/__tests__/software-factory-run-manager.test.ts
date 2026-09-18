import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { AuthzError, type Actor } from "@/lib/domain";
import {
  SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND,
  isProjectedEvidenceArtifact,
  isProjectedOutcomeReceipt,
  projectSoftwareFactoryEvidenceArtifact,
  projectSoftwareFactoryOutcomeReceipt,
} from "@/lib/software-factory-projection";
import {
  SOFTWARE_FACTORY_ACTION_CLASS,
  SOFTWARE_FACTORY_CAPABILITY_KEY,
  SOFTWARE_FACTORY_CONNECTORS,
  SOFTWARE_FACTORY_CURSOR_EXECUTION_SCHEMA_VERSION,
  SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
  SOFTWARE_FACTORY_INTAKE_SCHEMA_VERSION,
  SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
  SOFTWARE_FACTORY_RECEIPT_SCHEMA_VERSION,
  SOFTWARE_FACTORY_RUN_INPUT,
  canTransitionSoftwareFactory,
  evaluateAcceptance,
  freezeEvidenceRecord,
  hashSoftwareFactoryPacket,
  isSoftwareFactorySpec,
  isSoftwareFactoryTerminal,
  latestOwnerAcceptance,
  packetClaimsSelfAuthorization,
  projectSoftwareFactoryWorkstreamStatus,
  softwareFactoryConnectorCatalog,
  softwareFactoryStaffControlsOpen,
  validateSoftwareFactoryPacket,
} from "@/lib/software-factory-run-manager";
import {
  attachSoftwareFactoryEvidence,
  attemptSoftwareFactoryForbiddenAction,
  createSoftwareFactoryStore,
  getSoftwareFactoryRun,
  inspectSoftwareFactoryRepository,
  issueSoftwareFactoryOutcomeReceipt,
  listSoftwareFactoryRunsForOrg,
  produceSoftwareFactoryPacket,
  provisionSoftwareFactoryRun,
  recordMissingConnectorHandoffs,
  recordSoftwareFactoryHandoff,
  recordSoftwareFactoryOwnerDecision,
  requestSoftwareFactoryApproval,
  softwareFactoryAuditHistory,
  softwareFactoryProblems,
  submitSoftwareWorkRequest,
  trackCursorCloudAgentExecution,
  transitionSoftwareFactoryRun,
  type SoftwareFactoryStore,
} from "@/lib/software-factory-store";

const NOW = "2026-09-04T12:00:00.000Z";
const LATER = "2026-09-08T12:00:00.000Z";

function actor(overrides: Partial<Actor> & Pick<Actor, "id" | "role">): Actor {
  return {
    email: `${overrides.id}@delegation.cloud`,
    name: overrides.id,
    organizationId: "org-northline",
    operatorId: null,
    source: "demo",
    ...overrides,
  };
}

const owner = actor({ id: "owner-1", role: "client_admin" });
const member = actor({ id: "member-1", role: "client_member" });
const operator = actor({
  id: "operator-1",
  role: "operator",
  organizationId: null,
  operatorId: "op-1",
});
const manager = actor({ id: "manager-1", role: "ops_manager", organizationId: null });
const harborOwner = actor({
  id: "harbor-owner",
  role: "client_admin",
  organizationId: "org-harbor",
});

const LOADOUT_CRITERIA = [
  "Delegation Spec and Workstream Run exist for SF-LOAD-001.",
  "Task packet is frozen and hashed.",
  "Loadout PR #26 is attached as historical evidence without mutation.",
  "Merge remains unperformed by Delegation Cloud.",
];

function intake(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SOFTWARE_FACTORY_INTAKE_SCHEMA_VERSION,
    taskId: "SF-LOAD-001",
    organizationId: "org-northline",
    repository: "Bthornton1994/Loadout",
    baseBranch: "main",
    objective: "Demonstrate Software Factory control of the Loadout proof workflow without mutating Loadout.",
    background: "PR https://github.com/Bthornton1994/Loadout/pull/26 merged historically and is evidence only.",
    inScope: [
      "Record the Loadout proof as a Delegation Cloud Software Factory run.",
      "Attach historical PR and verification evidence.",
    ],
    outOfScope: [
      "Merging, reopening, or modifying Loadout PR #26.",
      "Production deployment or secret changes.",
    ],
    acceptanceCriteria: LOADOUT_CRITERIA,
    constraints: ["prepare_only", "no live GitHub mutation", "no PAT workaround"],
    risk: "medium",
    dependencies: ["Historical Loadout PR #26"],
    approvalRequirements: ["owner_acceptance", "merge_pr"],
    actionClass: SOFTWARE_FACTORY_ACTION_CLASS,
    requestedBy: owner.id,
    ...overrides,
  };
}

function packetFor(runStatus: "planned" | "intake" | "discovery", extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
    STATUS: runStatus,
    TASK_ID: "SF-LOAD-001",
    REPOSITORY: "Bthornton1994/Loadout",
    BASE_BRANCH: "main",
    OBJECTIVE: "Demonstrate Software Factory control of the Loadout proof workflow without mutating Loadout.",
    BACKGROUND: "PR https://github.com/Bthornton1994/Loadout/pull/26 merged historically and is evidence only.",
    IN_SCOPE: [
      "Record the Loadout proof as a Delegation Cloud Software Factory run.",
      "Attach historical PR and verification evidence.",
    ],
    OUT_OF_SCOPE: [
      "Merging, reopening, or modifying Loadout PR #26.",
      "Production deployment or secret changes.",
    ],
    ACCEPTANCE_CRITERIA: LOADOUT_CRITERIA,
    VERIFICATION: [
      "Attach hashed PR, CI, and test evidence.",
      "Owner acceptance must be recorded outside this packet.",
    ],
    DEPENDENCIES: ["Historical Loadout PR #26"],
    RISK: "medium",
    APPROVAL_REQUIRED: ["owner_acceptance", "merge_pr"],
    HANDOFF_NOTES:
      "PM and Developer coordination is human-mediated because no approved Grok Bot or Cursor connector exists.",
    claimedApprovalIds: [],
    ...extra,
  };
}

function openRun(store: SoftwareFactoryStore) {
  const submitted = submitSoftwareWorkRequest(store, owner, intake(), "evt-intake", NOW);
  expect(submitted.ok).toBe(true);
  if (!submitted.ok) throw new Error(submitted.failures.join(" "));
  const provisioned = provisionSoftwareFactoryRun(store, manager, submitted.value.id, "evt-provision", NOW);
  expect(provisioned.ok).toBe(true);
  if (!provisioned.ok) throw new Error(provisioned.failures.join(" "));
  return provisioned.value;
}

function evidence(kind: "pull_request" | "ci" | "test" | "lint" | "typecheck" | "build" | "browser" | "agent_report" | "blocker", overrides: Record<string, unknown> = {}) {
  return {
    evidenceId: `ev-${kind}-${Math.random().toString(16).slice(2)}`,
    kind,
    summary: `${kind} evidence for SF-LOAD-001`,
    sourceUri: kind === "pull_request" ? "https://github.com/Bthornton1994/Loadout/pull/26" : null,
    conclusion: "pass",
    satisfiedCriteria: [] as string[],
    recordedAt: NOW,
    mutatesRepository: false as const,
    ...overrides,
  };
}

describe("Software Factory Run Manager capability", () => {
  it("registers as a native prepare-only control-plane capability", () => {
    expect(SOFTWARE_FACTORY_CAPABILITY_KEY).toBe("software_factory_run_management");
    expect(SOFTWARE_FACTORY_ACTION_CLASS).toBe("prepare_only");
    const connectors = softwareFactoryConnectorCatalog();
    expect(connectors.find((row) => row.key === "grok_bot")?.available).toBe(false);
    expect(connectors.find((row) => row.key === "cursor_cloud_agent")?.available).toBe(false);
    expect(connectors.find((row) => row.key === "github_issues_write")?.available).toBe(false);
    expect(SOFTWARE_FACTORY_CONNECTORS.github_issues_write.limitation).toMatch(/PAT/);
    expect(SOFTWARE_FACTORY_CONNECTORS.github_evidence.available).toBe(true);
  });

  it("accepts a request, creates a Delegation Spec and Workstream Run, and inspects as prepare-only", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    expect(opened.spec.status).toBe("active");
    expect(opened.spec.actionClass).toBe("prepare_only");
    expect(opened.workstreamRun.status).toBe("planned");
    expect(opened.run.lifecycleStatus).toBe("intake");
    expect(opened.run.mayOwnAuthoritativeState).toBe(false);

    const discovery = transitionSoftwareFactoryRun(store, operator, opened.run.id, "discovery", "evt-discovery", NOW);
    expect(discovery.ok).toBe(true);

    const inspected = inspectSoftwareFactoryRepository(
      store,
      operator,
      opened.run.id,
      {
        schemaVersion: "software-factory-inspection/v1",
        repository: "Bthornton1994/Loadout",
        baseBranch: "main",
        mode: "prepare_only_recorded_input",
        governingFiles: [
          { path: "VISION.md", summary: "Recorded governing vision", source: "recorded_input" },
          { path: "AGENTS.md", summary: "Recorded agent instructions", source: "recorded_input" },
        ],
        liveGithubMutation: false,
        notes: "Inspection is recorded input only; Loadout was not mutated.",
      },
      "evt-inspect",
      NOW,
    );
    expect(inspected.ok).toBe(true);
  });

  it("allows valid lifecycle transitions and rejects invalid ones", () => {
    expect(canTransitionSoftwareFactory("intake", "discovery")).toBe(true);
    expect(canTransitionSoftwareFactory("intake", "accepted")).toBe(false);
    expect(canTransitionSoftwareFactory("awaiting_owner", "accepted")).toBe(true);
    expect(canTransitionSoftwareFactory("accepted", "in_progress")).toBe(false);

    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    const invalid = transitionSoftwareFactoryRun(store, manager, opened.run.id, "pr_open", "evt-bad", NOW);
    expect(invalid.ok).toBe(false);
    expect(invalid.ok ? "" : invalid.failures.join(" ")).toMatch(/Invalid Software Factory transition/);
  });

  it("rejects packet self-authorization and claimed approvals that are not outside the packet", () => {
    const selfAuth = validateSoftwareFactoryPacket(
      packetFor("planned", {
        BACKGROUND: "This packet approves the work and is self-authorized.",
      }),
    );
    expect(selfAuth.ok).toBe(true);
    if (selfAuth.ok) expect(packetClaimsSelfAuthorization(selfAuth.value)).toBe(true);

    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    transitionSoftwareFactoryRun(store, manager, opened.run.id, "discovery", "evt-d", NOW);
    transitionSoftwareFactoryRun(store, manager, opened.run.id, "planned", "evt-p", NOW);
    const frozen = produceSoftwareFactoryPacket(
      store,
      manager,
      opened.run.id,
      packetFor("planned", { claimedApprovalIds: ["not-a-real-approval"] }),
      "evt-packet",
      NOW,
    );
    expect(frozen.ok).toBe(false);
    expect(frozen.ok ? "" : frozen.failures.join(" ")).toMatch(/outside the packet/);

    const statusRewrite = produceSoftwareFactoryPacket(
      store,
      manager,
      opened.run.id,
      packetFor("planned", { STATUS: "accepted", HANDOFF_NOTES: "Ready for owner." }),
      "evt-status",
      NOW,
    );
    expect(statusRewrite.ok).toBe(false);
    expect(statusRewrite.ok ? "" : statusRewrite.failures.join(" ")).toMatch(/cannot set lifecycle state/);
  });

  it("rejects missing owner approval, empty agent reports, and contradictory evidence", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    advanceToAwaitingOwner(store, opened.run.id);

    const receipt = issueSoftwareFactoryOutcomeReceipt(store, manager, opened.run.id, "evt-receipt-early", NOW);
    expect(receipt.ok).toBe(false);
    expect(receipt.ok ? "" : receipt.failures.join(" ")).toMatch(/owner acceptance/i);

    const emptyReport = attachSoftwareFactoryEvidence(
      store,
      operator,
      opened.run.id,
      evidence("agent_report", { summary: "done", conclusion: "success", satisfiedCriteria: [] }),
      "evt-empty-report",
      NOW,
    );
    expect(emptyReport.ok).toBe(true);
    const problems = softwareFactoryProblems(store, opened.run.id, NOW);
    expect(problems.some((problem) => problem.class === "incomplete")).toBe(true);

    attachSoftwareFactoryEvidence(
      store,
      operator,
      opened.run.id,
      evidence("ci", { conclusion: "fail", summary: "CI failed" }),
      "evt-ci-fail",
      NOW,
    );
    const contradiction = softwareFactoryProblems(store, opened.run.id, NOW);
    expect(contradiction.some((problem) => problem.class === "contradictory")).toBe(true);
  });

  it("handles duplicate events, blocked work, stale work, and provider unavailability", () => {
    const store = createSoftwareFactoryStore();
    const first = submitSoftwareWorkRequest(store, owner, intake(), "evt-intake-dup", NOW);
    const second = submitSoftwareWorkRequest(store, owner, intake(), "evt-intake-dup", NOW);
    expect(first.ok && second.ok && second.duplicate).toBe(true);

    const opened = openRun(createSoftwareFactoryStore());
    const store2 = createSoftwareFactoryStore();
    const rerun = openRun(store2);
    recordMissingConnectorHandoffs(store2, manager, rerun.run.id, "evt-handoff", NOW);
    transitionSoftwareFactoryRun(store2, manager, rerun.run.id, "discovery", "d", NOW);
    transitionSoftwareFactoryRun(store2, manager, rerun.run.id, "planned", "p", NOW);
    produceSoftwareFactoryPacket(store2, manager, rerun.run.id, packetFor("planned"), "pack", NOW);
    transitionSoftwareFactoryRun(store2, manager, rerun.run.id, "ready", "r", NOW);
    const fakeConnector = recordSoftwareFactoryHandoff(
      store2,
      manager,
      rerun.run.id,
      {
        schemaVersion: "software-factory-handoff/v1",
        workerRole: "software_factory_pm",
        connectorKey: "grok_bot",
        mediation: "approved_connector",
        summary: "Pretend Grok is connected.",
        missingConnector: false,
        connectorLimitation: null,
      },
      "evt-fake-grok",
      NOW,
    );
    expect(fakeConnector.ok).toBe(false);
    expect(fakeConnector.ok ? "" : fakeConnector.failures.join(" ")).toMatch(/No approved connector/);

    const blocked = requestSoftwareFactoryApproval(
      store2,
      manager,
      rerun.run.id,
      "merge_pr",
      "Merge requires owner approval.",
      "evt-block",
      NOW,
    );
    expect(blocked.ok).toBe(true);
    expect(getSoftwareFactoryRun(store2, manager, rerun.run.id).lifecycleStatus).toBe("blocked");

    attachSoftwareFactoryEvidence(
      store2,
      operator,
      rerun.run.id,
      evidence("blocker", {
        summary: "Waiting on owner merge decision",
        conclusion: "blocked",
        recordedAt: NOW,
      }),
      "evt-old",
      NOW,
    );
    const stale = softwareFactoryProblems(store2, rerun.run.id, LATER);
    expect(stale.some((problem) => problem.class === "stale" || problem.class === "blocked")).toBe(true);
    expect(opened.run.taskId).toBe("SF-LOAD-001");
  });

  it("enforces tenant isolation and RBAC", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    expect(() => getSoftwareFactoryRun(store, harborOwner, opened.run.id)).toThrow(AuthzError);
    expect(() => listSoftwareFactoryRunsForOrg(store, harborOwner, "org-northline")).toThrow(AuthzError);
    expect(listSoftwareFactoryRunsForOrg(store, owner, "org-northline")).toHaveLength(1);

    const memberTransition = transitionSoftwareFactoryRun(store, member, opened.run.id, "discovery", "evt-member", NOW);
    expect(memberTransition.ok).toBe(false);

    const operatorDecision = recordSoftwareFactoryOwnerDecision(
      store,
      operator,
      opened.run.id,
      {
        kind: "owner_acceptance",
        status: "approved",
        rationale: "Agent claims success",
        sourceRefs: ["operator-note"],
      },
      "evt-op-decision",
      NOW,
    );
    expect(operatorDecision.ok).toBe(false);

    const harborIntake = submitSoftwareWorkRequest(
      store,
      harborOwner,
      intake({ organizationId: "org-northline", taskId: "SF-HARBOR-001" }),
      "evt-cross",
      NOW,
    );
    expect(harborIntake.ok).toBe(false);
  });

  it("records audit history with actor identity and rejects secrets", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    const history = softwareFactoryAuditHistory(store, opened.run.id);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]?.actorId).toBe(owner.id);
    expect(history[0]?.actorRole).toBe("client_admin");
    expect(history.some((event) => event.type === "primitives_provisioned")).toBe(true);

    const secretIntake = submitSoftwareWorkRequest(
      store,
      owner,
      intake({ taskId: "SF-SECRET-001", background: "Use token ghp_abcdefghijklmnopqrstuv" }),
      "evt-secret",
      NOW,
    );
    expect(secretIntake.ok).toBe(false);
    expect(secretIntake.ok ? "" : secretIntake.failures.join(" ")).toMatch(/credential/);
  });

  it("rejects a stale version on lifecycle transition", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    const stale = transitionSoftwareFactoryRun(
      store,
      manager,
      opened.run.id,
      "discovery",
      "evt-stale-version",
      NOW,
      opened.run.version - 1,
    );
    expect(stale.ok).toBe(false);
    expect(stale.ok ? "" : stale.failures.join(" ")).toMatch(/Optimistic concurrency/);
  });

  it("rejects scope expansion without owner approval", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    transitionSoftwareFactoryRun(store, manager, opened.run.id, "discovery", "d", NOW);
    transitionSoftwareFactoryRun(store, manager, opened.run.id, "planned", "p", NOW);
    const expanded = produceSoftwareFactoryPacket(
      store,
      manager,
      opened.run.id,
      packetFor("planned", {
        IN_SCOPE: [
          "Record the Loadout proof as a Delegation Cloud Software Factory run.",
          "Attach historical PR and verification evidence.",
          "Also rewrite Loadout production secrets.",
        ],
      }),
      "evt-scope",
      NOW,
    );
    expect(expanded.ok).toBe(false);
    expect(expanded.ok ? "" : expanded.failures.join(" ")).toMatch(/expands frozen intake scope/);
  });
});

function attachProofEvidence(store: SoftwareFactoryStore, factoryRunId: string) {
  const items = [
    evidence("pull_request", {
      summary: "Historical Loadout PR #26, merged; attached without mutation.",
      sourceUri: "https://github.com/Bthornton1994/Loadout/pull/26",
      conclusion: "historically_merged_unmodified",
      satisfiedCriteria: [
        "Loadout PR #26 is attached as historical evidence without mutation.",
        "Merge remains unperformed by Delegation Cloud.",
      ],
    }),
    evidence("ci", {
      summary: "Recorded CI observation from the historical PR.",
      conclusion: "pass",
      satisfiedCriteria: ["Loadout PR #26 is attached as historical evidence without mutation."],
    }),
    evidence("test", {
      summary: "Recorded unit/integration observation from the historical PR.",
      conclusion: "pass",
      satisfiedCriteria: ["Task packet is frozen and hashed."],
    }),
    evidence("lint", { summary: "Recorded lint observation.", conclusion: "pass" }),
    evidence("typecheck", { summary: "Recorded typecheck observation.", conclusion: "pass" }),
    evidence("build", { summary: "Recorded build observation.", conclusion: "pass" }),
    evidence("browser", { summary: "No additional browser evidence required for this historical proof.", conclusion: "not_applicable" }),
  ];
  items.forEach((item, index) => {
    const result = attachSoftwareFactoryEvidence(store, operator, factoryRunId, item, `evt-ev-${index}`, NOW);
    expect(result.ok).toBe(true);
  });
}

function advanceToAwaitingOwner(store: SoftwareFactoryStore, factoryRunId: string) {
  inspectSoftwareFactoryRepository(
    store,
    operator,
    factoryRunId,
    {
      schemaVersion: "software-factory-inspection/v1",
      repository: "Bthornton1994/Loadout",
      baseBranch: "main",
      mode: "prepare_only_recorded_input",
      governingFiles: [{ path: "README.md", summary: "Recorded Loadout readme", source: "recorded_input" }],
      liveGithubMutation: false,
      notes: "Prepare-only inspection; Loadout was not cloned for mutation.",
    },
    "evt-inspect-2",
    NOW,
  );
  expect(transitionSoftwareFactoryRun(store, manager, factoryRunId, "discovery", "adv-d", NOW).ok).toBe(true);
  expect(transitionSoftwareFactoryRun(store, manager, factoryRunId, "planned", "adv-p", NOW).ok).toBe(true);
  const packed = produceSoftwareFactoryPacket(store, manager, factoryRunId, packetFor("planned"), "adv-pack", NOW);
  expect(packed.ok).toBe(true);
  recordMissingConnectorHandoffs(store, manager, factoryRunId, "adv-handoff", NOW);
  expect(transitionSoftwareFactoryRun(store, manager, factoryRunId, "ready", "adv-r", NOW).ok).toBe(true);
  expect(transitionSoftwareFactoryRun(store, manager, factoryRunId, "in_progress", "adv-i", NOW).ok).toBe(true);
  attachProofEvidence(store, factoryRunId);
  attachSoftwareFactoryEvidence(
    store,
    operator,
    factoryRunId,
    evidence("test", {
      evidenceId: "ev-spec-run",
      summary: "Delegation Spec and Workstream Run exist.",
      conclusion: "pass",
      satisfiedCriteria: ["Delegation Spec and Workstream Run exist for SF-LOAD-001."],
    }),
    "evt-spec-evidence",
    NOW,
  );
  expect(transitionSoftwareFactoryRun(store, manager, factoryRunId, "pr_open", "adv-pr", NOW).ok).toBe(true);
  expect(transitionSoftwareFactoryRun(store, manager, factoryRunId, "verification", "adv-v", NOW).ok).toBe(true);
  expect(transitionSoftwareFactoryRun(store, manager, factoryRunId, "awaiting_owner", "adv-a", NOW).ok).toBe(true);
}

describe("Loadout SF-LOAD-001 proof workflow", () => {
  it("walks the governed lifecycle, blocks merge, and issues an Outcome Receipt only after owner acceptance", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    expect(opened.workstreamRun.status).toBe("planned");
    advanceToAwaitingOwner(store, opened.run.id);

    const runBefore = getSoftwareFactoryRun(store, manager, opened.run.id);
    expect(runBefore.lifecycleStatus).toBe("awaiting_owner");
    expect(store.workstreamRuns.get(opened.workstreamRun.id)?.status).toBe("awaiting_verification");
    expect(runBefore.mergePerformed).toBe(false);
    expect(runBefore.connectors.some((row) => row.key === "github_issues_write" && !row.available)).toBe(true);

    const mergeBeforeApproval = attemptSoftwareFactoryForbiddenAction(
      store,
      manager,
      opened.run.id,
      "merge_pr",
      "evt-merge-1",
      NOW,
    );
    expect(mergeBeforeApproval.ok).toBe(false);
    expect(mergeBeforeApproval.ok ? "" : mergeBeforeApproval.failures.join(" ")).toMatch(/Merge remains blocked/);

    const missingOwnerReceipt = issueSoftwareFactoryOutcomeReceipt(
      store,
      manager,
      opened.run.id,
      "evt-receipt-missing-owner",
      NOW,
    );
    expect(missingOwnerReceipt.ok).toBe(false);

    const ownerDecision = recordSoftwareFactoryOwnerDecision(
      store,
      owner,
      opened.run.id,
      {
        kind: "owner_acceptance",
        status: "approved",
        rationale: "Historical Loadout PR #26 is accepted as evidence for this demonstration run.",
        sourceRefs: ["https://github.com/Bthornton1994/Loadout/pull/26", "governance:owner-acceptance"],
      },
      "evt-owner",
      NOW,
    );
    expect(ownerDecision.ok).toBe(true);

    const receipt = issueSoftwareFactoryOutcomeReceipt(store, manager, opened.run.id, "evt-receipt", NOW);
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) throw new Error(receipt.failures.join(" "));
    expect(receipt.value.verificationStatus).toBe("passed");
    expect(receipt.value.mergePerformed).toBe(false);
    expect(receipt.value.repositoryMutated).toBe(false);
    expect(receipt.value.ownerDecisionIds.length).toBeGreaterThan(0);
    expect(getSoftwareFactoryRun(store, owner, opened.run.id).lifecycleStatus).toBe("accepted");
    expect(store.workstreamRuns.get(opened.workstreamRun.id)?.status).toBe("verified");

    const mergeAfter = attemptSoftwareFactoryForbiddenAction(
      store,
      manager,
      opened.run.id,
      "merge_pr",
      "evt-merge-2",
      NOW,
    );
    expect(mergeAfter.ok).toBe(false);
    expect(getSoftwareFactoryRun(store, manager, opened.run.id).mergePerformed).toBe(false);
    expect(store.outcomeReceipts).toHaveLength(1);
    expect(store.outcomeReceipts[0]?.runId).toBe(opened.workstreamRun.id);
    expect(store.outcomeReceipts[0]?.actionsTaken).toContain("no_merge");
    expect(store.evidenceArtifacts.some((row) => row.sourceUri === "https://github.com/Bthornton1994/Loadout/pull/26")).toBe(
      true,
    );
  });
});

describe("Software Factory remaining control-plane gates", () => {
  it("keeps staff overlay controls open after verification syncs the workstream", () => {
    expect(
      softwareFactoryStaffControlsOpen({
        workstreamStatus: "awaiting_verification",
        lifecycleStatus: "verification",
      }),
    ).toBe(true);
    expect(
      softwareFactoryStaffControlsOpen({
        workstreamStatus: "awaiting_verification",
        lifecycleStatus: "awaiting_owner",
      }),
    ).toBe(true);
    expect(
      softwareFactoryStaffControlsOpen({
        workstreamStatus: "running",
        lifecycleStatus: "in_progress",
      }),
    ).toBe(true);
    expect(
      softwareFactoryStaffControlsOpen({
        workstreamStatus: "planned",
        lifecycleStatus: "intake",
      }),
    ).toBe(false);
    expect(
      softwareFactoryStaffControlsOpen({
        workstreamStatus: "awaiting_verification",
        lifecycleStatus: "accepted",
      }),
    ).toBe(false);
    expect(
      softwareFactoryStaffControlsOpen({
        workstreamStatus: "verified",
        lifecycleStatus: "awaiting_owner",
      }),
    ).toBe(false);
  });

  it("supports cancelled, rejected, and deferred terminal transitions", () => {
    const terminals = ["cancelled", "rejected", "deferred"] as const;
    for (const status of terminals) {
      const store = createSoftwareFactoryStore();
      const opened = openRun(store);
      const result = transitionSoftwareFactoryRun(store, manager, opened.run.id, status, `evt-${status}`, NOW);
      expect(result.ok).toBe(true);
      expect(getSoftwareFactoryRun(store, manager, opened.run.id).lifecycleStatus).toBe(status);
    }
  });

  it("detects unverifiable evidence", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    attachSoftwareFactoryEvidence(
      store,
      operator,
      opened.run.id,
      evidence("browser", {
        summary: "Screenshot missing",
        conclusion: "cannot verify browser behavior",
      }),
      "evt-unverifiable",
      NOW,
    );
    const problems = softwareFactoryProblems(store, opened.run.id, NOW);
    expect(problems.some((problem) => problem.class === "unverifiable")).toBe(true);
  });

  it("refuses Cursor tracking without an approved connector and records it when one exists", () => {
    const missing = createSoftwareFactoryStore();
    const opened = openRun(missing);
    const refused = trackCursorCloudAgentExecution(
      missing,
      manager,
      opened.run.id,
      {
        schemaVersion: SOFTWARE_FACTORY_CURSOR_EXECUTION_SCHEMA_VERSION,
        cursorAgentRef: "bc-test",
        status: "completed",
        summary: "Agent claimed the Loadout PR was done.",
        evidenceUris: [],
        claimsSuccess: true,
        mutatesRepository: false,
        mergePerformed: false,
      },
      "evt-cursor-missing",
      NOW,
    );
    expect(refused.ok).toBe(false);
    expect(refused.ok ? "" : refused.failures.join(" ")).toMatch(/No approved Cursor Cloud Agent connector/);

    const available = createSoftwareFactoryStore({
      connectors: softwareFactoryConnectorCatalog().map((row) =>
        row.key === "cursor_cloud_agent" ? { ...row, available: true } : row,
      ),
    });
    const tracked = openRun(available);
    const recorded = trackCursorCloudAgentExecution(
      available,
      manager,
      tracked.run.id,
      {
        schemaVersion: SOFTWARE_FACTORY_CURSOR_EXECUTION_SCHEMA_VERSION,
        cursorAgentRef: "bc-test",
        status: "completed",
        summary: "Cursor reported completion; this is evidence only.",
        evidenceUris: ["https://cursor.com/agents/bc-test"],
        claimsSuccess: true,
        mutatesRepository: false,
        mergePerformed: false,
      },
      "evt-cursor-tracked",
      NOW,
    );
    expect(recorded.ok).toBe(true);
    const cursorEvidence = available.evidenceArtifacts.find((row) => row.payload.factoryKind === "cursor_execution");
    expect(cursorEvidence?.kind).toBe("observation");
    expect(getSoftwareFactoryRun(available, manager, tracked.run.id).lifecycleStatus).not.toBe("accepted");
    expect(issueSoftwareFactoryOutcomeReceipt(available, manager, tracked.run.id, "evt-cursor-receipt", NOW).ok).toBe(
      false,
    );
  });

  it("projects factory evidence and receipts onto canonical evidence_artifacts and Outcome Receipts", () => {
    expect(SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND.pull_request).toBe("source");
    expect(SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND.cursor_execution).toBe("observation");
    expect(SOFTWARE_FACTORY_EVIDENCE_KIND_TO_ARTIFACT_KIND.task_packet).toBe("other");

    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    attachSoftwareFactoryEvidence(
      store,
      operator,
      opened.run.id,
      evidence("pull_request"),
      "evt-pr-project",
      NOW,
    );
    const artifacts = store.evidenceArtifacts.filter(isProjectedEvidenceArtifact);
    expect(artifacts.some((item) => item.kind === "source" && item.sourceUri?.includes("pull/26"))).toBe(true);
    expect(artifacts.every((item) => item.runId === opened.workstreamRun.id)).toBe(true);

    const frozen = freezeEvidenceRecord({
      evidenceId: "ev-direct-pr",
      kind: "pull_request",
      summary: "Direct projection of historical Loadout PR evidence.",
      sourceUri: "https://github.com/Bthornton1994/Loadout/pull/26",
      conclusion: "pass",
      satisfiedCriteria: [],
      recordedAt: NOW,
      mutatesRepository: false,
    });
    expect(frozen.ok).toBe(true);
    if (!frozen.ok) throw new Error(frozen.failures.join(" "));

    const projectedEvidence = projectSoftwareFactoryEvidenceArtifact({
      factoryRun: getSoftwareFactoryRun(store, manager, opened.run.id),
      evidence: frozen.value,
      actor: operator,
      now: NOW,
    });
    expect(isProjectedEvidenceArtifact(projectedEvidence)).toBe(true);
    if (!isProjectedEvidenceArtifact(projectedEvidence)) throw new Error("expected evidence artifact");
    expect(projectedEvidence.kind).toBe("source");
    expect(projectedEvidence.payload.schemaVersion).toBe(SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION);
    expect(projectedEvidence.payload.mutatesRepository).toBe(false);

    const projectedReceipt = projectSoftwareFactoryOutcomeReceipt({
      factoryRun: getSoftwareFactoryRun(store, manager, opened.run.id),
      receipt: {
        schemaVersion: SOFTWARE_FACTORY_RECEIPT_SCHEMA_VERSION,
        receiptId: "receipt-projected",
        factoryRunId: opened.run.id,
        workstreamRunId: opened.workstreamRun.id,
        taskId: "SF-LOAD-001",
        verificationStatus: "failed",
        definitionOfDoneMet: false,
        lifecycleStatus: "awaiting_owner",
        summary: "Owner merge approval recorded. Merge was not performed.",
        packetHash: "a".repeat(64),
        evidenceHashes: [frozen.value.contentHash],
        ownerDecisionIds: [],
        unresolvedBlockers: ["Merge remains blocked"],
        authorityIncidents: 0,
        mergePerformed: false,
        repositoryMutated: false,
        verifiedAt: NOW,
      },
      actor: manager,
      now: NOW,
    });
    expect(isProjectedOutcomeReceipt(projectedReceipt)).toBe(true);
    if (!isProjectedOutcomeReceipt(projectedReceipt)) throw new Error("expected outcome receipt");
    expect(projectedReceipt.actionsTaken).toEqual([
      "prepare_only",
      "no_merge",
      "no_deploy",
      "no_secret_change",
      "no_github_mutation",
    ]);
    expect(projectedReceipt.verificationStatus).toBe("failed");
    expect(projectedReceipt.runId).toBe(opened.workstreamRun.id);
  });
});

describe("Software Factory reserved-writer accept gates", () => {
  it("detects the software-factory-run/v1 spec marker", () => {
    expect(isSoftwareFactorySpec({ requiredInputs: [SOFTWARE_FACTORY_RUN_INPUT] })).toBe(true);
    expect(isSoftwareFactorySpec({ requiredInputs: ["twl-prepare-proof/v1"] })).toBe(false);
  });

  it("rejects a stale packet hash, an operator verifier, and provider-only evidence", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    advanceToAwaitingOwner(store, opened.run.id);
    const run = getSoftwareFactoryRun(store, manager, opened.run.id);
    const evidence = store.evidenceByRun.get(opened.run.id) ?? [];
    const approvals = [...store.approvals.values()].filter((row) => row.factoryRunId === opened.run.id);

    expect(
      evaluateAcceptance({
        run: { ...run, packetHash: "a".repeat(64) },
        evidence,
        approvals,
        now: NOW,
      }).failures.join(" "),
    ).toMatch(/packet hash/);

    expect(
      evaluateAcceptance({
        run,
        evidence,
        approvals,
        now: NOW,
        actorRole: "operator",
        verifierId: operator.id,
      }).ok,
    ).toBe(false);

    const ownerDecision = recordSoftwareFactoryOwnerDecision(
      store,
      owner,
      opened.run.id,
      {
        kind: "owner_acceptance",
        status: "approved",
        rationale: "Owner accepts the frozen packet.",
        sourceRefs: ["governance:owner-acceptance"],
      },
      "evt-owner-hash-gate",
      NOW,
    );
    expect(ownerDecision.ok).toBe(true);
    const afterOwner = [...store.approvals.values()].filter((row) => row.factoryRunId === opened.run.id);
    expect(
      evaluateAcceptance({
        run: getSoftwareFactoryRun(store, manager, opened.run.id),
        evidence,
        approvals: afterOwner,
        now: NOW,
        actorRole: "ops_manager",
        verifierId: owner.id,
      }).failures.join(" "),
    ).toMatch(/cannot issue its Outcome Receipt/);

    const providerOnly = freezeEvidenceRecord({
      evidenceId: "ev-agent-only",
      kind: "agent_report",
      summary: "Cursor said this was done and should be accepted.",
      sourceUri: null,
      conclusion: "executor_claimed_success_not_authoritative",
      satisfiedCriteria: [],
      recordedAt: NOW,
      mutatesRepository: false,
    });
    expect(providerOnly.ok).toBe(true);
    if (!providerOnly.ok) throw new Error(providerOnly.failures.join(" "));
    expect(
      evaluateAcceptance({
        run,
        evidence: [providerOnly.value],
        approvals: afterOwner,
        now: NOW,
        actorRole: "ops_manager",
        verifierId: manager.id,
      }).failures.join(" "),
    ).toMatch(/provider success claim or agent report/);

    expect(hashSoftwareFactoryPacket(run.packet!)).toBe(run.packetHash);
  });

  it("fails closed when the run is stale at acceptance time", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    advanceToAwaitingOwner(store, opened.run.id);
    const ownerDecision = recordSoftwareFactoryOwnerDecision(
      store,
      owner,
      opened.run.id,
      {
        kind: "owner_acceptance",
        status: "approved",
        rationale: "Owner accepts the frozen packet.",
        sourceRefs: ["governance:owner-acceptance"],
      },
      "evt-owner-stale-gate",
      NOW,
    );
    expect(ownerDecision.ok).toBe(true);

    const run = getSoftwareFactoryRun(store, manager, opened.run.id);
    const evidence = store.evidenceByRun.get(opened.run.id) ?? [];
    const approvals = [...store.approvals.values()].filter((row) => row.factoryRunId === opened.run.id);

    expect(
      evaluateAcceptance({
        run,
        evidence,
        approvals,
        now: NOW,
        actorRole: "ops_manager",
        verifierId: manager.id,
      }).ok,
    ).toBe(true);

    const stale = evaluateAcceptance({
      run,
      evidence,
      approvals,
      now: LATER,
      actorRole: "ops_manager",
      verifierId: manager.id,
    });
    expect(stale.ok).toBe(false);
    expect(stale.failures.join(" ")).toMatch(/stale/);

    const receipt = issueSoftwareFactoryOutcomeReceipt(store, manager, opened.run.id, "evt-stale-receipt", LATER);
    expect(receipt.ok).toBe(false);
    expect(receipt.ok ? "" : receipt.failures.join(" ")).toMatch(/stale/);
    expect(getSoftwareFactoryRun(store, manager, opened.run.id).lifecycleStatus).toBe("awaiting_owner");
  });

  it("binds packet hashes to Postgres software_factory_sha256 and rejects payload mutation without re-freeze", () => {
    const qaPacket = {
      RISK: "medium",
      STATUS: "intake" as const,
      TASK_ID: "SF-VA-UI-PROOF-01",
      IN_SCOPE: ["Record the request as a Software Factory run.", "Attach hashed PR and verification evidence."],
      OBJECTIVE: "Govern this software request without merging or deploying.",
      BACKGROUND: "Owner acceptance must be recorded outside this packet.",
      REPOSITORY: "Bthornton1994/Virtual-Assistant",
      BASE_BRANCH: "main",
      DEPENDENCIES: [],
      OUT_OF_SCOPE: ["Merge, deploy, secret change, or live GitHub mutation."],
      VERIFICATION: [
        "Attach hashed PR, CI, and test evidence.",
        "Owner acceptance must be recorded outside this packet.",
      ],
      HANDOFF_NOTES:
        "PM and Developer coordination is human-mediated because no approved Grok Bot or Cursor connector exists.",
      schemaVersion: SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
      APPROVAL_REQUIRED: ["owner_acceptance"],
      claimedApprovalIds: [],
      ACCEPTANCE_CRITERIA: [
        "Delegation Spec and Workstream Run exist.",
        "Task packet is frozen and hashed.",
        "Historical PR evidence is attached without mutation.",
        "Merge remains unperformed by Delegation Cloud.",
      ],
    };
    const parsed = validateSoftwareFactoryPacket(qaPacket);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.failures.join(" "));
    const sqlHash = "be80fd9df728725718bca286104ded04f0761a6822e46106ef619c79816a8397";
    expect(hashSoftwareFactoryPacket(parsed.value)).toBe(sqlHash);
    expect(sha256Hex(parsed.value)).not.toBe(sqlHash);

    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    advanceToAwaitingOwner(store, opened.run.id);
    const run = getSoftwareFactoryRun(store, manager, opened.run.id);
    const evidence = store.evidenceByRun.get(opened.run.id) ?? [];
    const approvals = [...store.approvals.values()].filter((row) => row.factoryRunId === opened.run.id);

    expect(run.packet?.STATUS).toBe("planned");
    expect(run.lifecycleStatus).toBe("awaiting_owner");
    expect(hashSoftwareFactoryPacket(run.packet!)).toBe(run.packetHash);
    expect(
      evaluateAcceptance({
        run,
        evidence,
        approvals,
        now: NOW,
      }).failures.filter((failure) => /packet hash/.test(failure)),
    ).toEqual([]);

    const mutated = { ...run.packet!, OBJECTIVE: "Tampered objective after freeze." };
    expect(hashSoftwareFactoryPacket(mutated)).not.toBe(run.packetHash);
    expect(
      evaluateAcceptance({
        run: { ...run, packet: mutated },
        evidence,
        approvals,
        now: NOW,
      }).failures.join(" "),
    ).toMatch(/packet hash/);
  });
});

describe("Software Factory database-boundary alignment", () => {
  it("fails acceptance when only some frozen criteria are evidenced", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    advanceToAwaitingOwner(store, opened.run.id);
    const run = getSoftwareFactoryRun(store, manager, opened.run.id);
    const evidence = (store.evidenceByRun.get(opened.run.id) ?? []).map((row) => ({
      ...row,
      satisfiedCriteria: row.satisfiedCriteria.slice(0, 1),
    }));
    const approvals = [...store.approvals.values()].filter((row) => row.factoryRunId === opened.run.id);
    const ownerDecision = recordSoftwareFactoryOwnerDecision(
      store,
      owner,
      opened.run.id,
      {
        kind: "owner_acceptance",
        status: "approved",
        rationale: "Owner accepts the frozen packet.",
        sourceRefs: ["governance:owner-acceptance"],
      },
      "evt-owner-partial-criteria",
      NOW,
    );
    expect(ownerDecision.ok).toBe(true);
    const afterOwner = [...store.approvals.values()].filter((row) => row.factoryRunId === opened.run.id);
    const partial = evaluateAcceptance({
      run,
      evidence,
      approvals: afterOwner.length ? afterOwner : approvals,
      now: NOW,
      actorRole: "ops_manager",
      verifierId: manager.id,
    });
    expect(partial.ok).toBe(false);
    expect(partial.failures.join(" ")).toMatch(/Acceptance criterion is not evidenced/);
  });

  it("requires the latest owner_acceptance for the current packet hash to be approved", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    advanceToAwaitingOwner(store, opened.run.id);
    expect(
      recordSoftwareFactoryOwnerDecision(
        store,
        owner,
        opened.run.id,
        {
          kind: "owner_acceptance",
          status: "approved",
          rationale: "Owner accepts the frozen packet.",
          sourceRefs: ["governance:owner-acceptance"],
        },
        "evt-owner-first-approve",
        NOW,
      ).ok,
    ).toBe(true);
    const laterReject = "2026-09-04T13:00:00.000Z";
    expect(
      recordSoftwareFactoryOwnerDecision(
        store,
        owner,
        opened.run.id,
        {
          kind: "owner_acceptance",
          status: "rejected",
          rationale: "Owner later rejects the same packet hash.",
          sourceRefs: ["governance:owner-rejection"],
        },
        "evt-owner-later-reject",
        laterReject,
      ).ok,
    ).toBe(true);

    const run = getSoftwareFactoryRun(store, manager, opened.run.id);
    const evidence = store.evidenceByRun.get(opened.run.id) ?? [];
    const approvals = [...store.approvals.values()].filter((row) => row.factoryRunId === opened.run.id);
    const latest = latestOwnerAcceptance(approvals, run.packetHash);
    expect(latest?.status).toBe("rejected");
    const rejected = evaluateAcceptance({
      run,
      evidence,
      approvals,
      now: laterReject,
      actorRole: "ops_manager",
      verifierId: manager.id,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.failures.join(" ")).toMatch(/latest owner decision/);

    expect(
      recordSoftwareFactoryOwnerDecision(
        store,
        owner,
        opened.run.id,
        {
          kind: "owner_acceptance",
          status: "approved",
          rationale: "Owner re-approves after the later rejection.",
          sourceRefs: ["governance:owner-reapproval"],
        },
        "evt-owner-reapprove",
        "2026-09-04T14:00:00.000Z",
      ).ok,
    ).toBe(true);
    const reapprovedApprovals = [...store.approvals.values()].filter((row) => row.factoryRunId === opened.run.id);
    expect(latestOwnerAcceptance(reapprovedApprovals, run.packetHash)?.status).toBe("approved");
    expect(
      evaluateAcceptance({
        run: getSoftwareFactoryRun(store, manager, opened.run.id),
        evidence: store.evidenceByRun.get(opened.run.id) ?? [],
        approvals: reapprovedApprovals,
        now: "2026-09-04T14:00:00.000Z",
        actorRole: "ops_manager",
        verifierId: manager.id,
      }).ok,
    ).toBe(true);
  });

  it("projects rejected, deferred, and cancelled overlays onto closed workstreams", () => {
    expect(projectSoftwareFactoryWorkstreamStatus("awaiting_verification", "rejected")).toBe("failed");
    expect(projectSoftwareFactoryWorkstreamStatus("awaiting_verification", "deferred")).toBe("cancelled");
    expect(projectSoftwareFactoryWorkstreamStatus("awaiting_verification", "cancelled")).toBe("cancelled");
    expect(projectSoftwareFactoryWorkstreamStatus("verified", "rejected")).toBe("verified");

    for (const status of ["rejected", "deferred"] as const) {
      const store = createSoftwareFactoryStore();
      const opened = openRun(store);
      advanceToAwaitingOwner(store, opened.run.id);
      const result = transitionSoftwareFactoryRun(store, manager, opened.run.id, status, `evt-close-${status}`, NOW);
      expect(result.ok).toBe(true);
      const run = getSoftwareFactoryRun(store, manager, opened.run.id);
      expect(run.lifecycleStatus).toBe(status);
      expect(isSoftwareFactoryTerminal(run.lifecycleStatus)).toBe(true);
      const workstream = store.workstreamRuns.get(opened.workstreamRun.id);
      expect(workstream?.status).toBe(status === "rejected" ? "failed" : "cancelled");
      expect(
        softwareFactoryStaffControlsOpen({
          workstreamStatus: workstream?.status ?? "running",
          lifecycleStatus: run.lifecycleStatus,
        }),
      ).toBe(false);
      expect(["running", "awaiting_verification"]).not.toContain(workstream?.status);
    }
  });

  it("rejects secret-like packet fields through validateSoftwareFactoryPacket", () => {
    const secretPacket = validateSoftwareFactoryPacket(
      packetFor("planned", { OBJECTIVE: "Use token ghp_abcdefghijklmnopqrstuv" }),
    );
    expect(secretPacket.ok).toBe(false);
    expect(secretPacket.ok ? "" : secretPacket.failures.join(" ")).toMatch(/credential/);
  });

  it("versions a changed freeze and keeps the previous packet hash invalid", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    expect(transitionSoftwareFactoryRun(store, manager, opened.run.id, "discovery", "evt-rf-d", NOW).ok).toBe(true);
    expect(transitionSoftwareFactoryRun(store, manager, opened.run.id, "planned", "evt-rf-p", NOW).ok).toBe(true);
    const first = produceSoftwareFactoryPacket(store, manager, opened.run.id, packetFor("planned"), "evt-rf-1", NOW);
    expect(first.ok).toBe(true);
    const firstHash = getSoftwareFactoryRun(store, manager, opened.run.id).packetHash;
    expect(getSoftwareFactoryRun(store, manager, opened.run.id).packetFreezeVersion).toBe(1);

    const same = produceSoftwareFactoryPacket(store, manager, opened.run.id, packetFor("planned"), "evt-rf-same", NOW);
    expect(same.ok).toBe(true);
    expect(getSoftwareFactoryRun(store, manager, opened.run.id).packetFreezeVersion).toBe(1);

    const second = produceSoftwareFactoryPacket(
      store,
      manager,
      opened.run.id,
      packetFor("planned", { OBJECTIVE: "Govern the same request with a revised freeze-time objective." }),
      "evt-rf-2",
      NOW,
    );
    expect(second.ok).toBe(true);
    const after = getSoftwareFactoryRun(store, manager, opened.run.id);
    expect(after.packetFreezeVersion).toBe(2);
    expect(after.packetHash).not.toBe(firstHash);
    expect(hashSoftwareFactoryPacket(after.packet!)).toBe(after.packetHash);
    const staleHashRun = { ...after, packetHash: firstHash };
    expect(
      evaluateAcceptance({
        run: staleHashRun,
        evidence: store.evidenceByRun.get(opened.run.id) ?? [],
        approvals: [],
        now: NOW,
      }).failures.join(" "),
    ).toMatch(/packet hash/);
  });

  it("records a forbidden-action audit event and still rejects the action", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    const blocked = attemptSoftwareFactoryForbiddenAction(
      store,
      manager,
      opened.run.id,
      "merge_pr",
      "evt-forbidden-audit",
      NOW,
    );
    expect(blocked.ok).toBe(false);
    expect(getSoftwareFactoryRun(store, manager, opened.run.id).mergePerformed).toBe(false);
    expect(getSoftwareFactoryRun(store, manager, opened.run.id).lifecycleStatus).toBe("intake");
    expect(
      softwareFactoryAuditHistory(store, opened.run.id).some((event) => event.type === "forbidden_action_blocked"),
    ).toBe(true);
  });
});

