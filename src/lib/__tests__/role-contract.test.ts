import { describe, expect, it } from "vitest";
import {
  ROLE_CONTRACT_SCHEMA_VERSION,
  findRoleContract,
  validateRoleContractLibrary,
  type RoleContract,
} from "@/lib/role-contract";

function role(overrides: Partial<RoleContract> = {}): RoleContract {
  return {
    schemaVersion: ROLE_CONTRACT_SCHEMA_VERSION,
    key: "evidence_researcher",
    mission: "Prepare source-backed evidence from frozen inputs",
    requiredCapabilities: ["evidence_research"],
    inputContracts: [
      { schemaVersion: "catalog-evidence-input/v1", purpose: "frozen research inputs" },
    ],
    outputContracts: [
      { schemaVersion: "catalog-evidence-packet/v1", purpose: "candidate evidence packet" },
    ],
    allowedAuthorityClass: "prepare_only",
    mayOwnAuthoritativeState: false,
    forbiddenActions: ["send_external_message", "modify_authoritative_record"],
    knownFailureModes: [
      {
        code: "source_gap",
        description: "A required source cannot be verified",
        observableSignal: "required source field is missing",
      },
    ],
    fallbackPolicy: {
      mode: "escalate_human",
      triggerCodes: ["source_gap"],
      requiresHumanApproval: true,
    },
    evaluationSuite: {
      suiteKey: "catalog-evidence-v1",
      suiteVersion: "v1",
      requiredEvidence: ["source-artifact-hash", "independent-review"],
      successCriteria: ["Every accepted claim has source provenance"],
    },
    ...overrides,
  };
}

describe("role contract library v1", () => {
  it("validates and sorts reusable roles without creating executor identities", () => {
    const first = role();
    const second = role({
      key: "independent_reviewer",
      mission: "Challenge evidence without changing the reviewed packet",
      requiredCapabilities: ["independent_evidence_review"],
      inputContracts: [
        { schemaVersion: "catalog-evidence-packet/v1", purpose: "prepared packet" },
      ],
      outputContracts: [
        { schemaVersion: "catalog-evidence-review/v1", purpose: "independent review" },
      ],
      forbiddenActions: ["modify_reviewed_packet"],
    });
    const result = validateRoleContractLibrary([first, second]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.roles.map((item) => item.key)).toEqual([
      "evidence_researcher",
      "independent_reviewer",
    ]);
    expect(findRoleContract(result.roles, "evidence_researcher")?.allowedAuthorityClass).toBe("prepare_only");
  });

  it("rejects duplicate role keys and unknown fallback failure modes", () => {
    const result = validateRoleContractLibrary([
      role(),
      role({ key: "evidence_researcher", fallbackPolicy: { ...role().fallbackPolicy, triggerCodes: ["unknown"] } }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toMatch(/unknown failure mode|duplicates key/);
  });

  it("requires human approval for external or sensitive fallback", () => {
    const result = validateRoleContractLibrary([
      role({
        allowedAuthorityClass: "external_execution",
        fallbackPolicy: { ...role().fallbackPolicy, requiresHumanApproval: false },
      }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("require human approval");
  });

  it("rejects a role that tries to own authoritative state", () => {
    const result = validateRoleContractLibrary([
      role({ mayOwnAuthoritativeState: true as unknown as false }),
    ]);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.failures.join(" ")).toContain("mayOwnAuthoritativeState");
  });
});
