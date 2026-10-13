import { describe, expect, it } from "vitest";
import {
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

describe("execution-runtime leftover plan shape gates", () => {
  it("refuses a non-object plan, a wrong schema version, and empty or padded identity", () => {
    expect(failuresOf(validateExecutionPlan(null))).toMatch(/must be an object/);
    expect(failuresOf(validateExecutionPlan(plan({ schemaVersion: "execution-runtime/v0" as "execution-runtime/v1" })))).toMatch(
      /schemaVersion must be execution-runtime\/v1/,
    );
    expect(failuresOf(validateExecutionPlan(plan({ planId: " plan-001 " })))).toMatch(/planId must be a bounded identifier/);
    expect(failuresOf(validateExecutionPlan(plan({ organizationId: "org-001 " })))).toMatch(
      /organizationId must be a bounded identifier/,
    );
    expect(failuresOf(validateExecutionPlan(plan({ objective: "   " })))).toMatch(/objective must be a non-empty string/);
    expect(failuresOf(validateExecutionPlan(plan({ authorityClass: "owner_override" as "prepare_only" })))).toMatch(
      /authorityClass is invalid/,
    );
    expect(failuresOf(validateExecutionPlan(plan({ dataPolicy: "public" as unknown as Record<string, unknown> })))).toMatch(
      /dataPolicy must be an object/,
    );
    expect(failuresOf(validateExecutionPlan(plan({ planVersion: 0 })))).toMatch(/planVersion must be an integer from 1 through 1000/);
    expect(failuresOf(validateExecutionPlan(plan({ createdAt: "not-a-date" })))).toMatch(/createdAt must be an ISO-compatible date/);
  });

  it("refuses empty stages, non-object steps, duplicate sequences, and leftover attempt bounds", () => {
    expect(failuresOf(validateExecutionPlan(plan({ steps: [] })))).toMatch(/steps must contain between 1 and 100 stages/);
    expect(failuresOf(validateExecutionPlan(plan({ steps: ["research"] as unknown as ExecutionPlanStep[] })))).toMatch(
      /steps\[0\] must be an object/,
    );
    expect(failuresOf(validateExecutionPlan(plan({ steps: [step({ title: "   " })] })))).toMatch(
      /title must be a non-empty string of at most 240 characters/,
    );
    expect(failuresOf(validateExecutionPlan(plan({ steps: [step({ sequence: 0 })] })))).toMatch(
      /sequence must be a positive integer/,
    );
    expect(
      failuresOf(
        validateExecutionPlan(
          plan({
            steps: [
              step(),
              step({ stepKey: "review", sequence: 1, title: "Same sequence as research" }),
            ],
          }),
        ),
      ),
    ).toMatch(/Duplicate step sequence: 1/);
    expect(failuresOf(validateExecutionPlan(plan({ steps: [step({ maxAttempts: 0 })] })))).toMatch(
      /maxAttempts must be an integer from 1 through 10/,
    );
    expect(failuresOf(validateExecutionPlan(plan({ steps: [step({ maxAttempts: 11 })] })))).toMatch(
      /maxAttempts must be an integer from 1 through 10/,
    );
    expect(
      failuresOf(
        validateExecutionPlan(
          plan({
            steps: [
              step(),
              step({
                stepKey: "review",
                sequence: 2,
                dependsOn: ["research", "research"],
                title: "Independently challenge the brief",
                capabilityKey: "independent_evidence_review",
              }),
            ],
          }),
        ),
      ),
    ).toMatch(/dependsOn must not contain duplicates/);
  });

  it("refuses an uppercase plan hash instead of treating it as a matching digest", () => {
    const uppercase = validateExecutionPlan(plan({ planHash: "B".repeat(64) }));
    expect(uppercase.ok).toBe(false);
    expect(failuresOf(uppercase)).toMatch(/planHash must be a lowercase SHA-256 hex string/);
  });
});
