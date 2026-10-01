import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthzError, DomainError, type Actor } from "@/lib/domain";

const supabaseServer = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

import { SupabaseWorkspaceRepository } from "@/lib/data/supabase-workspace";

function actor(overrides: Partial<Actor> & Pick<Actor, "role">): Actor {
  const isClient = overrides.role === "client_admin" || overrides.role === "client_member";
  return {
    id: `usr_${overrides.role}`,
    email: `${overrides.role}@example.com`,
    name: overrides.role,
    organizationId: isClient ? "org_northline" : null,
    operatorId: overrides.role === "operator" ? "op_maya" : null,
    source: "supabase",
    ...overrides,
  };
}

const northlineAdmin = actor({ role: "client_admin" });
const northlineMember = actor({ role: "client_member" });
const operator = actor({ role: "operator" });

const playbookInput = {
  title: "Hijack playbook",
  objective: "Should never persist",
  workstreamId: null,
  steps: ["Draft"],
  preferences: [],
  warnings: [],
};

describe("Supabase workspace pre-database authorization", () => {
  beforeEach(() => {
    supabaseServer.mockReset();
    supabaseServer.mockRejectedValue(new Error("authorization must fail before opening Supabase"));
  });

  it("keeps queue mutations and time/QA writes off customers", async () => {
    const repo = new SupabaseWorkspaceRepository();

    await expect(repo.splitStep(northlineAdmin, "req_prod", "Split")).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.updateStep(northlineMember, "st_prod", { title: "Hijack" })).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.askClarification(northlineAdmin, "req_prod", "Client asking")).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.addInternalNote(northlineMember, "req_prod", "Internal")).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.addTimeEntry(northlineAdmin, "req_prod", 1, "Client hours")).rejects.toBeInstanceOf(AuthzError);
    await expect(
      repo.createQaReview(northlineMember, "req_prod", { passed: true, score: 90, notes: "Client QA" }),
    ).rejects.toBeInstanceOf(AuthzError);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("keeps assignment, plan changes, and approval decisions off ordinary operators", async () => {
    const repo = new SupabaseWorkspaceRepository();

    await expect(repo.assignOperator(operator, "req_prod", "op_julian")).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.decideApproval(operator, "ap_prod", "approved", "Operator deciding")).rejects.toBeInstanceOf(
      AuthzError,
    );
    await expect(repo.modifyPlan(operator, "req_prod", ["Operator rewrite"])).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.answerClarification(operator, "cl_prod", "Operator answering")).rejects.toBeInstanceOf(AuthzError);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("keeps playbook, org, memory, and schedule writes on the right roles", async () => {
    const repo = new SupabaseWorkspaceRepository();

    await expect(repo.createPlaybook(northlineMember, playbookInput)).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.addPlaybookVersion(northlineMember, "pb_prod", playbookInput)).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.generatePlaybookFromRequest(northlineMember, "req_prod")).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.inviteMember(northlineMember, { email: "x@example.com", name: "X", role: "client_member" })).rejects.toBeInstanceOf(
      AuthzError,
    );
    await expect(repo.updateOrganization(northlineMember, "org_northline", { name: "Hijack" })).rejects.toBeInstanceOf(
      AuthzError,
    );
    await expect(
      repo.updateOperatingMemory(northlineMember, "org_northline", { communicationTone: "Hijack" }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(
      repo.setWorkstreamSchedule(northlineMember, "ws_prod", { cadence: "weekly", time: "09:00", tasks: ["Draft"] }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.runWorkstreamSchedule(northlineMember, "ws_prod")).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.exportAudit(northlineMember, "org_northline")).rejects.toBeInstanceOf(AuthzError);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("blocks a client admin from writing another organization's settings or memory", async () => {
    const repo = new SupabaseWorkspaceRepository();

    await expect(repo.updateOrganization(northlineAdmin, "org_harbor", { name: "Hijack" })).rejects.toBeInstanceOf(
      AuthzError,
    );
    await expect(
      repo.updateOperatingMemory(northlineAdmin, "org_harbor", { communicationTone: "Hijack" }),
    ).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.getOperatingMemory(northlineAdmin, "org_harbor")).rejects.toBeInstanceOf(AuthzError);
    await expect(repo.getSubscription(northlineAdmin, "org_harbor")).rejects.toBeInstanceOf(AuthzError);
    expect(supabaseServer).not.toHaveBeenCalled();
  });

  it("never mints a self-serve mock subscription in the production workspace", async () => {
    const repo = new SupabaseWorkspaceRepository();

    await expect(repo.setMockSubscription(northlineAdmin, "growth", 80)).rejects.toBeInstanceOf(DomainError);
    await expect(repo.setMockSubscription(northlineAdmin, "growth", 80)).rejects.toThrow(/not self-serve mock plans/);
    expect(supabaseServer).not.toHaveBeenCalled();
  });
});
