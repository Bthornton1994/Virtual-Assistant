import { describe, expect, it } from "vitest";
import {
  ACTION_CLASSES,
  APPROVAL_KINDS,
  AuthzError,
  ROLES,
  REQUEST_STATUSES,
  assertOrgAccess,
  blocksWithoutApproval,
  canAccessOrganization,
  canAssignOperators,
  canDecideApproval,
  canDeliverRequest,
  canExportData,
  canManageTeam,
  canMutateOpsQueue,
  canRequestCustomerApproval,
  canTransition,
  canWritePlaybook,
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
    expect(inferApprovalKind("vendor onboarding packet")).toBe("vendor_communication");
    expect(inferApprovalKind("wire transfer and credential rotation")).toBe("sensitive_action");
    expect(inferApprovalKind("approve the weekly plan")).toBe("execution_plan");
    expect(inferApprovalKind("internal status note")).toBeNull();
    expect(
      identifyMissingContext({
        title: "HubSpot cleanup",
        objective: "Clean the pipeline",
        description: "Please clean stale deals in the pipeline and attach the export we discussed last week.",
        deliverable: "Updated deal list",
      }),
    ).toEqual(
      expect.arrayContaining([
        "Which CRM and which records or pipeline views should we use?",
        "Attach the source file or export this request refers to.",
      ]),
    );
  });

  it("keeps tenant and approval permissions explicit", () => {
    const client = actor({ role: "client_member", organizationId: "org_northline" });
    const otherClient = actor({ role: "client_admin", organizationId: "org_harbor" });
    const operator = actor({ role: "operator", operatorId: "op_maya" });
    const manager = actor({ role: "ops_manager" });
    const admin = actor({ role: "platform_admin" });

    expect(canAccessOrganization(client, "org_northline")).toBe(true);
    expect(canAccessOrganization(client, "org_harbor")).toBe(false);
    expect(canAccessOrganization(otherClient, "org_northline")).toBe(false);
    expect(canAccessOrganization(operator, "org_harbor")).toBe(true);
    expect(canAccessOrganization(manager, "org_harbor")).toBe(true);
    expect(canAccessOrganization(admin, "org_northline")).toBe(true);
    expect(() => assertOrgAccess(client, "org_harbor")).toThrow(AuthzError);
    expect(() => assertOrgAccess(client, "org_northline")).not.toThrow();

    expect(canDecideApproval(client)).toBe(true);
    expect(canDecideApproval(otherClient)).toBe(true);
    expect(canDecideApproval(operator)).toBe(false);
    expect(canDecideApproval(manager)).toBe(false);
    expect(canRequestCustomerApproval(operator)).toBe(true);
    expect(canRequestCustomerApproval(client)).toBe(false);

    expect(canManageTeam(otherClient)).toBe(true);
    expect(canManageTeam(client)).toBe(false);
    expect(canExportData(otherClient)).toBe(true);
    expect(canExportData(client)).toBe(false);
    expect(canWritePlaybook(otherClient)).toBe(true);
    expect(canWritePlaybook(client)).toBe(false);
    expect(canWritePlaybook(manager)).toBe(true);
    expect(canAssignOperators(manager)).toBe(true);
    expect(canAssignOperators(operator)).toBe(false);
    expect(canMutateOpsQueue(client)).toBe(false);
    expect(canMutateOpsQueue(operator)).toBe(true);
  });

  it("does not allow jumping from awaiting approval or delivered into skipped QA states", () => {
    expect(canTransition("awaiting_action_approval", "delivered")).toBe(false);
    expect(canTransition("awaiting_action_approval", "ready_to_deliver")).toBe(false);
    expect(canTransition("delivered", "accepted")).toBe(true);
    expect(canTransition("accepted", "in_progress")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
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
});
