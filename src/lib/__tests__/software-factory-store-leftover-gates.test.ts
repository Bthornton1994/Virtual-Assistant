import { describe, expect, it } from "vitest";
import { AuthzError, DomainError, type Actor } from "@/lib/domain";
import {
  SOFTWARE_FACTORY_ACTION_CLASS,
  SOFTWARE_FACTORY_INTAKE_SCHEMA_VERSION,
} from "@/lib/software-factory-run-manager";
import {
  attachSoftwareFactoryEvidence,
  createSoftwareFactoryStore,
  getSoftwareFactoryRun,
  inspectSoftwareFactoryRepository,
  issueSoftwareFactoryOutcomeReceipt,
  listSoftwareFactoryRunsForOrg,
  produceSoftwareFactoryPacket,
  provisionSoftwareFactoryRun,
  recordSoftwareFactoryHandoff,
  softwareFactoryProblems,
  submitSoftwareWorkRequest,
  trackCursorCloudAgentExecution,
  type SoftwareFactoryStore,
} from "@/lib/software-factory-store";

const NOW = "2026-09-04T12:00:00.000Z";

function actor(overrides: Partial<Actor> & Pick<Actor, "id" | "role">): Actor {
  return {
    email: `${overrides.id}@delegation.cloud`,
    name: overrides.id,
    organizationId: overrides.organizationId ?? "org-northline",
    operatorId: overrides.operatorId ?? null,
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
const harborMember = actor({
  id: "harbor-member",
  role: "client_member",
  organizationId: "org-harbor",
});

function intake(taskId = "SF-LOAD-001") {
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
    outOfScope: ["Merging, reopening, or modifying Loadout PR #26."],
    acceptanceCriteria: [
      "Delegation Spec and Workstream Run exist for SF-LOAD-001.",
      "Owner acceptance is recorded outside the packet.",
    ],
    constraints: ["prepare_only"],
    risk: "medium" as const,
    dependencies: ["Historical Loadout PR #26"],
    approvalRequirements: ["owner_acceptance"],
    actionClass: SOFTWARE_FACTORY_ACTION_CLASS,
    requestedBy: owner.id,
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

describe("software-factory leftover store RBAC gates", () => {
  it("does not let leftover operators submit intake or create a run", () => {
    const store = createSoftwareFactoryStore();
    const result = submitSoftwareWorkRequest(store, operator, intake("SF-OP-001"), "evt-op-intake", NOW);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.failures.join(" ")).toMatch(/cannot submit/);
    expect(store.runs.size).toBe(0);
  });

  it("does not let leftover clients provision, inspect, freeze, attach, hand off, or track execution", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);
    const factoryRunId = opened.run.id;

    const provision = provisionSoftwareFactoryRun(store, owner, factoryRunId, "evt-owner-provision", NOW);
    expect(provision.ok).toBe(false);
    expect(provision.ok ? "" : provision.failures.join(" ")).toMatch(/operations managers/);

    const inspect = inspectSoftwareFactoryRepository(store, member, factoryRunId, {}, "evt-member-inspect", NOW);
    expect(inspect.ok).toBe(false);
    expect(inspect.ok ? "" : inspect.failures.join(" ")).toMatch(/operations staff/);

    const freeze = produceSoftwareFactoryPacket(store, owner, factoryRunId, {}, "evt-owner-packet", NOW);
    expect(freeze.ok).toBe(false);
    expect(freeze.ok ? "" : freeze.failures.join(" ")).toMatch(/operations staff/);

    const attach = attachSoftwareFactoryEvidence(
      store,
      owner,
      factoryRunId,
      {
        evidenceId: "ev-client",
        kind: "pull_request",
        summary: "Client-attached PR",
        sourceUri: "https://github.com/Bthornton1994/Loadout/pull/26",
        conclusion: "pass",
        satisfiedCriteria: [],
        recordedAt: NOW,
        mutatesRepository: false,
      },
      "evt-owner-evidence",
      NOW,
    );
    expect(attach.ok).toBe(false);
    expect(attach.ok ? "" : attach.failures.join(" ")).toMatch(/operations staff/);
    expect(store.evidenceByRun.get(factoryRunId) ?? []).toEqual([]);

    const handoff = recordSoftwareFactoryHandoff(store, member, factoryRunId, {}, "evt-member-handoff", NOW);
    expect(handoff.ok).toBe(false);
    expect(handoff.ok ? "" : handoff.failures.join(" ")).toMatch(/operations staff/);

    const cursor = trackCursorCloudAgentExecution(store, owner, factoryRunId, {}, "evt-owner-cursor", NOW);
    expect(cursor.ok).toBe(false);
    expect(cursor.ok ? "" : cursor.failures.join(" ")).toMatch(/operations staff/);
  });

  it("does not let leftover operators or leftover clients issue an Outcome Receipt", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);

    const operatorReceipt = issueSoftwareFactoryOutcomeReceipt(
      store,
      operator,
      opened.run.id,
      "evt-op-receipt",
      NOW,
    );
    expect(operatorReceipt.ok).toBe(false);
    expect(operatorReceipt.ok ? "" : operatorReceipt.failures.join(" ")).toMatch(/operations managers/);

    const ownerReceipt = issueSoftwareFactoryOutcomeReceipt(store, owner, opened.run.id, "evt-owner-receipt", NOW);
    expect(ownerReceipt.ok).toBe(false);
    expect(ownerReceipt.ok ? "" : ownerReceipt.failures.join(" ")).toMatch(/operations managers/);
    expect(store.receipts.size).toBe(0);
  });
});

describe("software-factory leftover store isolation gates", () => {
  it("throws DomainError for leftover missing runs instead of inventing overlay state", () => {
    const store = createSoftwareFactoryStore();
    expect(() => getSoftwareFactoryRun(store, manager, "sfr-missing")).toThrow(DomainError);
    expect(() => getSoftwareFactoryRun(store, owner, "sfr-missing")).toThrow(DomainError);
    expect(() => softwareFactoryProblems(store, "sfr-missing", NOW)).toThrow(DomainError);
    expect(store.runs.size).toBe(0);
  });

  it("keeps leftover Harbor members off leftover Northline runs", () => {
    const store = createSoftwareFactoryStore();
    const opened = openRun(store);

    expect(() => getSoftwareFactoryRun(store, harborMember, opened.run.id)).toThrow(AuthzError);
    expect(() => listSoftwareFactoryRunsForOrg(store, harborMember, "org-northline")).toThrow(AuthzError);
    expect(listSoftwareFactoryRunsForOrg(store, harborMember, "org-harbor")).toEqual([]);
    expect(listSoftwareFactoryRunsForOrg(store, member, "org-northline")).toHaveLength(1);
  });
});
