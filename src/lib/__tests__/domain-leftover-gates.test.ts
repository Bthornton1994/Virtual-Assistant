import { describe, expect, it } from "vitest";
import {
  AuthzError,
  DomainError,
  assertOrgAccess,
  canAccessOrganization,
  canDecideApproval,
  canExportData,
  canManageTeam,
  canRequestCustomerApproval,
  canWritePlaybook,
  parseApprovalDecision,
  type Actor,
} from "@/lib/domain";

function actor(partial: Partial<Actor> & Pick<Actor, "role">): Actor {
  return {
    id: "usr_x",
    email: "x@example.com",
    name: "X",
    organizationId: "org_northline",
    operatorId: null,
    source: "demo",
    ...partial,
  };
}

describe("domain leftover approval-decision and permission gates", () => {
  it("refuses leftover approval-decision lookalikes instead of recording a decision", () => {
    expect(parseApprovalDecision("approved")).toBe("approved");
    expect(parseApprovalDecision("rejected")).toBe("rejected");

    for (const value of [true, 1, "approved ", "Rejected", "approve", "pending", ""]) {
      expect(() => parseApprovalDecision(value), String(value)).toThrow(DomainError);
      expect(() => parseApprovalDecision(value), String(value)).toThrow(
        /Approve or reject the approval to record a decision/,
      );
    }
  });

  it("keeps leftover client roles inside their own organization", () => {
    const northline = actor({ role: "client_member" });
    const harborAdmin = actor({ role: "client_admin", organizationId: "org_harbor" });

    expect(canAccessOrganization(northline, "org_northline")).toBe(true);
    expect(canAccessOrganization(northline, "org_harbor")).toBe(false);
    expect(canAccessOrganization(harborAdmin, "org_northline")).toBe(false);
    expect(() => assertOrgAccess(harborAdmin, "org_northline")).toThrow(AuthzError);

    expect(canAccessOrganization(actor({ role: "operator" }), "org_harbor")).toBe(true);
    expect(canAccessOrganization(actor({ role: "ops_manager" }), "org_harbor")).toBe(true);
    expect(canAccessOrganization(actor({ role: "platform_admin" }), "org_harbor")).toBe(true);
  });

  it("refuses leftover write and export permissions for roles that cannot own them", () => {
    expect(canDecideApproval(actor({ role: "operator" }))).toBe(false);
    expect(canDecideApproval(actor({ role: "ops_manager" }))).toBe(false);
    expect(canDecideApproval(actor({ role: "client_admin" }))).toBe(true);
    expect(canDecideApproval(actor({ role: "client_member" }))).toBe(true);

    expect(canExportData(actor({ role: "client_member" }))).toBe(false);
    expect(canExportData(actor({ role: "operator" }))).toBe(false);
    expect(canExportData(actor({ role: "client_admin" }))).toBe(true);

    expect(canWritePlaybook(actor({ role: "operator" }))).toBe(false);
    expect(canWritePlaybook(actor({ role: "client_member" }))).toBe(false);
    expect(canWritePlaybook(actor({ role: "client_admin" }))).toBe(true);

    expect(canManageTeam(actor({ role: "client_member" }))).toBe(false);
    expect(canManageTeam(actor({ role: "operator" }))).toBe(false);
    expect(canManageTeam(actor({ role: "client_admin" }))).toBe(true);

    expect(canRequestCustomerApproval(actor({ role: "client_admin" }))).toBe(false);
    expect(canRequestCustomerApproval(actor({ role: "operator" }))).toBe(true);
  });
});
