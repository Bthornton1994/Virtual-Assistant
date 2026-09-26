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
    inputContracts: [{ schemaVersion: "catalog-evidence-input/v1", purpose: "frozen research inputs" }],
    outputContracts: [{ schemaVersion: "catalog-evidence-packet/v1", purpose: "candidate evidence packet" }],
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

describe("role contract library fail-closed", () => {
  it("rejects an empty library and does not invent a missing role", () => {
    const empty = validateRoleContractLibrary([]);
    expect(empty.ok).toBe(false);
    expect(empty.ok ? "" : empty.failures.join(" ")).toMatch(/At least one role contract is required/);

    const valid = validateRoleContractLibrary([role()]);
    expect(valid.ok).toBe(true);
    if (!valid.ok) throw new Error(valid.failures.join("; "));
    expect(findRoleContract(valid.roles, "independent_reviewer")).toBeNull();
  });

  it("rejects duplicate capabilities, forbidden actions, and failure-mode codes", () => {
    const capabilities = validateRoleContractLibrary([
      role({ requiredCapabilities: ["evidence_research", "evidence_research"] }),
    ]);
    expect(capabilities.ok).toBe(false);
    expect(capabilities.ok ? "" : capabilities.failures.join(" ")).toMatch(/must not contain duplicates/);

    const forbidden = validateRoleContractLibrary([
      role({ forbiddenActions: ["send_external_message", "send_external_message"] }),
    ]);
    expect(forbidden.ok).toBe(false);
    expect(forbidden.ok ? "" : forbidden.failures.join(" ")).toMatch(/must not contain duplicates/);

    const modes = validateRoleContractLibrary([
      role({
        knownFailureModes: [
          {
            code: "source_gap",
            description: "A required source cannot be verified",
            observableSignal: "required source field is missing",
          },
          {
            code: "source_gap",
            description: "Repeated failure code",
            observableSignal: "same code again",
          },
        ],
      }),
    ]);
    expect(modes.ok).toBe(false);
    expect(modes.ok ? "" : modes.failures.join(" ")).toMatch(/failure mode codes must be unique/);
  });

  it("requires human approval for sensitive fallback and rejects extra keys", () => {
    const sensitive = validateRoleContractLibrary([
      role({
        key: "sensitive_specialist",
        allowedAuthorityClass: "sensitive_execution",
        fallbackPolicy: {
          mode: "escalate_human",
          triggerCodes: ["source_gap"],
          requiresHumanApproval: false,
        },
      }),
    ]);
    expect(sensitive.ok).toBe(false);
    expect(sensitive.ok ? "" : sensitive.failures.join(" ")).toMatch(/require human approval/);

    const extra = validateRoleContractLibrary([
      {
        ...role(),
        grantsAuthority: true,
      },
    ]);
    expect(extra.ok).toBe(false);
  });
});
