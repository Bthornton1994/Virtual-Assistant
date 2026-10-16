import { describe, expect, it } from "vitest";
import {
  blockedStepKeys,
  deriveExecutionPlanStatus,
  hashExecutionPlan,
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
    steps: [step()],
    createdAt: CREATED_AT,
    mayOwnAuthoritativeState: false,
    ...overrides,
  };
}

function failuresOf(result: { ok: boolean; failures?: string[] }) {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("execution-runtime leftover binding and secret gates", () => {
  it("refuses nested secret-like dataPolicy keys and plan-level authoritative-state ownership", () => {
    const nestedApiKey = validateExecutionPlan(plan({ dataPolicy: { nested: { api_key: "must-not-be-here" } } }));
    expect(nestedApiKey.ok).toBe(false);
    expect(failuresOf(nestedApiKey)).toMatch(/secret material.*dataPolicy\.nested\.api_key/);

    const password = validateExecutionPlan(plan({ dataPolicy: { password: "must-not-be-here" } }));
    expect(password.ok).toBe(false);
    expect(failuresOf(password)).toMatch(/secret material.*dataPolicy\.password/);

    const privateKey = validateExecutionPlan(plan({ dataPolicy: { private_key: "must-not-be-here" } }));
    expect(privateKey.ok).toBe(false);
    expect(failuresOf(privateKey)).toMatch(/secret material.*dataPolicy\.private_key/);

    const ownsState = validateExecutionPlan(plan({ mayOwnAuthoritativeState: true as false }));
    expect(ownsState.ok).toBe(false);
    expect(failuresOf(ownsState)).toMatch(/mayOwnAuthoritativeState must be false/);
  });

  it("refuses 101 stages, duplicate step keys, unknown dependencies, and a forged plan hash", () => {
    const tooMany = validateExecutionPlan(
      plan({
        steps: Array.from({ length: 101 }, (_, index) =>
          step({
            stepKey: "step-" + (index + 1),
            sequence: index + 1,
            title: "Stage " + (index + 1),
          }),
        ),
      }),
    );
    expect(tooMany.ok).toBe(false);
    expect(failuresOf(tooMany)).toMatch(/steps must contain between 1 and 100 stages/);

    const duplicateKey = validateExecutionPlan(
      plan({
        steps: [
          step(),
          step({
            stepKey: "research",
            sequence: 2,
            title: "Repeated research key",
            capabilityKey: "independent_evidence_review",
          }),
        ],
      }),
    );
    expect(duplicateKey.ok).toBe(false);
    expect(failuresOf(duplicateKey)).toMatch(/Duplicate stepKey: research/);

    const unknownDependency = validateExecutionPlan(
      plan({
        steps: [
          step(),
          step({
            stepKey: "review",
            sequence: 2,
            title: "Independently challenge the brief",
            capabilityKey: "independent_evidence_review",
            dependsOn: ["missing-step"],
          }),
        ],
      }),
    );
    expect(unknownDependency.ok).toBe(false);
    expect(failuresOf(unknownDependency)).toMatch(/depends on unknown step missing-step/);

    const accepted = validateExecutionPlan(plan());
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) throw new Error(accepted.failures.join("; "));
    const forged = validateExecutionPlan(plan({ planHash: "a".repeat(64) }));
    expect(forged.ok).toBe(false);
    expect(failuresOf(forged)).toMatch(/planHash does not match the canonical execution plan/);
    expect(hashExecutionPlan(accepted.value)).toBe(accepted.value.planHash);
  });

  it("blocks descendants of cancelled work and derives failed or awaiting-approval state from the step set", () => {
    const steps = [
      step(),
      step({
        stepKey: "review",
        sequence: 2,
        title: "Independently challenge the brief",
        capabilityKey: "independent_evidence_review",
        dependsOn: ["research"],
      }),
    ];
    expect(blockedStepKeys(steps, { research: "cancelled", review: "pending" })).toEqual(["review"]);
    expect(blockedStepKeys(steps, { research: "blocked", review: "pending" })).toEqual(["review"]);
    expect(blockedStepKeys(steps, { research: "succeeded", review: "pending" })).toEqual([]);

    expect(deriveExecutionPlanStatus([{ status: "succeeded" }, { status: "failed" }])).toBe("failed");
    expect(deriveExecutionPlanStatus([{ status: "awaiting_approval" }, { status: "pending" }])).toBe(
      "awaiting_approval",
    );
    expect(deriveExecutionPlanStatus([{ status: "leased" }, { status: "pending" }])).toBe("running");
  });
});
