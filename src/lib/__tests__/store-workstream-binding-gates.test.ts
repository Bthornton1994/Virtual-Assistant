import { describe, expect, it } from "vitest";
import { AuthzError, DomainError } from "@/lib/domain";
import { MemoryStore, seedData } from "@/lib/store";

function actors(store: MemoryStore) {
  return {
    founder: store.actorFromUser("usr_founder")!,
    teammate: store.actorFromUser("usr_teammate")!,
    manager: store.actorFromUser("usr_manager")!,
  };
}

function seedHarborBindings(store: MemoryStore) {
  store.data.workstreams.push({
    id: "ws_harbor",
    organizationId: "org_harbor",
    templateId: "tpl_sales",
    name: "Harbor sales",
    objective: "Harbor only",
    sla: "Same day",
    recurringTasks: [],
    metrics: [],
    ownerUserId: "usr_teammate",
    status: "active",
    healthScore: 50,
    hoursReturned: 0,
    schedule: null,
    nextRunAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
  store.data.playbooks.push({
    id: "pb_harbor",
    organizationId: "org_harbor",
    title: "Harbor only",
    objective: "Internal Harbor playbook",
    workstreamId: "ws_harbor",
    currentVersion: 1,
    createdBy: "usr_teammate",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  });
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

describe("workstream and playbook tenant binding", () => {
  it("refuses a Harbor workstream on a Northline intake and creates no request", async () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    seedHarborBindings(store);
    const before = store.data.requests.length;

    await expect(store.createRequest(founder, { ...completeIntake, workstreamId: "ws_harbor" })).rejects.toThrow(
      AuthzError,
    );
    expect(store.data.requests).toHaveLength(before);
    expect(store.data.requests.some((row) => row.title === completeIntake.title)).toBe(false);
    expect(
      store.data.requests.some((row) => row.organizationId === "org_northline" && row.workstreamId === "ws_harbor"),
    ).toBe(false);
  });

  it("still binds a Northline workstream on a Northline intake", async () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    seedHarborBindings(store);

    const bundle = await store.createRequest(founder, completeIntake);
    expect(bundle.request.organizationId).toBe("org_northline");
    expect(bundle.request.workstreamId).toBe("ws_research");
  });

  it("refuses a Harbor workstream or playbook on a Northline scope update", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    seedHarborBindings(store);

    expect(() => store.updateRequestScope(founder, "req_inbox", { workstreamId: "ws_harbor" })).toThrow(AuthzError);
    expect(() => store.updateRequestScope(founder, "req_inbox", { playbookId: "pb_harbor" })).toThrow(AuthzError);
    expect(() => store.updateRequestScope(founder, "req_inbox", { workstreamId: "ws_missing" })).toThrow(DomainError);
    expect(() => store.updateRequestScope(founder, "req_inbox", { playbookId: "pb_missing" })).toThrow(DomainError);

    const req = store.getRequest(founder, "req_inbox");
    expect(req.workstreamId).toBe("ws_inbox");
    expect(req.playbookId).toBeNull();
  });

  it("lets a client rebind a request to another workstream in the same organization", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    seedHarborBindings(store);

    const updated = store.updateRequestScope(founder, "req_inbox", { workstreamId: "ws_sales", playbookId: "pb_proposal" });
    expect(updated.organizationId).toBe("org_northline");
    expect(updated.workstreamId).toBe("ws_sales");
    expect(updated.playbookId).toBe("pb_proposal");
  });

  it("refuses a Harbor workstream on a Northline playbook and keeps ops Harbor writes in Harbor", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate, manager } = actors(store);
    seedHarborBindings(store);
    const before = store.data.playbooks.length;

    expect(() =>
      store.createPlaybook(founder, {
        title: "Northline should not own Harbor sales",
        objective: "Bind Harbor work",
        workstreamId: "ws_harbor",
        steps: ["Draft"],
        preferences: [],
        warnings: [],
      }),
    ).toThrow(AuthzError);
    expect(() =>
      store.createPlaybook(teammate, {
        title: "Member cannot publish",
        objective: "x",
        workstreamId: "ws_harbor",
        steps: ["Draft"],
        preferences: [],
        warnings: [],
      }),
    ).toThrow(AuthzError);
    expect(store.data.playbooks).toHaveLength(before);

    const northline = store.createPlaybook(founder, {
      title: "Northline inbox pack",
      objective: "Draft only",
      workstreamId: "ws_inbox",
      steps: ["Triage"],
      preferences: [],
      warnings: [],
    });
    expect(northline.organizationId).toBe("org_northline");
    expect(northline.workstreamId).toBe("ws_inbox");

    const harbor = store.createPlaybook(manager, {
      title: "Harbor sales pack",
      objective: "Harbor only",
      workstreamId: "ws_harbor",
      steps: ["Triage"],
      preferences: [],
      warnings: [],
    });
    expect(harbor.organizationId).toBe("org_harbor");
    expect(harbor.workstreamId).toBe("ws_harbor");
  });

  it("fails closed on a missing playbook and keeps Harbor playbooks off Northline reads", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);
    seedHarborBindings(store);

    expect(() => store.getPlaybook(founder, "pb_missing")).toThrow(DomainError);
    expect(() => store.getPlaybook(founder, "pb_harbor")).toThrow(AuthzError);
    expect(store.getPlaybook(manager, "pb_harbor").playbook.organizationId).toBe("org_harbor");
    expect(store.getPlaybook(founder, "pb_inbox").playbook.organizationId).toBe("org_northline");
  });
});
