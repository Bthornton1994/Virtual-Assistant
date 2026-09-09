import { describe, expect, it } from "vitest";
import {
  checkExecutionLease,
  decideExecutionRetry,
  dependencyState,
  deriveExecutionPlanStatus,
  hashExecutionPlan,
  readyStepKeys,
  validateExecutionPlan,
  type ExecutionPlanInput,
  type ExecutionPlanStep,
} from "@/lib/execution-runtime";

const CREATED_AT = "2026-09-03T10:00:00.000Z";
const DEADLINE = "2026-09-03T11:00:00.000Z";

function step(overrides: Partial<ExecutionPlanStep> = {}): ExecutionPlanStep {
  return {
    stepKey: "research",
    sequence: 1,
    title: "Prepare source-backed research",
    capabilityKey: "business_research",
    inputContractVersion: "business-input/v1",
    outputContractVersion: "business-evidence/v1",
    actionClass: "prepare_only",
    dataSensitivity: "public",
    dependsOn: [],
    requiresHumanApproval: false,
    externalSideEffect: false,
    mayOwnAuthoritativeState: false,
    maxAttempts: 2,
    deadline: DEADLINE,
    ...overrides,
  };
}

function plan(overrides: Partial<ExecutionPlanInput> = {}): ExecutionPlanInput {
  return {
    schemaVersion: "execution-runtime/v1",
    planId: "plan-001",
    runId: "run-001",
    organizationId: "org-001",
    delegationSpecId: "spec-001",
    planVersion: 1,
    delegationSpecVersion: 1,
    objective: "Prepare a source-backed operating brief",
    authorityClass: "prepare_only",
    dataPolicy: { allowedSource: "public" },
    steps: [
      step(),
      step({
        stepKey: "review",
        sequence: 2,
        title: "Independently challenge the brief",
        capabilityKey: "independent_evidence_review",
        inputContractVersion: "business-evidence/v1",
        outputContractVersion: "business-review/v1",
        dependsOn: ["research"],
      }),
    ],
    createdAt: CREATED_AT,
    mayOwnAuthoritativeState: false,
    ...overrides,
  };
}

describe("execution runtime v1", () => {
  it("builds a canonical hash independent of dependency-array order", () => {
    const first = validateExecutionPlan(
      plan({
        steps: [
          step(),
          step({
            stepKey: "review",
            sequence: 2,
            title: "Independently challenge the brief",
            capabilityKey: "independent_evidence_review",
            inputContractVersion: "business-evidence/v1",
            outputContractVersion: "business-review/v1",
            dependsOn: ["research"],
          }),
          step({
            stepKey: "deliverable",
            sequence: 3,
            title: "Assemble the reviewed brief",
            capabilityKey: "structured_data_transform",
            inputContractVersion: "business-review/v1",
            outputContractVersion: "business-deliverable/v1",
            dependsOn: ["review", "research"],
          }),
        ],
      }),
    );
    const second = validateExecutionPlan(
      plan({
        steps: [
          step({
            stepKey: "research",
            sequence: 1,
            dependsOn: [],
          }),
          step({
            stepKey: "review",
            sequence: 2,
            dependsOn: ["research"],
            inputContractVersion: "business-evidence/v1",
            outputContractVersion: "business-review/v1",
            capabilityKey: "independent_evidence_review",
            title: "Independently challenge the brief",
          }),
          step({
            stepKey: "deliverable",
            sequence: 3,
            title: "Assemble the reviewed brief",
            capabilityKey: "structured_data_transform",
            inputContractVersion: "business-review/v1",
            outputContractVersion: "business-deliverable/v1",
            dependsOn: ["research", "review"],
          }),
        ],
      }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.planHash).toBe(second.value.planHash);
      expect(hashExecutionPlan(first.value)).toBe(first.value.planHash);
    }
  });

  it("rejects cycles, authority escalation, and unapproved side effects", () => {
    const cycle = validateExecutionPlan(
      plan({
        steps: [
          step({ stepKey: "research", dependsOn: ["review"] }),
          step({
            stepKey: "review",
            sequence: 2,
            dependsOn: ["research"],
            inputContractVersion: "business-evidence/v1",
            outputContractVersion: "business-review/v1",
            capabilityKey: "independent_evidence_review",
            title: "Independently challenge the brief",
          }),
        ],
      }),
    );
    expect(cycle.ok).toBe(false);
    expect(cycle.ok ? "" : cycle.failures.join(" ")).toContain("dependency cycle");

    const escalation = validateExecutionPlan(
      plan({
        steps: [
          step({
            actionClass: "external_execution",
            requiresHumanApproval: false,
            externalSideEffect: true,
          }),
        ],
      }),
    );
    expect(escalation.ok).toBe(false);
    expect(escalation.ok ? "" : escalation.failures.join(" ")).toContain("require human approval");

    const authority = validateExecutionPlan(
      plan({
        steps: [step({ actionClass: "low_risk_execution" })],
      }),
    );
    expect(authority.ok).toBe(false);
    expect(authority.ok ? "" : authority.failures.join(" ")).toContain("exceeds the plan authority");

    const secretMaterial = validateExecutionPlan(
      plan({ dataPolicy: { credentialToken: "must-not-be-here" } }),
    );
    expect(secretMaterial.ok).toBe(false);
    expect(secretMaterial.ok ? "" : secretMaterial.failures.join(" ")).toContain("secret material");

    const expiredAtCreation = validateExecutionPlan(
      plan({ steps: [step({ deadline: "2026-09-03T09:59:59.000Z" })] }),
    );
    expect(expiredAtCreation.ok).toBe(false);
    expect(expiredAtCreation.ok ? "" : expiredAtCreation.failures.join(" ")).toContain("precede plan creation");
  });

  it("only releases dependency-ready work and blocks descendants of failed work", () => {
    const steps = plan().steps;
    expect(readyStepKeys(steps, { research: "pending", review: "pending" })).toEqual(["research"]);
    expect(dependencyState(steps[1], { research: "running" })).toBe("waiting");
    expect(dependencyState(steps[1], { research: "failed" })).toBe("blocked");
    expect(readyStepKeys(steps, { research: "succeeded", review: "pending" })).toEqual(["review"]);
  });

  it("derives terminal plan state without trusting worker claims", () => {
    expect(deriveExecutionPlanStatus([{ status: "succeeded" }, { status: "succeeded" }])).toBe("completed");
    expect(deriveExecutionPlanStatus([{ status: "succeeded" }, { status: "blocked" }])).toBe("blocked");
    expect(deriveExecutionPlanStatus([{ status: "running" }, { status: "pending" }])).toBe("running");
    expect(deriveExecutionPlanStatus([{ status: "cancelled" }, { status: "cancelled" }])).toBe("cancelled");
  });

  it("red-teams retry policy around security, ambiguity, and bounded transient failures", () => {
    const security = decideExecutionRetry({
      failureClass: "security_incident",
      attemptNumber: 1,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(security.decision).toBe("suspend_workstream");
    expect(security.shouldRetry).toBe(false);

    const ambiguity = decideExecutionRetry({
      failureClass: "source_ambiguity",
      attemptNumber: 1,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(ambiguity.decision).toBe("escalate_human");

    const transient = decideExecutionRetry({
      failureClass: "integration_failure",
      attemptNumber: 1,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(transient.decision).toBe("retry_same_executor");
    expect(transient.nextAvailableAt).toBe("2026-09-03T10:00:01.000Z");

    const exhausted = decideExecutionRetry({
      failureClass: "executor_failure",
      attemptNumber: 3,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(exhausted.shouldRetry).toBe(false);
    expect(exhausted.terminalStepStatus).toBe("failed");
  });

  it("refuses stale, mismatched, or malformed leases", () => {
    const token = "a".repeat(64);
    const lease = {
      attemptId: "attempt-001",
      stepKey: "research",
      workerId: "worker-001",
      leaseTokenHash: token,
      leaseExpiresAt: "2026-09-03T10:05:00.000Z",
    };
    expect(checkExecutionLease(lease, lease, CREATED_AT).ok).toBe(true);
    expect(checkExecutionLease(lease, { ...lease, workerId: "worker-002" }, CREATED_AT)).toEqual({
      ok: false,
      reason: "lease_credential_mismatch",
    });
    expect(checkExecutionLease(lease, { ...lease, leaseTokenHash: "b".repeat(64) }, CREATED_AT)).toEqual({
      ok: false,
      reason: "lease_credential_mismatch",
    });
    expect(checkExecutionLease(lease, lease, "2026-09-03T10:05:00.000Z")).toEqual({
      ok: false,
      reason: "lease_expired",
    });
  });
});
