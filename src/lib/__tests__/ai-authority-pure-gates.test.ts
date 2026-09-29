import { describe, expect, it } from "vitest";
import {
  approvalClassFor,
  approvalCovers,
  ownerForAuthority,
  planRequiresApproval,
  qaCountsForAuthority,
} from "@/lib/ai-authority";

// Pure authority helpers used by both stores. Integration suites already hold
// the write path; these pins keep the helpers themselves from drifting.

describe("qaCountsForAuthority refuses a review from before the covering plan", () => {
  it("accepts any pass when no covering plan decision is dated", () => {
    expect(qaCountsForAuthority({ createdAt: "2000-01-01T00:00:00.000Z" }, null)).toBe(true);
  });

  it("accepts a review recorded at or after the covering plan decision", () => {
    expect(qaCountsForAuthority({ createdAt: "2026-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(qaCountsForAuthority({ createdAt: "2026-01-02T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z")).toBe(true);
  });

  it("rejects a review recorded before the covering plan decision", () => {
    expect(qaCountsForAuthority({ createdAt: "2000-01-01T00:00:00.000Z" }, "2026-01-01T00:00:00.000Z")).toBe(false);
  });
});

describe("approvalCovers: outbound approvals stop at external_execution", () => {
  it("lets an outbound approval given at external_execution cover a sensitive request", () => {
    expect(
      approvalCovers({ kind: "external_email", actionClass: "external_execution" }, { approvalLevel: "sensitive_execution" }),
    ).toBe(true);
    expect(
      approvalCovers({ kind: "vendor_communication", actionClass: "external_execution" }, { approvalLevel: "sensitive_execution" }),
    ).toBe(true);
  });

  it("does not let an outbound approval given at prepare_only cover external work", () => {
    expect(
      approvalCovers({ kind: "external_email", actionClass: "prepare_only" }, { approvalLevel: "external_execution" }),
    ).toBe(false);
    expect(
      approvalCovers({ kind: "crm_destructive_change", actionClass: "prepare_only" }, { approvalLevel: "sensitive_execution" }),
    ).toBe(false);
  });

  it("still requires a plan approval at the request's own class", () => {
    expect(
      approvalCovers({ kind: "execution_plan", actionClass: "external_execution" }, { approvalLevel: "sensitive_execution" }),
    ).toBe(false);
    expect(
      approvalCovers({ kind: "execution_plan", actionClass: "sensitive_execution" }, { approvalLevel: "sensitive_execution" }),
    ).toBe(true);
  });
});

describe("owner and class stamps cannot be lowered below the request", () => {
  it("moves model-owned steps off AI and automation once work is above prepare_only", () => {
    expect(ownerForAuthority("ai", "low_risk_execution")).toBe("operator");
    expect(ownerForAuthority("automation", "sensitive_execution")).toBe("operator");
    expect(ownerForAuthority("ai", "prepare_only")).toBe("ai");
    expect(ownerForAuthority("operator", "sensitive_execution")).toBe("operator");
  });

  it("records the stricter of the approval's class and the request's class", () => {
    expect(approvalClassFor("prepare_only", { approvalLevel: "sensitive_execution" })).toBe("sensitive_execution");
    expect(approvalClassFor("sensitive_execution", { approvalLevel: "prepare_only" })).toBe("sensitive_execution");
    expect(approvalClassFor("prepare_only", { approvalLevel: "prepare_only" })).toBe("prepare_only");
  });

  it("requires a plan approval for external and sensitive work, not for preparation", () => {
    expect(planRequiresApproval("prepare_only")).toBe(false);
    expect(planRequiresApproval("low_risk_execution")).toBe(false);
    expect(planRequiresApproval("external_execution")).toBe(true);
    expect(planRequiresApproval("sensitive_execution")).toBe(true);
  });
});
