import { describe, expect, it } from "vitest";
import {
  SOFTWARE_FACTORY_ACTION_CLASS,
  SOFTWARE_FACTORY_INTAKE_SCHEMA_VERSION,
  SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION,
  SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
  detectScopeExpansion,
  isReservedSoftwareFactoryEvidenceSchema,
  packetClaimsSelfAuthorization,
  rejectSecrets,
  softwareFactoryHandoffSchema,
  validatePacketAgainstRun,
  validateSoftwareFactoryIntake,
  validateSoftwareFactoryPacket,
  type SoftwareFactoryPacket,
  type SoftwareFactoryRun,
} from "@/lib/software-factory-run-manager";

const LOADOUT_CRITERIA = [
  "Delegation Spec and Workstream Run exist for SF-LOAD-001.",
  "Task packet is frozen and hashed.",
  "Loadout PR #26 is attached as historical evidence without mutation.",
  "Merge remains unperformed by Delegation Cloud.",
];

const IN_SCOPE = [
  "Record the Loadout proof as a Delegation Cloud Software Factory run.",
  "Attach historical PR and verification evidence.",
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
    inScope: IN_SCOPE,
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
    requestedBy: "owner-1",
    ...overrides,
  };
}

function packet(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
    STATUS: "planned",
    TASK_ID: "SF-LOAD-001",
    REPOSITORY: "Bthornton1994/Loadout",
    BASE_BRANCH: "main",
    OBJECTIVE: "Demonstrate Software Factory control of the Loadout proof workflow without mutating Loadout.",
    BACKGROUND: "PR https://github.com/Bthornton1994/Loadout/pull/26 merged historically and is evidence only.",
    IN_SCOPE,
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
    ...overrides,
  };
}

function run(
  overrides: Partial<Pick<SoftwareFactoryRun, "taskId" | "repository" | "baseBranch" | "lifecycleStatus" | "frozenInScope" | "frozenAcceptanceCriteria">> = {},
) {
  return {
    taskId: "SF-LOAD-001",
    repository: "Bthornton1994/Loadout",
    baseBranch: "main",
    lifecycleStatus: "planned" as const,
    frozenInScope: IN_SCOPE,
    frozenAcceptanceCriteria: LOADOUT_CRITERIA,
    ...overrides,
  };
}

function failuresOf(result: { ok?: boolean; failures?: string[] } | string[]) {
  if (Array.isArray(result)) return result.join(" ");
  return result.ok ? "" : (result.failures ?? []).join(" ");
}

describe("Software Factory leftover intake gates", () => {
  it("accepts a well-formed intake and refuses extra keys or padded identifiers", () => {
    expect(validateSoftwareFactoryIntake(intake()).ok).toBe(true);

    const extra = validateSoftwareFactoryIntake({ ...intake(), mergeAuthorized: true });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const paddedTask = validateSoftwareFactoryIntake(intake({ taskId: " SF-LOAD-001 " }));
    expect(paddedTask.ok).toBe(false);
    expect(failuresOf(paddedTask)).toMatch(/whitespace|taskId/i);

    const paddedRequester = validateSoftwareFactoryIntake(intake({ requestedBy: " owner-1 " }));
    expect(paddedRequester.ok).toBe(false);
    expect(failuresOf(paddedRequester)).toMatch(/whitespace|requestedBy/i);
  });

  it("requires owner_acceptance, prepare_only, and a non-empty in-scope list", () => {
    const missingOwner = validateSoftwareFactoryIntake(intake({ approvalRequirements: ["merge_pr"] }));
    expect(missingOwner.ok).toBe(false);
    expect(failuresOf(missingOwner)).toMatch(/owner_acceptance/i);

    const wrongClass = validateSoftwareFactoryIntake(intake({ actionClass: "external_execution" }));
    expect(wrongClass.ok).toBe(false);
    expect(failuresOf(wrongClass)).toMatch(/actionClass|prepare_only/i);

    const emptyScope = validateSoftwareFactoryIntake(intake({ inScope: [] }));
    expect(emptyScope.ok).toBe(false);
    expect(failuresOf(emptyScope)).toMatch(/inScope/i);
  });

  it("fails closed on credential-shaped keys and remaining secret values", () => {
    const keyName = validateSoftwareFactoryIntake(intake({ apiKey: "not-a-real-key" }));
    expect(keyName.ok).toBe(false);
    expect(failuresOf(keyName)).toMatch(/unrecognized|additional|credential/i);

    const xai = rejectSecrets({ notes: "Use xai-abcdefghijklmnopqrstuvwx" }, "Intake");
    expect(xai.join(" ")).toMatch(/credential/i);

    const nested = rejectSecrets({ handoff: { authorization: "Bearer abc" } }, "Packet");
    expect(nested.join(" ")).toMatch(/credential/i);
    expect(nested.join(" ")).toMatch(/authorization/i);

    expect(rejectSecrets(intake(), "Intake")).toEqual([]);
  });
});

describe("Software Factory leftover packet gates", () => {
  it("refuses extra keys, padded task IDs, and remaining self-authorization phrases", () => {
    expect(validateSoftwareFactoryPacket(packet()).ok).toBe(true);

    const extra = validateSoftwareFactoryPacket({ ...packet(), ownerApprovedInPacket: true });
    expect(extra.ok).toBe(false);
    expect(failuresOf(extra)).toMatch(/unrecognized|additional/i);

    const padded = validateSoftwareFactoryPacket(packet({ TASK_ID: " SF-LOAD-001 " }));
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/whitespace|TASK_ID/i);

    const parsed = validateSoftwareFactoryPacket(packet());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.failures.join(" "));
    expect(packetClaimsSelfAuthorization(parsed.value)).toBe(false);

    for (const phrase of ["approved by this packet", "packet authorizes", "authorized by the packet"]) {
      const claimed = validateSoftwareFactoryPacket(packet({ HANDOFF_NOTES: `Ready; ${phrase}.` }));
      expect(claimed.ok).toBe(true);
      if (!claimed.ok) throw new Error(claimed.failures.join(" "));
      expect(packetClaimsSelfAuthorization(claimed.value), phrase).toBe(true);
    }
  });

  it("does not treat case or trim differences as scope expansion, and still refuses a new path", () => {
    expect(
      detectScopeExpansion(
        [" Record the Loadout proof as a Delegation Cloud Software Factory run. "],
        ["record the loadout proof as a delegation cloud software factory run."],
      ),
    ).toEqual([]);

    expect(detectScopeExpansion(IN_SCOPE, [...IN_SCOPE, "Also rewrite production secrets."])).toEqual([
      "Also rewrite production secrets.",
    ]);
  });

  it("binds packet identity to the frozen run and refuses dropped criteria or missing owner_acceptance", () => {
    const parsed = validateSoftwareFactoryPacket(packet());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.failures.join(" "));
    const frozen = parsed.value;

    expect(validatePacketAgainstRun(frozen, run())).toEqual([]);

    expect(validatePacketAgainstRun(frozen, run({ taskId: "SF-OTHER" })).join(" ")).toMatch(/TASK_ID/i);
    expect(validatePacketAgainstRun(frozen, run({ repository: "other/repo" })).join(" ")).toMatch(/REPOSITORY/i);
    expect(validatePacketAgainstRun(frozen, run({ baseBranch: "develop" })).join(" ")).toMatch(/BASE_BRANCH/i);

    const dropped = validateSoftwareFactoryPacket(
      packet({ ACCEPTANCE_CRITERIA: LOADOUT_CRITERIA.slice(0, 1) }),
    );
    expect(dropped.ok).toBe(true);
    if (!dropped.ok) throw new Error(dropped.failures.join(" "));
    expect(validatePacketAgainstRun(dropped.value, run()).join(" ")).toMatch(/dropped frozen intake criteria/i);

    const missingOwner = validateSoftwareFactoryPacket(packet({ APPROVAL_REQUIRED: ["merge_pr"] }));
    expect(missingOwner.ok).toBe(true);
    if (!missingOwner.ok) throw new Error(missingOwner.failures.join(" "));
    expect(validatePacketAgainstRun(missingOwner.value as SoftwareFactoryPacket, run()).join(" ")).toMatch(
      /owner_acceptance/i,
    );
  });

  it("reserves packet and owner-decision schemas and refuses an approved-connector handoff that is missing", () => {
    expect(isReservedSoftwareFactoryEvidenceSchema(SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION)).toBe(true);
    expect(isReservedSoftwareFactoryEvidenceSchema(SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION)).toBe(true);
    expect(isReservedSoftwareFactoryEvidenceSchema("catalog-evidence-packet/v1")).toBe(false);
    expect(isReservedSoftwareFactoryEvidenceSchema(" software-factory-packet/v1 ")).toBe(false);

    const missingConnector = softwareFactoryHandoffSchema.safeParse({
      schemaVersion: "software-factory-handoff/v1",
      workerRole: "software_factory_developer",
      connectorKey: "cursor_cloud_agent",
      mediation: "approved_connector",
      summary: "Use the missing connector anyway.",
      missingConnector: true,
      connectorLimitation: "Not available.",
    });
    expect(missingConnector.success).toBe(false);
    expect(JSON.stringify(missingConnector.error?.issues ?? [])).toMatch(/cannot report a missing connector/i);

    const humanWithoutMissing = softwareFactoryHandoffSchema.safeParse({
      schemaVersion: "software-factory-handoff/v1",
      workerRole: "software_factory_developer",
      connectorKey: "cursor_cloud_agent",
      mediation: "human_mediated",
      summary: "Human-mediated but the connector is claimed present.",
      missingConnector: false,
      connectorLimitation: null,
    });
    expect(humanWithoutMissing.success).toBe(false);
    expect(JSON.stringify(humanWithoutMissing.error?.issues ?? [])).toMatch(/must report the missing connector/i);
  });
});
