import { describe, expect, it } from "vitest";
import { AuthzError, type Actor } from "@/lib/domain";
import {
  SOFTWARE_FACTORY_ACTION_CLASS,
  SOFTWARE_FACTORY_INTAKE_SCHEMA_VERSION,
  SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
} from "@/lib/software-factory-run-manager";
import {
  createSoftwareFactoryStore,
  getSoftwareFactoryRun,
  produceSoftwareFactoryPacket,
  provisionSoftwareFactoryRun,
  recordSoftwareFactoryOwnerDecision,
  requestSoftwareFactoryApproval,
  submitSoftwareWorkRequest,
  transitionSoftwareFactoryRun,
  type SoftwareFactoryStore,
} from "@/lib/software-factory-store";

const NOW = "2026-09-04T12:00:00.000Z";

const LOADOUT_CRITERIA = [
  "Delegation Spec and Workstream Run exist for SF-LOAD-001.",
  "Task packet is frozen and hashed.",
  "Loadout PR #26 is attached as historical evidence without mutation.",
  "Merge remains unperformed by Delegation Cloud.",
];

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
const manager = actor({ id: "manager-1", role: "ops_manager", organizationId: null });
const harborOwner = actor({
  id: "harbor-owner",
  role: "client_admin",
  organizationId: "org-harbor",
});

function intake(taskId: string) {
  return {
    schemaVersion: SOFTWARE_FACTORY_INTAKE_SCHEMA_VERSION,
    taskId,
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
    risk: "medium" as const,
    dependencies: ["Historical Loadout PR #26"],
    approvalRequirements: ["owner_acceptance", "merge_pr"],
    actionClass: SOFTWARE_FACTORY_ACTION_CLASS,
    requestedBy: owner.id,
  };
}

function packetFor(taskId: string) {
  return {
    schemaVersion: SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
    STATUS: "planned" as const,
    TASK_ID: taskId,
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
    RISK: "medium" as const,
    APPROVAL_REQUIRED: ["owner_acceptance", "merge_pr"],
    HANDOFF_NOTES:
      "PM and Developer coordination is human-mediated because no approved Grok Bot or Cursor connector exists.",
    claimedApprovalIds: [] as string[],
  };
}

function openRun(store: SoftwareFactoryStore, taskId = "SF-LOAD-001") {
  const submitted = submitSoftwareWorkRequest(store, owner, intake(taskId), `evt-intake-${taskId}`, NOW);
  expect(submitted.ok).toBe(true);
  if (!submitted.ok) throw new Error(submitted.failures.join(" "));
  const provisioned = provisionSoftwareFactoryRun(store, manager, submitted.value.id, `evt-provision-${taskId}`, NOW);
  expect(provisioned.ok).toBe(true);
  if (!provisioned.ok) throw new Error(provisioned.failures.join(" "));
  return provisioned.value;
}

function freezePacket(store: SoftwareFactoryStore, factoryRunId: string, taskId: string) {
  expect(transitionSoftwareFactoryRun(store, manager, factoryRunId, "discovery", `evt-d-${taskId}`, NOW).ok).toBe(true);
  expect(transitionSoftwareFactoryRun(store, manager, factoryRunId, "planned", `evt-p-${taskId}`, NOW).ok).toBe(true);
  const frozen = produceSoftwareFactoryPacket(
    store,
    manager,
    factoryRunId,
    packetFor(taskId),
    `evt-packet-${taskId}`,
    NOW,
  );
  expect(frozen.ok).toBe(true);
  if (!frozen.ok) throw new Error(frozen.failures.join(" "));
  return frozen.value;
}

describe("Software Factory owner-decision fail-closed", () => {
  it("refuses an owner decision before a task packet is frozen", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    const decided = recordSoftwareFactoryOwnerDecision(
      store,
      owner,
      opened.run.id,
      {
        kind: "owner_acceptance",
        status: "approved",
        rationale: "Accepting before the packet exists.",
        sourceRefs: ["governance:owner-acceptance"],
      },
      "evt-early-owner",
      NOW,
    );
    expect(decided.ok).toBe(false);
    expect(decided.ok ? "" : decided.failures.join(" ")).toMatch(/frozen task packet hash/);
    expect(getSoftwareFactoryRun(store, manager, opened.run.id).packetHash).toBeNull();
  });

  it("rejects a missing approval, a kind mismatch, and an approval from another run", () => {
    const store = createSoftwareFactoryStore();
    const first = openRun(store, "SF-LOAD-001");
    freezePacket(store, first.run.id, "SF-LOAD-001");
    const requested = requestSoftwareFactoryApproval(
      store,
      manager,
      first.run.id,
      "merge_pr",
      "Merge stays outside Delegation Cloud.",
      "evt-merge-approval",
      NOW,
    );
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error(requested.failures.join(" "));

    const missing = recordSoftwareFactoryOwnerDecision(
      store,
      owner,
      first.run.id,
      {
        approvalId: "approval-does-not-exist",
        kind: "merge_pr",
        status: "approved",
        rationale: "Decide a row that was never requested.",
        sourceRefs: ["governance:owner-acceptance"],
      },
      "evt-missing-approval",
      NOW,
    );
    expect(missing.ok).toBe(false);
    expect(missing.ok ? "" : missing.failures.join(" ")).toMatch(/Approval request not found/);

    const mismatched = recordSoftwareFactoryOwnerDecision(
      store,
      owner,
      first.run.id,
      {
        approvalId: requested.value.id,
        kind: "owner_acceptance",
        status: "approved",
        rationale: "Treat a merge request as owner acceptance.",
        sourceRefs: ["governance:owner-acceptance"],
      },
      "evt-kind-mismatch",
      NOW,
    );
    expect(mismatched.ok).toBe(false);
    expect(mismatched.ok ? "" : mismatched.failures.join(" ")).toMatch(/does not match the approval request/);

    const second = openRun(store, "SF-LOAD-002");
    freezePacket(store, second.run.id, "SF-LOAD-002");
    const foreign = recordSoftwareFactoryOwnerDecision(
      store,
      owner,
      second.run.id,
      {
        approvalId: requested.value.id,
        kind: "merge_pr",
        status: "approved",
        rationale: "Reuse the other run's approval row.",
        sourceRefs: ["governance:owner-acceptance"],
      },
      "evt-foreign-approval",
      NOW,
    );
    expect(foreign.ok).toBe(false);
    expect(foreign.ok ? "" : foreign.failures.join(" ")).toMatch(/does not belong to this run/);
  });

  it("does not let a Harbor owner decide a Northline run", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    freezePacket(store, opened.run.id, "SF-LOAD-001");
    expect(() =>
      recordSoftwareFactoryOwnerDecision(
        store,
        harborOwner,
        opened.run.id,
        {
          kind: "owner_acceptance",
          status: "approved",
          rationale: "Harbor should not bind Northline acceptance.",
          sourceRefs: ["governance:owner-acceptance"],
        },
        "evt-harbor-owner",
        NOW,
      ),
    ).toThrow(AuthzError);
  });
});
