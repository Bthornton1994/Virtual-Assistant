import { describe, expect, it } from "vitest";
import { AuthzError, DomainError } from "@/lib/domain";
import { MemoryStore, seedData } from "@/lib/store";

function actors(store: MemoryStore) {
  return {
    founder: store.actorFromUser("usr_founder")!,
    teammate: store.actorFromUser("usr_teammate")!,
    operator: store.actorFromUser("usr_op")!,
    manager: store.actorFromUser("usr_manager")!,
    admin: store.actorFromUser("usr_admin")!,
  };
}

const completeIntake = {
  title: "Draft a research brief on boutique firms",
  objective: "A sourced brief the partners can act on",
  description: "Research only. Prepare a sourced brief using public material. Do not contact anyone.",
  deliverable: "PDF brief",
  dueAt: null,
  workstreamId: "ws_research",
  recurring: false,
  externalCommunication: false,
};

describe("intake write gates", () => {
  it("blocks operators and managers from creating requests", async () => {
    const store = new MemoryStore(seedData());
    const { operator, manager } = actors(store);

    await expect(store.createRequest(operator, completeIntake)).rejects.toThrow(AuthzError);
    await expect(store.createRequest(manager, completeIntake)).rejects.toThrow(AuthzError);
    expect(store.data.requests.every((r) => r.title !== completeIntake.title)).toBe(true);
  });

  it("fails closed when a client actor has no organization", async () => {
    const store = new MemoryStore(seedData());
    const founder = { ...store.actorFromUser("usr_founder")!, organizationId: null };

    await expect(store.createRequest(founder, completeIntake)).rejects.toThrow(/No organization/i);
    expect(store.data.requests.filter((r) => r.title === completeIntake.title)).toHaveLength(0);
  });

  it("refuses a Harbor playbook on a Northline intake and keeps attachments tenant-scoped", async () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate } = actors(store);
    store.data.playbooks.push({
      id: "pb_harbor",
      organizationId: "org_harbor",
      title: "Harbor only",
      objective: "Internal Harbor playbook",
      workstreamId: null,
      currentVersion: 1,
      createdBy: "usr_teammate",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await expect(store.createRequest(founder, { ...completeIntake, playbookId: "pb_harbor" })).rejects.toThrow(
      AuthzError,
    );
    expect(store.data.requests.some((r) => r.playbookId === "pb_harbor")).toBe(false);

    const bundle = await store.createRequest(teammate, {
      ...completeIntake,
      files: ["notes.pdf", "leads.csv"],
    });
    expect(bundle.request.organizationId).toBe("org_northline");
    expect(bundle.request.createdBy).toBe(teammate.id);
    expect(bundle.attachments.map((a) => a.path)).toEqual([
      `org_northline/${bundle.request.id}/notes.pdf`,
      `org_northline/${bundle.request.id}/leads.csv`,
    ]);
    expect(bundle.attachments.every((a) => a.organizationId === "org_northline")).toBe(true);
  });
});

describe("lifecycle fail-closed gates", () => {
  it("refuses queued entry until the execution plan is approved", () => {
    const store = new MemoryStore(seedData());
    const { manager, founder } = actors(store);

    expect(store.getRequest(manager, "req_conference").status).toBe("awaiting_plan_approval");
    expect(() => store.transitionRequest(manager, "req_conference", "queued")).toThrow(/execution plan must be approved/i);
    expect(store.getRequest(manager, "req_conference").status).toBe("awaiting_plan_approval");

    store.decideApproval(founder, "ap_conference", "approved", "Prepare the pack. Do not send.");
    expect(store.getRequest(manager, "req_conference").status).toBe("queued");
  });

  it("blocks clients from assigning operators and keeps in-progress work in progress", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate, manager } = actors(store);

    expect(() => store.assignOperator(founder, "req_inbox", "op_julian")).toThrow(AuthzError);
    expect(() => store.assignOperator(teammate, "req_inbox", "op_julian")).toThrow(AuthzError);
    expect(store.getRequest(manager, "req_inbox").assignedOperatorId).toBe("op_maya");

    const brief = store.assignOperator(manager, "req_brief", "op_julian");
    expect(brief.assignedOperatorId).toBe("op_julian");
    expect(brief.status).toBe("in_progress");
  });

  it("blocks clients from recording QA and fails closed on a missing request", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate, manager } = actors(store);

    expect(() =>
      store.createQaReview(founder, "req_proposal", { passed: true, score: 90, notes: "Client QA" }),
    ).toThrow(AuthzError);
    expect(() =>
      store.createQaReview(teammate, "req_proposal", { passed: true, score: 90, notes: "Member QA" }),
    ).toThrow(AuthzError);
    expect(store.getRequest(manager, "req_proposal").status).toBe("qa");
    expect(() => store.getRequest(manager, "req_missing")).toThrow(DomainError);
  });
});

describe("team and list isolation", () => {
  it("blocks operators and managers from inviting members", () => {
    const store = new MemoryStore(seedData());
    const { operator, manager } = actors(store);
    const before = store.data.members.length;

    expect(() =>
      store.inviteMember(operator, { email: "x@northline.demo", name: "X", role: "client_member" }),
    ).toThrow(AuthzError);
    expect(() =>
      store.inviteMember(manager, { email: "y@northline.demo", name: "Y", role: "client_member" }),
    ).toThrow(AuthzError);
    expect(store.data.members).toHaveLength(before);
  });

  it("keeps org lists and members inside the caller's tenant", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);

    expect(store.listOrganizations(founder).map((o) => o.id)).toEqual(["org_northline"]);
    expect(store.listMembers(founder, "org_northline").every((m) => m.organizationId === "org_northline")).toBe(true);
    expect(() => store.listMembers(founder, "org_harbor")).toThrow(AuthzError);
    expect(() => store.getOrganization(founder, "org_harbor")).toThrow(AuthzError);
  });

  it("filters the request list by status, workstream, operator, and remaining deadlines", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = new Date(start.getTime() + 12 * 60 * 60 * 1000).toISOString();
    const laterThisWeek = new Date(start.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const inbox = store.data.requests.find((r) => r.id === "req_inbox")!;
    const brief = store.data.requests.find((r) => r.id === "req_brief")!;
    inbox.dueAt = today;
    brief.dueAt = laterThisWeek;

    expect(store.listRequests(founder, { status: "queued" }).every((r) => r.status === "queued")).toBe(true);
    expect(store.listRequests(founder, { workstreamId: "ws_inbox" }).every((r) => r.workstreamId === "ws_inbox")).toBe(
      true,
    );
    expect(store.listRequests(manager, { operatorId: "op_maya" }).every((r) => r.assignedOperatorId === "op_maya")).toBe(
      true,
    );
    expect(store.listRequests(founder, { deadline: "today" }).some((r) => r.id === "req_inbox")).toBe(true);
    expect(store.listRequests(founder, { deadline: "today" }).some((r) => r.id === "req_brief")).toBe(false);
    expect(store.listRequests(founder, { deadline: "week" }).map((r) => r.id)).toEqual(
      expect.arrayContaining(["req_inbox", "req_brief"]),
    );
    expect(() => store.listRequests(founder, { organizationId: "org_harbor" })).toThrow(AuthzError);
  });
});
