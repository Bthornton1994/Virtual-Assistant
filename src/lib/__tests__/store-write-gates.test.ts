import { describe, expect, it } from "vitest";
import { AuthzError, DomainError } from "@/lib/domain";
import { MemoryStore, seedData } from "@/lib/store";

function actors(store: MemoryStore) {
  return {
    founder: store.actorFromUser("usr_founder")!,
    teammate: store.actorFromUser("usr_teammate")!,
    operator: store.actorFromUser("usr_op")!,
    otherOperator: store.actorFromUser("usr_julian")!,
    manager: store.actorFromUser("usr_manager")!,
  };
}

describe("clarification write gates", () => {
  it("lets ops ask a clarification and blocks clients", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate, manager } = actors(store);

    const row = store.askClarification(manager, "req_inbox", "Which VIP list should we use?");
    expect(row.answer).toBeNull();
    expect(store.getRequest(manager, "req_inbox").status).toBe("needs_clarification");

    expect(() => store.askClarification(founder, "req_inbox", "Client asking")).toThrow(AuthzError);
    expect(() => store.askClarification(teammate, "req_inbox", "Member asking")).toThrow(AuthzError);
  });

  it("keeps the request in needs_clarification until every open question is answered", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);

    const first = store.askClarification(manager, "req_inbox", "First missing fact?");
    const second = store.askClarification(manager, "req_inbox", "Second missing fact?");
    store.answerClarification(founder, first.id, "Answer one");

    expect(store.getRequest(founder, "req_inbox").status).toBe("needs_clarification");
    expect(store.data.clarifications.find((c) => c.id === second.id)?.answer).toBeNull();

    store.answerClarification(founder, second.id, "Answer two");
    expect(store.getRequest(founder, "req_inbox").status).toBe("awaiting_plan_approval");
  });

  it("blocks operators from answering and fails closed on a missing clarification", () => {
    const store = new MemoryStore(seedData());
    const { founder, operator, manager } = actors(store);
    const row = store.askClarification(manager, "req_inbox", "Need a source file");

    expect(() => store.answerClarification(operator, row.id, "Operator answering")).toThrow(AuthzError);
    expect(store.data.clarifications.find((c) => c.id === row.id)?.answer).toBeNull();
    expect(() => store.answerClarification(founder, "cl_missing", "No row")).toThrow(DomainError);
  });

  it("does not let a Northline admin answer a Harbor clarification", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);
    const harbor = store.askClarification(manager, "req_harbor", "Which Harbor pipeline?");

    expect(() => store.answerClarification(founder, harbor.id, "Northline answering Harbor")).toThrow(AuthzError);
    expect(store.data.clarifications.find((c) => c.id === harbor.id)?.answer).toBeNull();
    expect(store.getRequest(manager, "req_harbor").status).toBe("needs_clarification");
  });
});

describe("time entry write gates", () => {
  it("lets ops record hours on a visible request and updates actual effort", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    const before = store.getRequest(manager, "req_inbox").actualEffort;

    const entry = store.addTimeEntry(manager, "req_inbox", 1.5, "Draft pack");
    expect(entry.hours).toBe(1.5);
    expect(entry.organizationId).toBe("org_northline");
    expect(store.getRequest(manager, "req_inbox").actualEffort).toBe(Number((before + 1.5).toFixed(2)));
  });

  it("blocks clients and unassigned operators from writing time", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate, operator } = actors(store);

    expect(() => store.addTimeEntry(founder, "req_inbox", 1, "Client hours")).toThrow(AuthzError);
    expect(() => store.addTimeEntry(teammate, "req_inbox", 1, "Member hours")).toThrow(AuthzError);
    expect(() => store.addTimeEntry(operator, "req_harbor", 1, "Maya on Julian's Harbor row")).toThrow(AuthzError);
    expect(store.data.timeEntries.filter((t) => t.requestId === "req_harbor")).toHaveLength(0);
    expect(store.data.timeEntries.filter((t) => t.note === "Client hours")).toHaveLength(0);
  });
});

describe("plan and schedule write gates", () => {
  it("blocks operators from rewriting a customer plan", () => {
    const store = new MemoryStore(seedData());
    const { operator, manager } = actors(store);
    store.askClarification(manager, "req_inbox", "Which list?");
    const open = store.data.clarifications.find((c) => c.requestId === "req_inbox" && !c.answer)!;
    store.answerClarification(store.actorFromUser("usr_founder")!, open.id, "Elena VIP list");

    expect(() => store.modifyPlan(operator, "req_inbox", ["Rewritten by operator"])).toThrow(AuthzError);
    expect(store.data.steps.some((s) => s.requestId === "req_inbox" && s.title === "Rewritten by operator")).toBe(false);
  });

  it("refuses a scheduled run when the workstream has no cadence", async () => {
    const store = new MemoryStore(seedData());
    const { manager, teammate } = actors(store);

    expect(store.getWorkstream(manager, "ws_inbox").schedule).toBeNull();
    await expect(store.runWorkstreamSchedule(manager, "ws_inbox")).rejects.toThrow(/No recurring schedule/);
    expect(() =>
      store.setWorkstreamSchedule(teammate, "ws_inbox", {
        cadence: "weekly",
        time: "09:00",
        tasks: ["Draft inbox pack"],
      }),
    ).toThrow(AuthzError);
    await expect(store.runWorkstreamSchedule(teammate, "ws_sales")).rejects.toThrow(AuthzError);
  });
});

describe("tenant-scoped derived reads and memory writes", () => {
  it("keeps approvals and activity inside the caller's organization", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);
    store.createApproval(manager, "req_harbor", "prepare_only", "Harbor-only plan");
    store.data.audits.unshift({
      id: "au_harbor",
      organizationId: "org_harbor",
      actorId: manager.id,
      action: "approval.requested",
      entityType: "approval",
      entityId: "ap_harbor",
      metadata: { tenant: "harbor" },
      createdAt: new Date().toISOString(),
    });

    expect(store.listApprovals(founder).every((a) => a.organizationId === "org_northline")).toBe(true);
    expect(store.listApprovals(founder, "org_harbor")).toHaveLength(0);
    expect(store.activityFeed(founder).every((a) => a.organizationId === "org_northline")).toBe(true);
    expect(() => store.activityFeed(founder, "org_harbor")).toThrow(AuthzError);
  });

  it("blocks Harbor workstream, hours, org, and memory writes from Northline", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate } = actors(store);

    expect(() => store.listWorkstreams(founder, "org_harbor")).toThrow(AuthzError);
    expect(() => store.hoursReturned(founder, "org_harbor")).toThrow(AuthzError);
    expect(() => store.updateOrganization(founder, "org_harbor", { name: "Hijack" })).toThrow(AuthzError);
    expect(() =>
      store.updateOperatingMemory(teammate, "org_northline", { communicationTone: "Hijack tone" }),
    ).toThrow(AuthzError);
    expect(store.getOperatingMemory(founder, "org_northline").communicationTone).toMatch(/Direct/);
  });
});
