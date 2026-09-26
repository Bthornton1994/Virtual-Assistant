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

describe("operator assignment scope", () => {
  it("lets an operator open assigned work and hides another operator's assigned requests", () => {
    const store = new MemoryStore(seedData());
    const { operator, otherOperator, manager } = actors(store);

    expect(store.getRequest(operator, "req_inbox").assignedOperatorId).toBe("op_maya");
    expect(store.getRequest(otherOperator, "req_proposal").assignedOperatorId).toBe("op_julian");

    expect(() => store.getRequest(operator, "req_proposal")).toThrow(AuthzError);
    expect(() => store.getRequestBundle(operator, "req_proposal")).toThrow(AuthzError);
    expect(() => store.getRequest(otherOperator, "req_inbox")).toThrow(AuthzError);

    const mayaIds = store.listRequests(operator).map((row) => row.id);
    expect(mayaIds).toContain("req_inbox");
    expect(mayaIds).toContain("req_conference");
    expect(mayaIds).not.toContain("req_proposal");
    expect(mayaIds).not.toContain("req_outreach");
    expect(mayaIds).not.toContain("req_content");
    expect(mayaIds).not.toContain("req_harbor");

    const julianIds = store.listRequests(otherOperator).map((row) => row.id);
    expect(julianIds).toContain("req_proposal");
    expect(julianIds).not.toContain("req_inbox");
    expect(julianIds).toContain("req_harbor");

    expect(store.listRequests(manager).some((row) => row.id === "req_proposal")).toBe(true);
    expect(store.listRequests(manager).some((row) => row.id === "req_inbox")).toBe(true);
  });

  it("blocks comments, time, and delivery on another operator's assigned request", () => {
    const store = new MemoryStore(seedData());
    const { operator, otherOperator, manager } = actors(store);

    expect(() => store.addComment(operator, "req_proposal", "Maya should not see this draft")).toThrow(AuthzError);
    expect(() => store.addTimeEntry(operator, "req_proposal", 1, "Hours on Julian's QA")).toThrow(AuthzError);
    expect(() =>
      store.deliverRequest(operator, "req_content", {
        summary: "Maya cannot deliver Priya's pack",
        deliverables: ["Draft"],
        attachments: [],
        actionsTaken: [],
        exceptions: [],
        unresolvedDecisions: [],
        nextStep: "Leave with assigned operator",
      }),
    ).toThrow(AuthzError);

    expect(store.data.comments.filter((row) => row.requestId === "req_proposal")).toHaveLength(0);
    expect(store.data.timeEntries.filter((row) => row.requestId === "req_proposal")).toHaveLength(0);
    expect(store.data.deliveries.filter((row) => row.requestId === "req_content")).toHaveLength(0);
    expect(store.getRequest(manager, "req_proposal").status).toBe("qa");
    expect(store.getRequest(manager, "req_content").status).toBe("ready_to_deliver");

    const comment = store.addComment(otherOperator, "req_proposal", "Julian can comment on assigned QA");
    expect(comment.visibility).toBe("customer");
    expect(comment.requestId).toBe("req_proposal");
  });

  it("fails closed on a missing request and keeps workstreams tenant-scoped", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);

    expect(() => store.getRequest(manager, "req_missing")).toThrow(DomainError);
    expect(() => store.getRequestBundle(founder, "req_missing")).toThrow(DomainError);
    expect(() => store.getWorkstream(manager, "ws_missing")).toThrow(DomainError);

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

    expect(store.getWorkstream(manager, "ws_harbor").organizationId).toBe("org_harbor");
    expect(() => store.getWorkstream(founder, "ws_harbor")).toThrow(AuthzError);
    expect(store.listWorkstreams(founder).every((row) => row.organizationId === "org_northline")).toBe(true);
    expect(() => store.listWorkstreams(founder, "org_harbor")).toThrow(AuthzError);
  });
});
