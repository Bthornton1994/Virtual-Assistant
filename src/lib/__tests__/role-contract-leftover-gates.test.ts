import { describe, expect, it } from "vitest";
import {
  ROLE_CONTRACT_SCHEMA_VERSION,
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

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("role-contract leftover nested shape gates", () => {
  it("refuses padded identifiers, unknown capabilities, and unknown fallback modes", () => {
    const padded = validateRoleContractLibrary([role({ key: " evidence_researcher " })]);
    expect(padded.ok).toBe(false);
    expect(failuresOf(padded)).toMatch(/must not have leading or trailing whitespace/);

    const unknownCapability = validateRoleContractLibrary([
      role({ requiredCapabilities: ["owner_override" as RoleContract["requiredCapabilities"][number]] }),
    ]);
    expect(unknownCapability.ok).toBe(false);
    expect(failuresOf(unknownCapability)).toMatch(/requiredCapabilities/i);

    const unknownFallback = validateRoleContractLibrary([
      role({
        fallbackPolicy: {
          mode: "auto_promote" as RoleContract["fallbackPolicy"]["mode"],
          triggerCodes: ["source_gap"],
          requiresHumanApproval: true,
        },
      }),
    ]);
    expect(unknownFallback.ok).toBe(false);
    expect(failuresOf(unknownFallback)).toMatch(/fallbackPolicy\.mode|Invalid option/i);
  });

  it("refuses extra keys on nested fallback, failure, evaluation, and contract objects", () => {
    const extraFallback = validateRoleContractLibrary([
      role({
        fallbackPolicy: {
          mode: "escalate_human",
          triggerCodes: ["source_gap"],
          requiresHumanApproval: true,
          autoApprove: true,
        } as RoleContract["fallbackPolicy"] & { autoApprove: boolean },
      }),
    ]);
    expect(extraFallback.ok).toBe(false);
    expect(failuresOf(extraFallback)).toMatch(/unrecognized|additional/i);

    const extraFailure = validateRoleContractLibrary([
      role({
        knownFailureModes: [
          {
            code: "source_gap",
            description: "A required source cannot be verified",
            observableSignal: "required source field is missing",
            silent: true,
          } as RoleContract["knownFailureModes"][number] & { silent: boolean },
        ],
      }),
    ]);
    expect(extraFailure.ok).toBe(false);
    expect(failuresOf(extraFailure)).toMatch(/unrecognized|additional/i);

    const extraSuite = validateRoleContractLibrary([
      role({
        evaluationSuite: {
          suiteKey: "catalog-evidence-v1",
          suiteVersion: "v1",
          requiredEvidence: ["source-artifact-hash", "independent-review"],
          successCriteria: ["Every accepted claim has source provenance"],
          skipReview: true,
        } as RoleContract["evaluationSuite"] & { skipReview: boolean },
      }),
    ]);
    expect(extraSuite.ok).toBe(false);
    expect(failuresOf(extraSuite)).toMatch(/unrecognized|additional/i);

    const extraContract = validateRoleContractLibrary([
      role({
        inputContracts: [
          {
            schemaVersion: "catalog-evidence-input/v1",
            purpose: "frozen research inputs",
            grant: true,
          } as RoleContract["inputContracts"][number] & { grant: boolean },
        ],
      }),
    ]);
    expect(extraContract.ok).toBe(false);
    expect(failuresOf(extraContract)).toMatch(/unrecognized|additional/i);
  });

  it("refuses empty evaluation evidence or success-criteria lists", () => {
    const emptyEvidence = validateRoleContractLibrary([
      role({
        evaluationSuite: {
          suiteKey: "catalog-evidence-v1",
          suiteVersion: "v1",
          requiredEvidence: [],
          successCriteria: ["Every accepted claim has source provenance"],
        },
      }),
    ]);
    expect(emptyEvidence.ok).toBe(false);
    expect(failuresOf(emptyEvidence)).toMatch(/requiredEvidence/i);

    const emptyCriteria = validateRoleContractLibrary([
      role({
        evaluationSuite: {
          suiteKey: "catalog-evidence-v1",
          suiteVersion: "v1",
          requiredEvidence: ["source-artifact-hash"],
          successCriteria: [],
        },
      }),
    ]);
    expect(emptyCriteria.ok).toBe(false);
    expect(failuresOf(emptyCriteria)).toMatch(/successCriteria/i);
  });
});
