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

const deliveryPack = {
  summary: "Prepared pack. Nothing sent.",
  deliverables: ["Draft pack"],
  attachments: [] as string[],
  actionsTaken: ["Drafted"],
  exceptions: [] as string[],
  unresolvedDecisions: [] as string[],
  nextStep: "Customer reviews",
};

describe("MemoryStore Harbor write and client transition gates", () => {
  it("keeps Harbor request bundles and writes off Northline clients", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate } = actors(store);

    expect(() => store.getRequestBundle(founder, "req_harbor")).toThrow(AuthzError);
    expect(() => store.getRequestBundle(teammate, "req_harbor")).toThrow(AuthzError);
    expect(() => store.addComment(founder, "req_harbor", "Northline should not see this")).toThrow(AuthzError);
    expect(() =>
      store.createQaReview(founder, "req_harbor", { passed: true, score: 99, notes: "cross-tenant QA" }),
    ).toThrow(AuthzError);
    expect(() => store.deliverRequest(founder, "req_harbor", deliveryPack)).toThrow(AuthzError);
    expect(() => store.transitionRequest(founder, "req_harbor", "cancelled")).toThrow(AuthzError);
    expect(() => store.generatePlaybookFromRequest(founder, "req_harbor")).toThrow(AuthzError);
    expect(store.getRequest(founder, "req_conference").organizationId).toBe("org_northline");
  });

  it("lets a customer cancel their own open request and refuses accept before delivery", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate } = actors(store);

    store.transitionRequest(founder, "req_conference", "cancelled");
    expect(store.getRequest(founder, "req_conference").status).toBe("cancelled");

    expect(() => store.transitionRequest(founder, "req_inbox", "accepted")).toThrow(DomainError);
    expect(() => store.transitionRequest(teammate, "req_inbox", "queued")).toThrow(AuthzError);
    expect(store.getRequest(founder, "req_inbox").status).toBe("queued");
  });

  it("keeps Harbor integrations off Northline lists while ops can see every row", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);
    store.data.integrations.push({
      id: "in_harbor",
      organizationId: "org_harbor",
      provider: "Harbor ATS",
      status: "connected",
      scopes: ["candidates.read"],
      lastAccessedAt: null,
    });

    const northline = store.listIntegrations(founder);
    expect(northline.some((row) => row.id === "in_harbor")).toBe(false);
    expect(northline.every((row) => row.organizationId === "org_northline")).toBe(true);

    const ops = store.listIntegrations(manager);
    expect(ops.some((row) => row.id === "in_harbor")).toBe(true);
    expect(ops.some((row) => row.organizationId === "org_northline")).toBe(true);
  });

  it("lets customers and ops list operators, and fails closed on an unknown user", () => {
    const store = new MemoryStore(seedData());
    const { founder, operator, manager } = actors(store);

    const listed = store.listOperators(founder);
    expect(listed.map((row) => row.id)).toEqual(
      expect.arrayContaining(["op_maya", "op_julian", "op_priya", "op_noah"]),
    );
    expect(listed.find((row) => row.id === "op_maya")?.skills.some((skill) => skill.skillId === "sk_inbox")).toBe(
      true,
    );
    expect(store.listOperators(operator).length).toBe(listed.length);
    expect(store.listOperators(manager).length).toBe(listed.length);
    expect(store.actorFromUser("usr_missing")).toBeNull();
  });
});
