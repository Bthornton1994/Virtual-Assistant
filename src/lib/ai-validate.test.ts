import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import { mockAI } from "@/lib/ai";
import {
  validateApprovalRequirement,
  validateAutomation,
  validateExecutionPlan,
  validateMissingContext,
  validatePlaybookDraft,
  validateQaResult,
  validateRouting,
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
    const reqs = validateApprovalRequirement({ kinds: ["external_email"], reasons: ["Outbound"], requiresCustomerDecision: true });
    expect(reqs.kinds[0]).toBe("execution_plan");
    expect(reqs.kinds).toContain("external_email");
  });

  it("rejects an empty playbook draft", () => {
    expect(() => validatePlaybookDraft({ title: "", steps: [] })).toThrow(DomainError);
  });

  it("rejects an unknown routing executor instead of persisting it", () => {
    expect(() => validateRouting({ executor: "hacker", reason: "bypass" })).toThrow(DomainError);
    expect(() => validateRouting(null)).toThrow(DomainError);
    const routing = validateRouting({
      executor: "operator",
      skillHints: ["inbox", 12, ""],
      reason: "Needs judgment",
      humanRequired: false,
    });
    expect(routing.executor).toBe("operator");
    expect(routing.skillHints).toEqual(["inbox"]);
    expect(routing.humanRequired).toBe(false);
  });

  it("coerces QA scores into a 0-100 bound and rejects non-objects", () => {
    expect(() => validateQaResult("passed")).toThrow(DomainError);
    const high = validateQaResult({ passed: "yes", score: 200, checklist: [{ item: "Sources", ok: true }, "skip"] });
    expect(high.passed).toBe(false);
    expect(high.score).toBe(100);
    expect(high.checklist).toEqual([{ item: "Sources", ok: true }]);
    const low = validateQaResult({ passed: true, score: -4, residualRisk: "Unverified quotes" });
    expect(low.passed).toBe(true);
    expect(low.score).toBe(0);
    expect(low.residualRisk).toBe("Unverified quotes");
  });

  it("rejects missing-context payloads that are not objects and drops empty strings", () => {
    expect(() => validateMissingContext(null)).toThrow(DomainError);
    expect(validateMissingContext({ missing: ["Need the VIP list", "", 12] }).missing).toEqual(["Need the VIP list"]);
  });

  it("rejects an illegal triage enum instead of saving it", () => {
    expect(() =>
      validateTriage({
        workstreamSlug: "inbox-operations",
        priority: "nope",
        actionClass: "prepare_only",
        riskLevel: "low",
      }),
    ).toThrow(DomainError);
  });

  it("never lets automation output clear the human-approval requirement", () => {
    const opportunity = validateAutomation({ candidate: true, step: "Send email", reason: "Cheap", requiresHumanApproval: false });
    expect(opportunity.requiresHumanApproval).toBe(true);
    expect(opportunity.step).toBe("Send email");
    expect(() => validateAutomation(undefined)).toThrow(DomainError);
  });
});
