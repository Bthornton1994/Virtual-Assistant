import { describe, expect, it } from "vitest";
import { mockAI } from "@/lib/ai";

describe("AI abstraction (deterministic mock)", () => {
  it("classifies payment language as sensitive", async () => {
    const risk = await mockAI.classifyRisk({
      title: "Wire the vendor",
      description: "Transfer funds to the research vendor today",
      externalCommunication: false,
    });
    expect(risk.actionClass).toBe("sensitive_execution");
    expect(risk.riskLevel).toBe("critical");
  });

  it("never routes sensitive work to unsupervised AI", async () => {
    const route = await mockAI.suggestRouting({
      actionClass: "sensitive_execution",
      title: "Pay vendor",
    });
    expect(route.humanRequired).toBe(true);
    expect(route.executor).toBe("specialist");
  });

  it("exposes the full provider-agnostic surface with deterministic fallbacks", async () => {
    const missing = await mockAI.identifyMissingContext({
      title: "x",
      objective: "x",
      description: "short",
      deliverable: "",
    });
    expect(missing.missing.length).toBeGreaterThan(0);
    const ws = await mockAI.classifyWorkstream({
      title: "Follow up conference leads",
      objective: "Every lead has an owner",
      description: "Inspect CRM and identify unassigned leads",
    });
    expect(ws.workstreamSlug).toBe("sales-operations");
    const reqs = await mockAI.determineApprovalRequirements({
      title: "Send follow-up emails",
      description: "Outreach to conference leads",
      actionClass: "external_execution",
      externalCommunication: true,
    });
    expect(reqs.kinds).toContain("execution_plan");
    expect(reqs.kinds).toContain("external_email");
    const auto = await mockAI.identifyAutomationOpportunity({
      title: "Daily inbox",
      actionClass: "prepare_only",
      recurring: true,
    });
    expect(auto.requiresHumanApproval).toBe(true);
    const summary = await mockAI.summarizeOutcome({
      title: "Conference follow-up",
      deliverable: "Follow-up pack",
      actionsTaken: ["Drafted emails"],
      exceptions: ["Two duplicates"],
      nextStep: "Capture playbook",
    });
    expect(summary.summary).toMatch(/Follow-up pack/);
    const exec = await mockAI.suggestExecutor({
      actionClass: "sensitive_execution",
      title: "Pay vendor",
    });
    expect(exec.humanRequired).toBe(true);
    expect(exec.executor).not.toBe("ai");
  });

  it("builds an execution plan with a customer approval step when needed", async () => {
    const plan = await mockAI.generateExecutionPlan({
      title: "Send client email",
      objective: "Follow up",
      description: "Email the client",
      deliverable: "Sent email",
      actionClass: "external_execution",
    });
    expect(plan.approvalsRequired).toBe(true);
    expect(plan.steps.some((s) => s.owner === "customer")).toBe(true);
  });

  it("requires a CRM-destructive approval object when HubSpot merge/delete language is present", async () => {
    const reqs = await mockAI.determineApprovalRequirements({
      title: "HubSpot delete merged contacts",
      description: "Remove duplicate records after the import.",
      actionClass: "low_risk_execution",
      externalCommunication: false,
    });
    expect(reqs.kinds).toEqual(["execution_plan", "crm_destructive_change"]);
    expect(reqs.requiresCustomerDecision).toBe(true);
  });

  it("requires vendor communication approval only when outbound is flagged", async () => {
    const outbound = await mockAI.determineApprovalRequirements({
      title: "Vendor quote",
      description: "Ask the vendor for pricing.",
      actionClass: "external_execution",
      externalCommunication: true,
    });
    expect(outbound.kinds).toEqual(["execution_plan", "external_email", "vendor_communication"]);

    const internal = await mockAI.determineApprovalRequirements({
      title: "Vendor quote",
      description: "Compare internal vendor notes.",
      actionClass: "prepare_only",
      externalCommunication: false,
    });
    expect(internal.kinds).toEqual(["execution_plan"]);
  });

  it("always adds sensitive_action for sensitive execution and otherwise keeps only the plan", async () => {
    const sensitive = await mockAI.determineApprovalRequirements({
      title: "Assemble payment pack",
      description: "Compile the invoice. Do not transfer funds.",
      actionClass: "sensitive_execution",
      externalCommunication: false,
    });
    expect(sensitive.kinds).toEqual(["execution_plan", "sensitive_action"]);

    const prepare = await mockAI.determineApprovalRequirements({
      title: "Organize files",
      description: "File the Q3 notes.",
      actionClass: "prepare_only",
      externalCommunication: false,
    });
    expect(prepare.kinds).toEqual(["execution_plan"]);
  });

  it("elevates prepare language to external execution when outbound is flagged", async () => {
    const risk = await mockAI.classifyRisk({
      title: "Draft a research brief",
      description: "Research only. Prepare a sourced brief.",
      externalCommunication: true,
    });
    expect(risk.actionClass).toBe("external_execution");
    expect(risk.riskLevel).toBe("high");
  });
});
