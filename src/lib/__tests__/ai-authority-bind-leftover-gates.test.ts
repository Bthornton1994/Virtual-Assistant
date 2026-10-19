import { describe, expect, it } from "vitest";
import { bindPlanToAuthority, restrictModelStepOwners } from "@/lib/ai-authority";
import type { ExecutionPlan } from "@/lib/domain";

const HOSTILE_PLAN: ExecutionPlan = {
  summary: "Just do it.",
  actionClass: "prepare_only",
  riskLevel: "low",
  steps: [{ title: "Send the wire", detail: "Execute the transfer", owner: "ai" }],
  approvalsRequired: false,
  automationCandidates: ["Everything"],
  humanOwned: [],
};

const MIXED_OWNERS = {
  steps: [
    { title: "Draft", owner: "ai" },
    { title: "Automate", owner: "automation" },
    { title: "Ask", owner: "customer" },
    { title: "Review", owner: "specialist" },
    { title: "Own", owner: "operator" },
  ],
};

describe("AI authority leftover plan-bind gates", () => {
  it("does not let a leftover plan lower class, skip approval, or drop below the request risk floor", () => {
    const bound = bindPlanToAuthority(HOSTILE_PLAN, {
      actionClass: "external_execution",
      riskLevel: "high",
    });
    expect(bound.actionClass).toBe("external_execution");
    expect(bound.riskLevel).toBe("high");
    expect(bound.approvalsRequired).toBe(true);
    expect(bound.summary).toBe(HOSTILE_PLAN.summary);
  });

  it("does not let a leftover plan raise its own action class above the request", () => {
    const bound = bindPlanToAuthority(
      { ...HOSTILE_PLAN, actionClass: "sensitive_execution", riskLevel: "critical", approvalsRequired: true },
      { actionClass: "prepare_only", riskLevel: "low" },
    );
    expect(bound.actionClass).toBe("prepare_only");
    expect(bound.riskLevel).toBe("critical");
    expect(bound.approvalsRequired).toBe(true);
  });

  it("keeps leftover model-owned steps with an operator on leftover non-prepare classes", () => {
    expect(restrictModelStepOwners(MIXED_OWNERS, "external_execution").steps.map((step) => step.owner)).toEqual([
      "operator",
      "operator",
      "customer",
      "specialist",
      "operator",
    ]);
    expect(restrictModelStepOwners(MIXED_OWNERS, "low_risk_execution").steps.map((step) => step.owner)).toEqual([
      "operator",
      "operator",
      "customer",
      "specialist",
      "operator",
    ]);
    expect(restrictModelStepOwners(MIXED_OWNERS, "prepare_only").steps.map((step) => step.owner)).toEqual([
      "ai",
      "automation",
      "customer",
      "specialist",
      "operator",
    ]);
  });

  it("does not rewrite leftover non-object plans", () => {
    expect(restrictModelStepOwners("not-a-plan", "external_execution")).toBe("not-a-plan");
    expect(restrictModelStepOwners({ steps: "nope" }, "sensitive_execution")).toEqual({ steps: "nope" });
  });
});
