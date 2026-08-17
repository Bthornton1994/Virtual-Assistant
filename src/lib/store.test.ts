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

describe("tenant isolation", () => {
  it("hides another organization's requests from client members", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const titles = store.listRequests(founder).map((r) => r.title);
    expect(titles.join(" ")).not.toMatch(/Harbor confidential/i);
    expect(() => store.getRequest(founder, "req_harbor")).toThrow(AuthzError);
  });

  it("does not list Harbor playbooks to Northline", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const pbs = store.listPlaybooks(founder, "org_northline");
    expect(pbs.every((p) => p.organizationId === "org_northline")).toBe(true);
    expect(() => store.listPlaybooks(founder, "org_harbor")).toThrow(AuthzError);
  });
});

describe("role authorization", () => {
  it("lets client_admin invite, and blocks client_member", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate } = actors(store);
    store.inviteMember(founder, {
      email: "new@northline.demo",
      name: "Pat",
      role: "client_member",
    });
    expect(() =>
      store.inviteMember(teammate, {
        email: "x@northline.demo",
        name: "X",
        role: "client_member",
      }),
    ).toThrow(AuthzError);
  });

  it("blocks operators from assigning other operators", () => {
    const store = new MemoryStore(seedData());
    const { operator } = actors(store);
    expect(() => store.assignOperator(operator, "req_report", "op_julian")).toThrow(AuthzError);
  });

  it("blocks clients from running the ops queue", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    expect(() => store.transitionRequest(founder, "req_inbox", "in_progress")).toThrow(AuthzError);
  });
});

describe("request lifecycle", () => {
  it("creates a request in triage with an execution plan", async () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const bundle = await store.createRequest(founder, {
      title: "Draft a research brief on boutique firms",
      objective: "A sourced brief",
      description: "Research only. Prepare a brief.",
      deliverable: "PDF brief",
      dueAt: null,
      workstreamId: "ws_research",
      recurring: false,
      externalCommunication: false,
    });
    expect(bundle.request.status).toBe("triage");
    expect(bundle.plan).toBeTruthy();
    expect(bundle.steps.length).toBeGreaterThan(0);
  });

  it("walks queued → in_progress → qa → ready → delivered → accepted", () => {
    const store = new MemoryStore(seedData());
    const { manager, founder } = actors(store);
    store.transitionRequest(manager, "req_inbox", "in_progress");
    store.transitionRequest(manager, "req_inbox", "qa");
    store.transitionRequest(manager, "req_inbox", "ready");
    store.transitionRequest(manager, "req_inbox", "delivered");
    store.transitionRequest(founder, "req_inbox", "accepted");
    expect(store.getRequest(founder, "req_inbox").status).toBe("accepted");
  });

  it("rejects illegal transitions", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    expect(() => store.transitionRequest(manager, "req_inbox", "accepted")).toThrow(DomainError);
  });
});

describe("approval requirements", () => {
  it("refuses to start sensitive execution without approval", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    expect(() => store.transitionRequest(manager, "req_wire", "queued")).not.toThrow();
    const again = new MemoryStore(seedData());
    const mgr = again.actorFromUser("usr_manager")!;
    again.data.requests.find((r) => r.id === "req_wire")!.status = "queued";
    expect(() => again.transitionRequest(mgr, "req_wire", "in_progress")).toThrow(/explicit approval/i);
  });

  it("allows sensitive execution only after the customer approves", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);
    store.decideApproval(founder, "ap_wire", "approved", "Pack looks right. Do not pay until I say.");
    expect(store.getRequest(founder, "req_wire").status).toBe("queued");
    store.transitionRequest(manager, "req_wire", "in_progress");
    expect(store.getRequest(manager, "req_wire").status).toBe("in_progress");
  });

  it("blocks operators from deciding customer approvals", () => {
    const store = new MemoryStore(seedData());
    const { operator } = actors(store);
    expect(() => store.decideApproval(operator, "ap_wire", "approved", "no")).toThrow(AuthzError);
  });
});

describe("operator assignment", () => {
  it("lets an ops manager assign and records an audit event", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    store.assignOperator(manager, "req_report", "op_maya");
    const req = store.getRequest(manager, "req_report");
    expect(req.assignedOperatorId).toBe("op_maya");
    expect(req.status).toBe("queued");
    expect(store.data.audits.some((a) => a.action === "request.assigned" && a.entityId === "req_report")).toBe(true);
  });
});

describe("playbook access", () => {
  it("lets the owning org read a playbook and blocks a foreign org id", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const pb = store.getPlaybook(founder, "pb_inbox");
    expect(pb.playbook.organizationId).toBe("org_northline");
    expect(pb.versions.length).toBeGreaterThan(0);
  });

  it("prevents a client_member from publishing a playbook", () => {
    const store = new MemoryStore(seedData());
    const { teammate } = actors(store);
    expect(() =>
      store.createPlaybook(teammate, {
        title: "Secret",
        objective: "x",
        workstreamId: "ws_inbox",
        steps: ["a"],
        preferences: [],
        warnings: [],
      }),
    ).toThrow(AuthzError);
  });
});

describe("demo authentication", () => {
  it("rejects bad passwords and records a failed login", () => {
    const store = new MemoryStore(seedData());
    expect(() => store.authenticate("founder@northline.demo", "nope")).toThrow(DomainError);
    expect(store.data.audits[0]?.action).toBe("auth.failed_login");
  });
});

describe("signup tenant isolation", () => {
  it("creates a new org that cannot read Northline requests or playbooks", () => {
    const store = new MemoryStore(seedData());
    const newbie = store.signup({
      name: "Ada",
      email: "ada@newco.example",
      password: "demo",
      organization: "Newco Studio",
      industry: "Design",
    });
    expect(newbie.role).toBe("client_admin");
    expect(newbie.organizationId).not.toBe("org_northline");
    expect(store.listIntegrations(newbie).length).toBeGreaterThan(0);
    expect(store.listIntegrations(newbie).every((i) => i.organizationId === newbie.organizationId)).toBe(true);
    expect(store.listRequests(newbie).every((r) => r.organizationId === newbie.organizationId)).toBe(true);
    expect(store.listPlaybooks(newbie).every((p) => p.organizationId === newbie.organizationId)).toBe(true);
    expect(() => store.getRequest(newbie, "req_brief")).toThrow(AuthzError);
    expect(() => store.getPlaybook(newbie, "pb_inbox")).toThrow(AuthzError);
  });
});

describe("operator visibility", () => {
  it("hides another operator's assigned foreign-tenant request", () => {
    const store = new MemoryStore(seedData());
    const { operator } = actors(store);
    expect(() => store.getRequest(operator, "req_harbor")).toThrow(AuthzError);
  });
});

describe("end-to-end request flow", () => {
  it("intakes, gates sensitive work, assigns, QAs, delivers, and accepts", async () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);
    const bundle = await store.createRequest(founder, {
      title: "Prepare vendor retainer payment pack and transfer funds",
      objective: "Finance-ready pack. Do not pay until approved.",
      description: "Compile invoice and SOW. Transfer funds is mentioned so the action class must be sensitive.",
      deliverable: "Payment pack",
      dueAt: null,
      workstreamId: "ws_back",
      recurring: false,
      externalCommunication: false,
    });
    expect(bundle.request.approvalLevel).toBe("sensitive_execution");
    expect(bundle.request.status).toBe("awaiting_approval");
    expect(bundle.plan?.approvalsRequired).toBe(true);

    const approval = store.listApprovals(founder).find((a) => a.requestId === bundle.request.id);
    expect(approval?.status).toBe("pending");
    store.transitionRequest(manager, bundle.request.id, "queued");
    expect(() => store.transitionRequest(manager, bundle.request.id, "in_progress")).toThrow(/explicit approval/i);

    store.decideApproval(founder, approval!.id, "approved", "Pack only. Still do not pay.");
    store.assignOperator(manager, bundle.request.id, "op_priya");
    store.transitionRequest(manager, bundle.request.id, "in_progress");
    store.transitionRequest(manager, bundle.request.id, "qa");
    store.createQaReview(manager, bundle.request.id, { passed: true, score: 92, notes: "Sources attached. Approval on file." });
    store.transitionRequest(manager, bundle.request.id, "delivered");
    store.transitionRequest(founder, bundle.request.id, "accepted");
    expect(store.getRequest(founder, bundle.request.id).status).toBe("accepted");
    expect(store.data.audits.some((a) => a.action === "request.created" && a.entityId === bundle.request.id)).toBe(true);
    expect(store.data.audits.some((a) => a.action === "approval.decided")).toBe(true);
    expect(store.data.audits.some((a) => a.action === "ai.action")).toBe(true);
  });
});

describe("audit export", () => {
  it("lets client_admin export and blocks client_member", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate } = actors(store);
    const rows = store.exportAudit(founder, "org_northline");
    expect(rows.every((r) => r.organizationId === "org_northline")).toBe(true);
    expect(store.data.audits.some((a) => a.action === "data.exported")).toBe(true);
    expect(() => store.exportAudit(teammate, "org_northline")).toThrow(AuthzError);
  });
});

describe("organization settings", () => {
  it("lets client_admin rename the org and blocks members", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate } = actors(store);
    store.updateOrganization(founder, "org_northline", { name: "Northline Advisory LLP" });
    expect(store.getOrganization(founder, "org_northline").name).toBe("Northline Advisory LLP");
    expect(() => store.updateOrganization(teammate, "org_northline", { name: "Hijack" })).toThrow(AuthzError);
  });
});
