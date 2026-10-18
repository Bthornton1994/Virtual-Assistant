import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import {
  validateAutomation,
  validatePlaybookDraft,
  validateTriage,
} from "@/lib/ai-validate";

describe("AI validate leftover playbook, automation, and triage-risk gates", () => {
  it("refuses an unknown triage risk instead of persisting an executor-chosen floor", () => {
    const base = {
      workstreamSlug: "northline",
      priority: "medium",
      actionClass: "prepare_only",
      riskLevel: "low",
      estimatedEffort: 1,
      automationScore: 10,
      rationale: "Prepare only",
    };

    expect(() => validateTriage({ ...base, riskLevel: "none" })).toThrow(DomainError);
    expect(() => validateTriage({ ...base, riskLevel: "none" })).toThrow(
      /AI triage risk is not a permitted value/,
    );
    expect(() => validateTriage({ ...base, riskLevel: "CRITICAL" })).toThrow(
      /AI triage risk is not a permitted value/,
    );
  });

  it("refuses leftover playbook drafts that are missing a title, steps, or an object shape", () => {
    expect(() => validatePlaybookDraft({ title: "Vendor brief", steps: ["Read the source"] })).not.toThrow();

    expect(() => validatePlaybookDraft({ title: "Vendor brief", steps: [] })).toThrow(/AI playbook failed validation/);
    expect(() => validatePlaybookDraft({ title: "Vendor brief", steps: ["", 12] })).toThrow(
      /AI playbook failed validation/,
    );
    expect(() => validatePlaybookDraft({ title: "   ", steps: ["Read the source"] })).toThrow(
      /AI playbook failed validation/,
    );
    expect(() => validatePlaybookDraft("not-an-object")).toThrow(/AI playbook failed validation/);
    expect(() => validatePlaybookDraft(null)).toThrow(/AI playbook failed validation/);
  });

  it("refuses a non-object automation payload and never lets a model drop human approval", () => {
    expect(() => validateAutomation("yes")).toThrow(/AI automation failed validation/);
    expect(() => validateAutomation(["automate it"])).toThrow(/AI automation failed validation/);

    const forced = validateAutomation({
      candidate: true,
      step: "Send the vendor email",
      reason: "Safe to automate",
      requiresHumanApproval: false,
    });
    expect(forced.requiresHumanApproval).toBe(true);
    expect(forced.candidate).toBe(true);
    expect(forced.step).toBe("Send the vendor email");
  });
});
