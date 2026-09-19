import { describe, expect, it } from "vitest";
import { AuthzError, DomainError } from "@/lib/domain";
import { MemoryStore, seedData } from "@/lib/store";

function actors(store: MemoryStore) {
  return {
    founder: store.actorFromUser("usr_founder")!,
    teammate: store.actorFromUser("usr_teammate")!,
    operator: store.actorFromUser("usr_op")!,
    manager: store.actorFromUser("usr_manager")!,
  };
}

describe("demo authentication success path", () => {
  it("authenticates a known demo user case-insensitively and records a login", () => {
    const store = new MemoryStore(seedData());
    const actor = store.authenticate("FOUNDER@northline.demo", "demo");
    expect(actor.id).toBe("usr_founder");
    expect(actor.role).toBe("client_admin");
    expect(actor.source).toBe("demo");
    expect(store.data.audits.some((event) => event.action === "auth.login" && event.actorId === actor.id)).toBe(
      true,
    );
  });
});

describe("organization and membership visibility", () => {
  it("does not list Harbor to a Northline admin whose Harbor membership was removed", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    expect(store.listOrganizations(founder).map((org) => org.id)).toEqual(["org_northline"]);
    expect(() => store.getOrganization(founder, "org_harbor")).toThrow(AuthzError);
    expect(() => store.listMembers(founder, "org_harbor")).toThrow(AuthzError);
  });

  it("lets operations staff list both seeded organizations", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    expect(store.listOrganizations(manager).map((org) => org.id).sort()).toEqual([
      "org_harbor",
      "org_northline",
    ]);
  });
});

describe("internal notes", () => {
  it("lets ops add an internal note and blocks clients", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate, manager } = actors(store);
    const note = store.addInternalNote(manager, "req_inbox", "Do not send until Elena replies.");
    expect(note.organizationId).toBe("org_northline");
    expect(note.requestId).toBe("req_inbox");
    expect(() => store.addInternalNote(founder, "req_inbox", "client note")).toThrow(AuthzError);
    expect(() => store.addInternalNote(teammate, "req_inbox", "member note")).toThrow(AuthzError);
  });

  it("does not let ops attach an internal note to another tenant's request", () => {
    const store = new MemoryStore(seedData());
    const { operator } = actors(store);
    expect(() => store.addInternalNote(operator, "req_harbor", "peek")).toThrow(AuthzError);
  });
});

describe("integration access requests", () => {
  it("lets a client admin request a disconnected integration and leaves a connected one connected", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const requested = store.requestIntegrationAccess(founder, "in_3");
    expect(requested.status).toBe("requested");
    expect(requested.provider).toBe("Slack");
    expect(store.requestIntegrationAccess(founder, "in_1").status).toBe("connected");
  });

  it("denies a foreign-org integration even when the caller is a client admin", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    store.data.integrations.push({
      id: "in_harbor",
      organizationId: "org_harbor",
      provider: "HubSpot",
      status: "disconnected",
      scopes: ["crm.objects.deals.read"],
      lastAccessedAt: null,
    });
    expect(() => store.requestIntegrationAccess(founder, "in_harbor")).toThrow(AuthzError);
    expect(store.data.integrations.find((row) => row.id === "in_harbor")?.status).toBe("disconnected");
  });

  it("blocks ordinary operators from requesting customer integrations", () => {
    const store = new MemoryStore(seedData());
    const { operator } = actors(store);
    expect(() => store.requestIntegrationAccess(operator, "in_3")).toThrow(AuthzError);
    expect(store.data.integrations.find((row) => row.id === "in_3")?.status).toBe("disconnected");
  });
});

describe("tenant-scoped derived lists", () => {
  it("keeps open clarifications, QA reviews, and time entries inside the caller's visible requests", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    store.data.clarifications.push({
      id: "cl_harbor",
      organizationId: "org_harbor",
      requestId: "req_harbor",
      question: "Which Harbor pipeline?",
      answer: null,
      askedBy: "usr_julian",
      answeredBy: null,
      createdAt: new Date().toISOString(),
      answeredAt: null,
    });
    store.data.qaReviews.push({
      id: "qa_harbor",
      organizationId: "org_harbor",
      requestId: "req_harbor",
      reviewerId: "usr_manager",
      passed: true,
      score: 99,
      notes: "Harbor only",
      checklist: [],
      defects: [],
      createdAt: new Date().toISOString(),
    });
    store.data.timeEntries.push({
      id: "te_harbor",
      organizationId: "org_harbor",
      requestId: "req_harbor",
      operatorId: "op_julian",
      hours: 8,
      note: "Harbor cleanup",
      createdAt: new Date().toISOString(),
    });

    expect(store.listOpenClarifications(founder).every((row) => row.requestId !== "req_harbor")).toBe(
      true,
    );
    expect(store.listQaReviews(founder).every((row) => row.requestId !== "req_harbor")).toBe(true);
    expect(store.listTimeEntries(founder).every((row) => row.requestId !== "req_harbor")).toBe(true);
  });

  it("throws when a workstream id does not exist", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    expect(() => store.getWorkstream(founder, "ws_missing")).toThrow(DomainError);
  });
});
