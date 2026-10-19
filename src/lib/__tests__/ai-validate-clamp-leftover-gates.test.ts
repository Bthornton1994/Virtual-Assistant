import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import {
  validateExecutionPlan,
  validateTriage,
  validatedOrFallback,
} from "@/lib/ai-validate";

const TRIAGE = {
  workstreamSlug: "northline",
  priority: "medium" as const,
  actionClass: "prepare_only" as const,
  riskLevel: "low" as const,
  estimatedEffort: 1,
  automationScore: 10,
  rationale: "Prepare only",
};

const PLAN = {
  summary: "Prepare a brief",
  actionClass: "prepare_only" as const,
  riskLevel: "low" as const,
  steps: [{ title: "Read the brief", detail: "Prepare only", owner: "operator" as const }],
};

describe("AI validate leftover clamp and owner-fallback gates", () => {
  it("clamps leftover triage effort and automation scores instead of persisting executor-chosen bounds", () => {
    expect(validateTriage({ ...TRIAGE, estimatedEffort: -4 }).estimatedEffort).toBe(0);
    expect(validateTriage({ ...TRIAGE, estimatedEffort: "3" }).estimatedEffort).toBe(1);
    expect(validateTriage({ ...TRIAGE, estimatedEffort: Number.POSITIVE_INFINITY }).estimatedEffort).toBe(1);
    expect(validateTriage({ ...TRIAGE, automationScore: 140 }).automationScore).toBe(100);
    expect(validateTriage({ ...TRIAGE, automationScore: -1 }).automationScore).toBe(0);
    expect(validateTriage({ ...TRIAGE, automationScore: Number.NaN }).automationScore).toBe(0);
  });

  it("drops leftover empty plan steps and never lets an unknown owner stay on the plan", () => {
    const plan = validateExecutionPlan({
      summary: 12,
      actionClass: "prepare_only",
      riskLevel: "low",
      steps: [
        { title: "   ", detail: "blank title", owner: "ai" },
        { title: "Read the brief", detail: "Prepare only", owner: "automation" },
        { title: "Ask the customer", detail: "Confirm the deliverable", owner: "customer" },
      ],
    });

    expect(plan.summary).toBe("Managed execution plan");
    expect(plan.steps).toEqual([
      { title: "Read the brief", detail: "Prepare only", owner: "operator" },
      { title: "Ask the customer", detail: "Confirm the deliverable", owner: "customer" },
    ]);
  });

  it("still refuses a leftover plan whose remaining steps have no titles", () => {
    expect(() =>
      validateExecutionPlan({
        ...PLAN,
        steps: [
          { title: "", detail: "blank", owner: "operator" },
          { title: "   ", detail: "padded", owner: "ai" },
          "not-an-object",
        ],
      }),
    ).toThrow(/AI execution plan steps failed validation/);
  });

  it("does not swallow leftover fallbacks that themselves fail validation", () => {
    const invalid = { priority: "nope" };
    expect(() => validatedOrFallback(invalid, validateTriage, invalid as never)).toThrow(DomainError);
    expect(() => validatedOrFallback(invalid, validateTriage, invalid as never)).toThrow(
      /AI triage priority is not a permitted value/,
    );
  });
});
