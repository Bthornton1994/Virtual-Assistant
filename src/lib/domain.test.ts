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
  canDeliverRequest,
  canExportData,
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
    expect(inferApprovalKind("Contact the vendor about the invoice")).toBe("vendor_communication");
    expect(inferApprovalKind("Wire payment and rotate credentials")).toBe("sensitive_action");
    expect(inferApprovalKind("Approve the execution plan")).toBe("execution_plan");
    expect(inferApprovalKind("Organize the working files")).toBeNull();
  });

  it("asks for CRM identity and source files only when those signals are present", () => {
    const longContext = "Prepare a sourced pack using the authorized systems and the named records.";
    expect(
      identifyMissingContext({
        title: "CRM cleanup",
        objective: "Hygiene",
        description: longContext,
        deliverable: "Hygiene log",
      }),
    ).toContain("Which CRM and which records or pipeline views should we use?");
    expect(
      identifyMissingContext({
        title: "CRM cleanup",
        objective: "Hygiene",
        description: `${longContext} Use the HubSpot view.`,
        deliverable: "Hygiene log",
      }),
    ).toEqual([]);
    expect(
      identifyMissingContext({
        title: "Attach the export",
        objective: "Import",
        description: longContext,
        deliverable: "Cleaned sheet",
      }),
    ).toContain("Attach the source file or export this request refers to.");
    expect(
      identifyMissingContext({
        title: "Attach the export",
        objective: "Import",
        description: longContext,
        deliverable: "Cleaned sheet",
        files: ["leads.csv"],
      }),
    ).toEqual([]);
  });

  it("keeps tenant, playbook, export, and assignment gates on the right roles", () => {
    const founder = actor({ role: "client_admin", organizationId: "org_northline" });
    const teammate = actor({ role: "client_member", organizationId: "org_northline" });
    const operator = actor({ role: "operator", operatorId: "op_maya" });
    const manager = actor({ role: "ops_manager" });
    const admin = actor({ role: "platform_admin" });

    expect(canAccessOrganization(founder, "org_northline")).toBe(true);
    expect(canAccessOrganization(founder, "org_harbor")).toBe(false);
    expect(canAccessOrganization(operator, "org_harbor")).toBe(true);
    expect(canAccessOrganization(manager, "org_harbor")).toBe(true);
    expect(() => assertOrgAccess(teammate, "org_harbor")).toThrow(AuthzError);

    expect(canWritePlaybook(founder)).toBe(true);
    expect(canWritePlaybook(manager)).toBe(true);
    expect(canWritePlaybook(teammate)).toBe(false);
    expect(canWritePlaybook(operator)).toBe(false);

    expect(canExportData(founder)).toBe(true);
    expect(canExportData(admin)).toBe(true);
    expect(canExportData(teammate)).toBe(false);
    expect(canExportData(manager)).toBe(false);

    expect(canAssignOperators(manager)).toBe(true);
    expect(canAssignOperators(admin)).toBe(true);
    expect(canAssignOperators(operator)).toBe(false);
    expect(canAssignOperators(founder)).toBe(false);
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
