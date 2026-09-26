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
    const route = await mockAI.suggestExecutor({
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
});
