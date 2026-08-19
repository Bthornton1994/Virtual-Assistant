import { describe, expect, it } from "vitest";
import {
  ACTION_CLASSES,
  APPROVAL_KINDS,
  ROLES,
  REQUEST_STATUSES,
  blocksWithoutApproval,
  canDeliverRequest,
  canProvisionCustomer,
  canTransition,
  identifyMissingContext,
  inferApprovalKind,
  requiresExplicitApproval,
  type Actor,
} from "@/lib/domain";

function actor(partial: Partial<Actor> & Pick<Actor, "role">): Actor {
  return {
    id: "usr_x",
    email: "x@example.com",
    name: "X",
    organizationId: null,
    operatorId: null,
    source: "demo",
    ...partial,
  };
}

describe("domain contracts", () => {
  it("includes every product role", () => {
    expect(ROLES).toEqual([
      "client_admin",
      "client_member",
      "operator",
      "ops_manager",
      "platform_admin",
    ]);
  });

  it("includes the full request lifecycle", () => {
    expect(REQUEST_STATUSES).toEqual([
      "draft",
      "triage",
      "needs_clarification",
      "awaiting_plan_approval",
      "queued",
      "assigned",
      "in_progress",
      "blocked",
      "qa",
      "revision_required",
      "awaiting_action_approval",
      "ready_to_deliver",
      "delivered",
      "accepted",
      "cancelled",
    ]);
  });

  it("treats sensitive execution as a hard approval gate", () => {
    expect(blocksWithoutApproval("sensitive_execution")).toBe(true);
    expect(blocksWithoutApproval("prepare_only")).toBe(false);
    expect(requiresExplicitApproval("external_execution")).toBe(true);
    expect(ACTION_CLASSES).toHaveLength(4);
    expect(APPROVAL_KINDS).toContain("execution_plan");
    expect(APPROVAL_KINDS).toContain("sensitive_action");
  });

  it("does not allow skipping QA on the way to accepted", () => {
    expect(canTransition("in_progress", "accepted")).toBe(false);
    expect(canTransition("queued", "delivered")).toBe(false);
    expect(canTransition("ready_to_deliver", "delivered")).toBe(true);
    expect(canTransition("qa", "ready_to_deliver")).toBe(true);
    expect(canTransition("qa", "revision_required")).toBe(true);
  });

  it("identifies missing context and maps approval kinds", () => {
    expect(
      identifyMissingContext({
        title: "Help",
        objective: "x",
        description: "short",
        deliverable: "",
      }).length,
    ).toBeGreaterThan(0);
    expect(
      identifyMissingContext({
        title: "Help",
        objective: "x",
        description: "short",
        deliverable: "",
        playbookApplied: true,
      }),
    ).toEqual([]);
    expect(inferApprovalKind("Send follow-up email to the champion")).toBe("external_email");
    expect(inferApprovalKind("CRM overwrite of closed deals")).toBe("crm_destructive_change");
  });

  it("authorizes delivery only for managers, platform admins, and the assigned operator", () => {
    const assigned = { assignedOperatorId: "op_maya" };
    const unassigned = { assignedOperatorId: null };
    expect(canDeliverRequest(actor({ role: "platform_admin" }), assigned)).toBe(true);
    expect(canDeliverRequest(actor({ role: "ops_manager" }), assigned)).toBe(true);
    expect(canDeliverRequest(actor({ role: "ops_manager" }), unassigned)).toBe(true);
    expect(canDeliverRequest(actor({ role: "operator", operatorId: "op_maya" }), assigned)).toBe(true);
    expect(canDeliverRequest(actor({ role: "operator", operatorId: "op_julian" }), assigned)).toBe(false);
    expect(canDeliverRequest(actor({ role: "operator", operatorId: "op_maya" }), unassigned)).toBe(false);
    expect(canDeliverRequest(actor({ role: "operator", operatorId: null }), assigned)).toBe(false);
    expect(canDeliverRequest(actor({ role: "client_admin", organizationId: "org_northline" }), assigned)).toBe(false);
    expect(canDeliverRequest(actor({ role: "client_member", organizationId: "org_northline" }), assigned)).toBe(false);
  });

  it("lets only ops managers and platform admins provision customers", () => {
    expect(canProvisionCustomer(actor({ role: "platform_admin" }))).toBe(true);
    expect(canProvisionCustomer(actor({ role: "ops_manager" }))).toBe(true);
    expect(canProvisionCustomer(actor({ role: "operator", operatorId: "op_maya" }))).toBe(false);
    expect(canProvisionCustomer(actor({ role: "client_admin", organizationId: "org_northline" }))).toBe(false);
    expect(canProvisionCustomer(actor({ role: "client_member", organizationId: "org_northline" }))).toBe(false);
  });
});
