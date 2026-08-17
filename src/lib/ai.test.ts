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
