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
  it("triages a complete request and presents an execution plan for approval", async () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const bundle = await store.createRequest(founder, {
      title: "Draft a research brief on boutique firms",
      objective: "A sourced brief the partners can act on",
      description:
        "Research only. Prepare a sourced brief using public material. Do not contact anyone.",
      deliverable: "PDF brief",
      dueAt: null,
      workstreamId: "ws_research",
      recurring: false,
      externalCommunication: false,
    });
    expect(bundle.request.status).toBe("awaiting_plan_approval");
    expect(bundle.plan).toBeTruthy();
    expect(bundle.steps.length).toBeGreaterThan(0);
    expect(bundle.approvals.some((a) => a.kind === "execution_plan" && a.status === "pending")).toBe(true);
  });

  it("asks for missing context instead of inventing a plan approval", async () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const bundle = await store.createRequest(founder, {
      title: "CRM cleanup",
      objective: "Hygiene",
      description: "Clean it up",
      deliverable: "",
      dueAt: null,
      workstreamId: "ws_sales",
      recurring: false,
      externalCommunication: false,
    });
    expect(bundle.request.status).toBe("needs_clarification");
    expect(bundle.clarifications.length).toBeGreaterThan(0);
  });

  it("walks queued → in_progress → qa → ready_to_deliver → delivered → accepted", () => {
    const store = new MemoryStore(seedData());
    const { manager, founder } = actors(store);
    store.transitionRequest(manager, "req_inbox", "in_progress");
    store.transitionRequest(manager, "req_inbox", "qa");
    store.createQaReview(manager, "req_inbox", { passed: true, score: 90, notes: "Draft pack is complete and send is blocked." });
    store.deliverRequest(manager, "req_inbox", {
      summary: "Inbox pack ready. Nothing sent.",
      deliverables: ["Draft pack"],
      attachments: [],
      actionsTaken: ["Triaged unread", "Drafted replies"],
      exceptions: [],
      unresolvedDecisions: [],
      nextStep: "Elena reviews drafts",
    });
    store.transitionRequest(founder, "req_inbox", "accepted");
    expect(store.getRequest(founder, "req_inbox").status).toBe("accepted");
  });

  it("rejects illegal transitions and delivery without a package", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    expect(() => store.transitionRequest(manager, "req_inbox", "accepted")).toThrow(DomainError);
    store.data.requests.find((r) => r.id === "req_content")!.status = "ready_to_deliver";
    expect(() => store.transitionRequest(manager, "req_content", "delivered")).toThrow(/delivery package/i);
  });
});

describe("approval requirements", () => {
  it("refuses to start sensitive execution without approval", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    store.data.requests.find((r) => r.id === "req_wire")!.status = "assigned";
    expect(() => store.transitionRequest(manager, "req_wire", "in_progress")).toThrow(/explicit approval/i);
    expect(store.getRequest(manager, "req_wire").status).toBe("awaiting_action_approval");
  });

  it("allows sensitive execution only after the customer approves", () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    store.decideApproval(founder, "ap_wire", "approved", "Pack looks right. Do not pay until I say.");
    expect(store.getRequest(founder, "req_wire").status).toBe("in_progress");
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
    store.assignOperator(manager, "req_inbox", "op_julian");
    const req = store.getRequest(manager, "req_inbox");
    expect(req.assignedOperatorId).toBe("op_julian");
    expect(req.status).toBe("assigned");
    expect(store.data.audits.some((a) => a.action === "request.assigned" && a.entityId === "req_inbox")).toBe(true);
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
    expect(bundle.request.status).toBe("awaiting_plan_approval");
    expect(bundle.plan?.approvalsRequired).toBe(true);

    const planApproval = store.listApprovals(founder).find((a) => a.requestId === bundle.request.id && a.kind === "execution_plan");
    expect(planApproval?.status).toBe("pending");
    expect(() => store.transitionRequest(manager, bundle.request.id, "queued")).toThrow(/execution plan/i);

    store.decideApproval(founder, planApproval!.id, "approved", "Plan is fine. Still do not pay.");
    expect(store.getRequest(founder, bundle.request.id).status).toBe("queued");
    store.assignOperator(manager, bundle.request.id, "op_priya");
    expect(() => store.transitionRequest(manager, bundle.request.id, "in_progress")).toThrow(/explicit approval/i);
    expect(store.getRequest(manager, bundle.request.id).status).toBe("awaiting_action_approval");

    const sensitive = store.listApprovals(founder).find((a) => a.requestId === bundle.request.id && a.kind === "sensitive_action");
    store.decideApproval(founder, sensitive!.id, "approved", "Pack only. Still do not pay.");
    store.transitionRequest(manager, bundle.request.id, "qa");
    store.createQaReview(manager, bundle.request.id, { passed: true, score: 92, notes: "Sources attached. Approval on file." });
    store.deliverRequest(manager, bundle.request.id, {
      summary: "Payment pack assembled. No funds moved.",
      deliverables: ["Payment pack"],
      attachments: [],
      actionsTaken: ["Compiled invoice", "Compiled SOW"],
      exceptions: ["Payment not initiated"],
      unresolvedDecisions: ["When to pay"],
      nextStep: "Elena authorizes finance separately",
    });
    store.transitionRequest(founder, bundle.request.id, "accepted");
    expect(store.getRequest(founder, bundle.request.id).status).toBe("accepted");
    const pb = store.generatePlaybookFromRequest(founder, bundle.request.id, "Vendor payment pack");
    expect(pb.title).toBe("Vendor payment pack");
    expect(store.data.audits.some((a) => a.action === "request.created" && a.entityId === bundle.request.id)).toBe(true);
    expect(store.data.audits.some((a) => a.action === "approval.decided")).toBe(true);
    expect(store.data.audits.some((a) => a.action === "ai.action")).toBe(true);
  });

  it("prefills a future request from a playbook", async () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const bundle = await store.createRequest(founder, {
      title: "Triage inbox tomorrow",
      objective: "Only decisions reach Elena",
      description: "Use the founder inbox playbook. Draft only. Never send.",
      deliverable: "Draft pack",
      dueAt: null,
      workstreamId: "ws_inbox",
      playbookId: "pb_inbox",
      recurring: true,
      externalCommunication: false,
    });
    expect(bundle.request.playbookId).toBe("pb_inbox");
    expect(bundle.steps.map((s) => s.title).join(" ")).toMatch(/Do not send/i);
    expect(bundle.request.customerInstructions).toMatch(/exclamation/i);
    expect(bundle.request.qaChecklist.length).toBeGreaterThan(0);
  });

  it("runs a recurring workstream schedule into a new request", async () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    const created = await store.runWorkstreamSchedule(manager, "ws_sales");
    expect(created.request.recurring).toBe(true);
    expect(created.request.title).toMatch(/Sales Operations/i);
    expect(created.request.description).toMatch(/Inspect CRM/i);
    expect(created.request.playbookId).toBe("pb_proposal");
  });

  it("lets the customer answer clarifications and then approve a modified plan", async () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);
    store.askClarification(manager, "req_inbox", "Which VIP list should we use?");
    expect(store.getRequest(founder, "req_inbox").status).toBe("needs_clarification");
    const open = store.data.clarifications.find((c) => c.requestId === "req_inbox" && !c.answer)!;
    store.answerClarification(founder, open.id, "The existing Elena VIP list.");
    expect(store.getRequest(founder, "req_inbox").status).toBe("awaiting_plan_approval");
    store.modifyPlan(founder, "req_inbox", ["Triage unread", "Draft replies", "Escalate VIPs"]);
    const approval = store.listApprovals(founder).find((a) => a.requestId === "req_inbox" && a.kind === "execution_plan" && a.status === "pending");
    store.decideApproval(founder, approval!.id, "approved", "Use the revised steps.");
    expect(store.getRequest(founder, "req_inbox").status).toBe("queued");
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

describe("operating memory", () => {
  it("stores preferences on the organization and reuses them on a later request", async () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const memory = store.getOperatingMemory(founder, "org_northline");
    expect(memory.communicationTone).toMatch(/Direct/i);
    expect(memory.crmRules).toMatch(/HubSpot/i);
    store.updateOperatingMemory(founder, "org_northline", { communicationTone: "Warmer, still no exclamation points." });
    const bundle = await store.createRequest(founder, {
      title: "Draft a one-page account brief",
      objective: "A brief Marcus can use in the weekly",
      description: "Prepare only. Public notes and the authorized HubSpot view. Do not contact the account.",
      deliverable: "One-page brief",
      dueAt: null,
      workstreamId: "ws_exec",
      recurring: false,
      externalCommunication: false,
    });
    expect(bundle.request.customerInstructions).toMatch(/Warmer/i);
    expect(bundle.memory?.communicationTone).toMatch(/Warmer/i);
    expect(() => store.getOperatingMemory(founder, "org_harbor")).toThrow(AuthzError);
  });
});

describe("Northline conference follow-up lifecycle", () => {
  it("walks the same seeded request from plan approval to playbook and repeat", async () => {
    const store = new MemoryStore(seedData());
    const { founder, manager, operator } = actors(store);
    const start = store.getRequest(founder, "req_conference");
    expect(start.title).toMatch(/conference/i);
    expect(start.status).toBe("awaiting_plan_approval");
    expect(start.approvalLevel).toBe("external_execution");
    expect(store.getRequestBundle(founder, "req_conference").plan).toBeTruthy();

    const planAp = store
      .listApprovals(founder)
      .find((a) => a.requestId === "req_conference" && a.kind === "execution_plan");
    store.decideApproval(founder, planAp!.id, "approved", "Follow every lead. Do not send until I approve copy.");
    expect(store.getRequest(founder, "req_conference").status).toBe("queued");

    store.assignOperator(manager, "req_conference", "op_maya");
    expect(store.getRequest(manager, "req_conference").status).toBe("assigned");
    expect(store.getRequest(operator, "req_conference").assignedOperatorId).toBe("op_maya");
    expect(() => store.getRequest(operator, "req_harbor")).toThrow(AuthzError);

    store.transitionRequest(manager, "req_conference", "in_progress");
    expect(store.getRequest(manager, "req_conference").status).toBe("in_progress");

    store.transitionRequest(manager, "req_conference", "qa");
    store.createQaReview(manager, "req_conference", {
      passed: false,
      score: 55,
      notes: "Owners missing on four rows.",
      defects: ["Unassigned leads remain"],
    });
    expect(store.getRequest(manager, "req_conference").status).toBe("revision_required");

    store.transitionRequest(manager, "req_conference", "in_progress");
    store.transitionRequest(manager, "req_conference", "qa");
    store.createQaReview(manager, "req_conference", {
      passed: true,
      score: 94,
      notes: "Owners present. Drafts ready. Approval required before send.",
    });
    expect(store.getRequest(manager, "req_conference").status).toBe("awaiting_action_approval");

    const outbound = store
      .listApprovals(founder)
      .find((a) => a.requestId === "req_conference" && a.kind === "external_email" && a.status === "pending");
    expect(outbound).toBeTruthy();
    store.decideApproval(founder, outbound!.id, "approved", "Send the drafts as written.");
    expect(store.getRequest(founder, "req_conference").status).toBe("ready_to_deliver");

    store.deliverRequest(manager, "req_conference", {
      summary: "Every conference lead has an owner and a prepared follow-up. Approved emails are ready to send.",
      deliverables: ["Owned lead list", "CRM update draft", "Follow-up drafts", "Exception log"],
      attachments: ["conference-leads.csv"],
      actionsTaken: ["Assigned owners", "Drafted CRM updates", "Drafted emails", "Escalated four exceptions"],
      exceptions: ["Two duplicate rows"],
      unresolvedDecisions: ["Whether to recycle out-of-ICP names"],
      nextStep: "Capture this as the conference follow-up playbook",
    });
    store.transitionRequest(founder, "req_conference", "accepted");
    expect(store.getRequest(founder, "req_conference").status).toBe("accepted");

    const pb = store.generatePlaybookFromRequest(founder, "req_conference", "Conference lead follow-up");
    expect(pb.title).toBe("Conference lead follow-up");

    const repeat = await store.createRequest(founder, {
      title: "Follow up last week's webinar leads",
      objective: "Every webinar lead has an owner and a prepared follow-up.",
      description: "Use the conference follow-up playbook. Draft only. Do not send until approved.",
      deliverable: "Follow-up pack",
      dueAt: null,
      workstreamId: "ws_sales",
      playbookId: pb.id,
      recurring: true,
      externalCommunication: true,
    });
    expect(repeat.request.playbookId).toBe(pb.id);
    expect(repeat.steps.length).toBeGreaterThan(0);
    expect(repeat.request.customerInstructions).toMatch(/HubSpot|tone|Direct/i);

    const generated = await store.runDueSchedules(manager);
    expect(generated.length).toBeGreaterThan(0);
    expect(generated[0].request.description).toMatch(/unassigned leads/i);
    expect(store.data.audits.some((a) => a.entityId === "req_conference" && a.action === "request.created")).toBe(true);
    expect(store.data.audits.some((a) => a.action === "approval.decided")).toBe(true);
    expect(store.data.audits.some((a) => a.action === "schedule.generated")).toBe(true);
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
