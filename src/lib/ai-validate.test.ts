import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import { mockAI } from "@/lib/ai";
import { resolveApprovalRequirements } from "@/lib/ai-authority";
import {
  validateExecutionPlan,
  validatePlaybookDraft,
  validateTriage,
  validatedOrFallback,
} from "@/lib/ai-validate";

describe("AI output validation", () => {
  it("accepts a complete mock plan", async () => {
    const plan = await mockAI.generateExecutionPlan({
      title: "Draft a brief",
      objective: "Partners can decide",
      description: "Research only",
      deliverable: "PDF",
      actionClass: "prepare_only",
    });
    expect(validateExecutionPlan(plan).steps.length).toBeGreaterThan(0);
  });

  it("rejects an empty plan instead of persisting it", () => {
    expect(() => validateExecutionPlan({ summary: "x", actionClass: "prepare_only", riskLevel: "low", steps: [] })).toThrow(
      DomainError,
    );
  });

  it("falls back to a valid mock when live output is malformed", async () => {
    const fallback = await mockAI.triageRequest({
      title: "Inbox",
      objective: "Triage",
      description: "Draft replies",
      externalCommunication: false,
    });
    const result = validatedOrFallback({ priority: "nope" }, validateTriage, fallback);
    expect(result.priority).toBe(fallback.priority);
  });

  it("always keeps execution_plan in approval kinds", () => {
    const reqs = resolveApprovalRequirements(
      { title: "Update", description: "Status note", actionClass: "prepare_only", externalCommunication: false },
      { kinds: ["external_email"], reasons: ["Outbound"], requiresCustomerDecision: true },
    );
    expect(reqs.kinds[0]).toBe("execution_plan");
    expect(reqs.kinds).toContain("external_email");
  });

  it("rejects an empty playbook draft", () => {
    expect(() => validatePlaybookDraft({ title: "", steps: [] })).toThrow(DomainError);
  });
});
