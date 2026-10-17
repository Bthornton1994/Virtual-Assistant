import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import {
  validateExecutionPlan,
  validateMissingContext,
  validateTriage,
} from "@/lib/ai-validate";

describe("AI validate leftover fail-closed gates", () => {
  it("refuses an unknown plan action class or risk instead of persisting executor-chosen authority", () => {
    const base = {
      summary: "Prepare a brief",
      actionClass: "prepare_only",
      riskLevel: "low",
      steps: [{ title: "Read the brief", detail: "Prepare only", owner: "operator" }],
    };

    expect(() => validateExecutionPlan({ ...base, actionClass: "owner_override" })).toThrow(DomainError);
    expect(() => validateExecutionPlan({ ...base, actionClass: "owner_override" })).toThrow(
      /AI plan action class is not a permitted value/,
    );
    expect(() => validateExecutionPlan({ ...base, riskLevel: "none" })).toThrow(
      /AI plan risk is not a permitted value/,
    );
    expect(() => validateExecutionPlan("not-an-object")).toThrow(/AI execution plan failed validation/);
  });

  it("refuses an unknown triage priority, an unknown triage action class, and a blank workstream", () => {
    const base = {
      workstreamSlug: "northline",
      priority: "medium",
      actionClass: "prepare_only",
      riskLevel: "low",
      estimatedEffort: 1,
      automationScore: 10,
      rationale: "Prepare only",
    };

    expect(() => validateTriage({ ...base, priority: "critical" })).toThrow(
      /AI triage priority is not a permitted value/,
    );
    expect(() => validateTriage({ ...base, actionClass: "banana" })).toThrow(
      /AI triage action class is not a permitted value/,
    );
    expect(() => validateTriage({ ...base, workstreamSlug: "   " })).toThrow(/AI triage workstream failed validation/);
    expect(() => validateTriage(null)).toThrow(/AI triage failed validation/);
  });

  it("refuses a non-object missing-context payload instead of treating it as empty", () => {
    expect(() => validateMissingContext("all good")).toThrow(/AI missing-context failed validation/);
    expect(() => validateMissingContext(["need the brand"])).toThrow(/AI missing-context failed validation/);
    expect(validateMissingContext({ missing: ["need the brand", 12, ""] })).toEqual({
      missing: ["need the brand"],
    });
  });
});
