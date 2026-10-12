import { describe, expect, it } from "vitest";
import {
  blockedStepKeys,
  canTransitionExecutionPlan,
  canTransitionExecutionStep,
  checkExecutionLease,
  decideExecutionRetry,
  dependencyState,
  deriveExecutionPlanStatus,
  hashExecutionPlan,
  readyStepKeys,
  retryDelayMs,
  validateExecutionPlan,
  type ExecutionFailureClass,
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

  it("rejects a plan that claims authoritative-state ownership, unknown deps, or a forged hash", () => {
    const authoritative = validateExecutionPlan(plan({ mayOwnAuthoritativeState: true as unknown as false }));
    expect(authoritative.ok).toBe(false);
    expect(authoritative.ok ? "" : authoritative.failures.join(" ")).toContain("mayOwnAuthoritativeState");

    const unknownDep = validateExecutionPlan(plan({ steps: [step({ dependsOn: ["missing-review"] })] }));
    expect(unknownDep.ok).toBe(false);
    expect(unknownDep.ok ? "" : unknownDep.failures.join(" ")).toContain("unknown step missing-review");

    const duplicateKey = validateExecutionPlan(
      plan({
        steps: [step(), step({ stepKey: "research", sequence: 2, title: "Duplicate research key" })],
      }),
    );
    expect(duplicateKey.ok).toBe(false);
    expect(duplicateKey.ok ? "" : duplicateKey.failures.join(" ")).toContain("Duplicate stepKey");

    const sensitive = validateExecutionPlan(
      plan({
        authorityClass: "sensitive_execution",
        steps: [step({ actionClass: "sensitive_execution", requiresHumanApproval: false })],
      }),
    );
    expect(sensitive.ok).toBe(false);
    expect(sensitive.ok ? "" : sensitive.failures.join(" ")).toContain("require human approval");

    const forgedHash = validateExecutionPlan(plan({ planHash: "b".repeat(64) }));
    expect(forgedHash.ok).toBe(false);
    expect(forgedHash.ok ? "" : forgedHash.failures.join(" ")).toContain("planHash does not match");
  });

  it("freezes terminal plan and step statuses and refuses skipped lifecycle jumps", () => {
    expect(canTransitionExecutionPlan("proposed", "frozen")).toBe(true);
    expect(canTransitionExecutionPlan("proposed", "running")).toBe(false);
    expect(canTransitionExecutionPlan("proposed", "completed")).toBe(false);
    expect(canTransitionExecutionPlan("frozen", "running")).toBe(true);
    expect(canTransitionExecutionPlan("blocked", "running")).toBe(true);
    expect(canTransitionExecutionPlan("blocked", "completed")).toBe(false);
    expect(canTransitionExecutionPlan("awaiting_approval", "completed")).toBe(false);
    expect(canTransitionExecutionPlan("completed", "running")).toBe(false);
    expect(canTransitionExecutionPlan("failed", "frozen")).toBe(false);
    expect(canTransitionExecutionPlan("cancelled", "proposed")).toBe(false);

    expect(canTransitionExecutionStep("pending", "ready")).toBe(true);
    expect(canTransitionExecutionStep("pending", "succeeded")).toBe(false);
    expect(canTransitionExecutionStep("ready", "leased")).toBe(true);
    expect(canTransitionExecutionStep("leased", "running")).toBe(true);
    expect(canTransitionExecutionStep("leased", "succeeded")).toBe(false);
    expect(canTransitionExecutionStep("blocked", "ready")).toBe(true);
    expect(canTransitionExecutionStep("blocked", "succeeded")).toBe(false);
    expect(canTransitionExecutionStep("succeeded", "running")).toBe(false);
    expect(canTransitionExecutionStep("failed", "ready")).toBe(false);
    expect(canTransitionExecutionStep("cancelled", "pending")).toBe(false);
  });

  it("lists only pending descendants of failed, blocked, or cancelled work", () => {
    const steps = plan().steps;
    expect(blockedStepKeys(steps, { research: "failed", review: "pending" })).toEqual(["review"]);
    expect(blockedStepKeys(steps, { research: "blocked", review: "pending" })).toEqual(["review"]);
    expect(blockedStepKeys(steps, { research: "cancelled", review: "pending" })).toEqual(["review"]);
    expect(blockedStepKeys(steps, { research: "failed", review: "running" })).toEqual([]);
    expect(blockedStepKeys(steps, { research: "succeeded", review: "pending" })).toEqual([]);
  });

  it("derives failed and approval states without letting mixed cancellation look complete", () => {
    expect(deriveExecutionPlanStatus([{ status: "failed" }, { status: "cancelled" }])).toBe("failed");
    expect(deriveExecutionPlanStatus([{ status: "succeeded" }, { status: "cancelled" }])).toBe("blocked");
    expect(deriveExecutionPlanStatus([{ status: "awaiting_approval" }, { status: "pending" }])).toBe(
      "awaiting_approval",
    );
    expect(deriveExecutionPlanStatus([{ status: "pending" }, { status: "pending" }])).toBe("frozen");
  });

  it("classifies remaining failure classes instead of retrying authority, cost, or strategy stops", () => {
    const escalate = ["authority_limit", "policy_conflict", "cost_limit", "unknown"] as const;
    for (const failureClass of escalate) {
      const outcome = decideExecutionRetry({
        failureClass,
        attemptNumber: 1,
        maxAttempts: 3,
        now: CREATED_AT,
      });
      expect(outcome.decision).toBe("escalate_human");
      expect(outcome.shouldRetry).toBe(false);
      expect(outcome.terminalStepStatus).toBe("blocked");
    }

    const unclassified = decideExecutionRetry({
      failureClass: "not_a_class" as ExecutionFailureClass,
      attemptNumber: 1,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(unclassified.decision).toBe("escalate_human");
    expect(unclassified.shouldRetry).toBe(false);

    const strategy = decideExecutionRetry({
      failureClass: "business_strategy_failure",
      attemptNumber: 1,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(strategy.decision).toBe("replan");
    expect(strategy.shouldRetry).toBe(false);

    const qa = decideExecutionRetry({
      failureClass: "qa_failure",
      attemptNumber: 1,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(qa.decision).toBe("retry_different_executor");
    expect(qa.shouldRetry).toBe(true);

    const evidence = decideExecutionRetry({
      failureClass: "evidence_failure",
      attemptNumber: 1,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(evidence.decision).toBe("retry_different_executor");

    const dependency = decideExecutionRetry({
      failureClass: "external_dependency",
      attemptNumber: 1,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(dependency.decision).toBe("retry_same_executor");
    expect(dependency.shouldRetry).toBe(true);

    const correctable = decideExecutionRetry({
      failureClass: "bad_input",
      attemptNumber: 1,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(correctable.decision).toBe("correct_inputs_then_retry");
    expect(correctable.shouldRetry).toBe(true);

    const exhaustedInput = decideExecutionRetry({
      failureClass: "bad_input",
      attemptNumber: 3,
      maxAttempts: 3,
      now: CREATED_AT,
    });
    expect(exhaustedInput.decision).toBe("escalate_human");
    expect(exhaustedInput.shouldRetry).toBe(false);
    expect(exhaustedInput.terminalStepStatus).toBe("blocked");
  });

  it("caps retry backoff and refuses non-positive attempt numbers", () => {
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(2)).toBe(2000);
    expect(retryDelayMs(3)).toBe(4000);
    expect(retryDelayMs(21)).toBe(900_000);
    expect(() => retryDelayMs(0)).toThrow(/positive integer/);
  });

  it("fails closed on malformed lease credentials and identity swaps", () => {
    const token = "a".repeat(64);
    const lease = {
      attemptId: "attempt-001",
      stepKey: "research",
      workerId: "worker-001",
      leaseTokenHash: token,
      leaseExpiresAt: "2026-09-03T10:05:00.000Z",
    };

    expect(checkExecutionLease(lease, { ...lease, attemptId: "attempt-002" }, CREATED_AT)).toEqual({
      ok: false,
      reason: "lease_identity_mismatch",
    });
    expect(checkExecutionLease(lease, { ...lease, stepKey: "review" }, CREATED_AT)).toEqual({
      ok: false,
      reason: "lease_identity_mismatch",
    });
    expect(checkExecutionLease(lease, { ...lease, attemptId: "" }, CREATED_AT)).toEqual({
      ok: false,
      reason: "invalid_attempt_id",
    });
    expect(checkExecutionLease(lease, { ...lease, stepKey: "bad key" }, CREATED_AT)).toEqual({
      ok: false,
      reason: "invalid_step_key",
    });
    expect(checkExecutionLease(lease, { ...lease, workerId: "" }, CREATED_AT)).toEqual({
      ok: false,
      reason: "invalid_worker_id",
    });
    expect(checkExecutionLease(lease, { ...lease, leaseTokenHash: "NOT-A-HASH" }, CREATED_AT)).toEqual({
      ok: false,
      reason: "invalid_lease_token_hash",
    });
    expect(checkExecutionLease(lease, lease, "not-a-date")).toEqual({
      ok: false,
      reason: "lease_expired",
    });
  });
});
