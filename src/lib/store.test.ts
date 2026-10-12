import { describe, expect, it, vi } from "vitest";
import { delegationAI } from "@/lib/ai";
import { AuthzError, DomainError } from "@/lib/domain";
import { MemoryStore, seedData } from "@/lib/store";

function actors(store: MemoryStore) {
  return {
    founder: store.actorFromUser("usr_founder")!,
    teammate: store.actorFromUser("usr_teammate")!,
    operator: store.actorFromUser("usr_op")!,
    otherOperator: store.actorFromUser("usr_julian")!,
    manager: store.actorFromUser("usr_manager")!,
    admin: store.actorFromUser("usr_admin")!,
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

function readyInbox(store: MemoryStore) {
  const { manager } = actors(store);
  store.transitionRequest(manager, "req_inbox", "in_progress");
  store.transitionRequest(manager, "req_inbox", "qa");
  store.createQaReview(manager, "req_inbox", {
    passed: true,
    score: 90,
    notes: "Draft pack is complete and send is blocked.",
  });
  return store.getRequest(manager, "req_inbox");
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

describe("QA pass with pending outbound approval", () => {
  const outboundInput = {
    kind: "external_email" as const,
    action: "Send prepared outbound follow-up",
    description: "Outbound communication requires explicit customer approval before delivery.",
    riskLevel: "high" as const,
    actionClass: "external_execution" as const,
  };

  it("leaves QA as awaiting_action_approval when external_email is already pending", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager, operator } = actors(store);
    const req = store.getRequest(founder, "req_conference");
    store.createApprovalRecord(manager, req, outboundInput, { advanceStatus: false });
    expect(store.getRequest(founder, "req_conference").status).toBe("awaiting_plan_approval");

    const planAp = store
      .listApprovals(founder)
      .find((a) => a.requestId === "req_conference" && a.kind === "execution_plan");
    store.decideApproval(founder, planAp!.id, "approved", "Follow every lead. Do not send until I approve copy.");
    store.assignOperator(manager, "req_conference", "op_maya");
    expect(store.getRequest(operator, "req_conference").assignedOperatorId).toBe("op_maya");
    store.transitionRequest(manager, "req_conference", "in_progress");
    store.transitionRequest(manager, "req_conference", "qa");

    const pendingBefore = store
      .listApprovals(founder)
      .filter((a) => a.requestId === "req_conference" && a.kind === "external_email");
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0].status).toBe("pending");

    store.createQaReview(manager, "req_conference", {
      passed: true,
      score: 94,
      notes: "Owners present. Drafts ready. Approval required before send.",
    });

    const after = store.getRequest(manager, "req_conference");
    expect(after.status).toBe("awaiting_action_approval");
    const outbound = store
      .listApprovals(founder)
      .filter((a) => a.requestId === "req_conference" && a.kind === "external_email");
    expect(outbound).toHaveLength(1);
    expect(outbound[0].status).toBe("pending");

    const qaAudit = store.data.audits.find(
      (a) => a.entityId === "req_conference" && a.action === "request.status_changed" && a.metadata.qaPassed === true,
    );
    expect(qaAudit?.metadata).toMatchObject({ from: "qa", to: "awaiting_action_approval", qaPassed: true });
  });

  it("does not duplicate pending approvals when create/ensure is repeated", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    const req = store.getRequest(manager, "req_conference");
    req.status = "qa";

    const first = store.createApprovalRecord(manager, req, outboundInput);
    const second = store.createApprovalRecord(manager, req, outboundInput);
    const third = store.createApprovalRecord(manager, req, outboundInput, { advanceStatus: false });

    expect(first.id).toBe(second.id);
    expect(second.id).toBe(third.id);
    expect(store.getRequest(manager, "req_conference").status).toBe("awaiting_action_approval");
    const outbound = store.data.approvals.filter(
      (a) => a.requestId === "req_conference" && a.kind === "external_email",
    );
    expect(outbound).toHaveLength(1);
    expect(outbound[0].status).toBe("pending");
  });

  it("does not advance request status when advanceStatus is false", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    const req = store.getRequest(manager, "req_conference");
    expect(req.status).toBe("awaiting_plan_approval");
    store.createApprovalRecord(manager, req, outboundInput, { advanceStatus: false });
    expect(store.getRequest(manager, "req_conference").status).toBe("awaiting_plan_approval");
    expect(
      store.data.approvals.filter((a) => a.requestId === "req_conference" && a.kind === "external_email"),
    ).toHaveLength(1);

    store.createApprovalRecord(manager, req, outboundInput, { advanceStatus: false });
    expect(store.getRequest(manager, "req_conference").status).toBe("awaiting_plan_approval");
    expect(
      store.data.approvals.filter((a) => a.requestId === "req_conference" && a.kind === "external_email"),
    ).toHaveLength(1);
  });
});

describe("delivery authorization", () => {
  it("lets the assigned operator deliver a ready request and is idempotent", () => {
    const store = new MemoryStore(seedData());
    const { operator } = actors(store);
    expect(readyInbox(store).status).toBe("ready_to_deliver");
    expect(store.getRequest(operator, "req_inbox").assignedOperatorId).toBe("op_maya");

    const first = store.deliverRequest(operator, "req_inbox", deliveryPack);
    const second = store.deliverRequest(operator, "req_inbox", { ...deliveryPack, summary: "Second click" });
    expect(first.id).toBe(second.id);
    expect(second.summary).toBe("Prepared pack. Nothing sent.");
    expect(store.getRequest(operator, "req_inbox").status).toBe("delivered");
    expect(store.data.deliveries.filter((d) => d.requestId === "req_inbox")).toHaveLength(1);
    expect(
      store.data.audits.some(
        (a) => a.entityId === "req_inbox" && a.action === "request.status_changed" && a.metadata.to === "delivered",
      ),
    ).toBe(true);
  });

  it("denies a different operator and leaves no delivery row", () => {
    const store = new MemoryStore(seedData());
    const { otherOperator, manager } = actors(store);
    readyInbox(store);
    expect(() => store.deliverRequest(otherOperator, "req_inbox", deliveryPack)).toThrow(AuthzError);
    expect(store.getRequest(manager, "req_inbox").status).toBe("ready_to_deliver");
    expect(store.data.deliveries.filter((d) => d.requestId === "req_inbox")).toHaveLength(0);
  });

  it("denies an ordinary operator when the request is unassigned", () => {
    const store = new MemoryStore(seedData());
    const { operator, manager } = actors(store);
    readyInbox(store);
    store.data.requests.find((r) => r.id === "req_inbox")!.assignedOperatorId = null;
    expect(() => store.deliverRequest(operator, "req_inbox", deliveryPack)).toThrow(AuthzError);
    expect(store.getRequest(manager, "req_inbox").status).toBe("ready_to_deliver");
    expect(store.data.deliveries.filter((d) => d.requestId === "req_inbox")).toHaveLength(0);
  });

  it("lets an ops manager deliver", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    readyInbox(store);
    store.deliverRequest(manager, "req_inbox", deliveryPack);
    expect(store.getRequest(manager, "req_inbox").status).toBe("delivered");
    expect(store.data.deliveries.filter((d) => d.requestId === "req_inbox")).toHaveLength(1);
  });

  it("lets a platform admin deliver", () => {
    const store = new MemoryStore(seedData());
    const { admin, manager } = actors(store);
    readyInbox(store);
    store.deliverRequest(admin, "req_inbox", deliveryPack);
    expect(store.getRequest(manager, "req_inbox").status).toBe("delivered");
    expect(store.data.deliveries.filter((d) => d.requestId === "req_inbox")).toHaveLength(1);
  });

  it("denies client admin and client member delivery", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate, manager } = actors(store);
    readyInbox(store);
    expect(() => store.deliverRequest(founder, "req_inbox", deliveryPack)).toThrow(AuthzError);
    expect(() => store.deliverRequest(teammate, "req_inbox", deliveryPack)).toThrow(AuthzError);
    expect(store.getRequest(manager, "req_inbox").status).toBe("ready_to_deliver");
    expect(store.data.deliveries.filter((d) => d.requestId === "req_inbox")).toHaveLength(0);
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

function passQa(store: MemoryStore, requestId: string) {
  const { manager } = actors(store);
  store.data.requests.find((r) => r.id === requestId)!.status = "qa";
  store.createQaReview(manager, requestId, {
    passed: true,
    score: 90,
    notes: "Checked. Customer approval still required before delivery.",
  });
}

describe("delivery approval gates", () => {
  it("refuses outbound delivery when external_email is only pending", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    passQa(store, "req_outreach");
    expect(store.getRequest(manager, "req_outreach").status).toBe("awaiting_action_approval");
    store.data.requests.find((r) => r.id === "req_outreach")!.status = "ready_to_deliver";

    expect(() => store.deliverRequest(manager, "req_outreach", deliveryPack)).toThrow(
      /Outbound action requires customer approval/,
    );
    expect(store.getRequest(manager, "req_outreach").status).toBe("ready_to_deliver");
    expect(store.data.deliveries.filter((d) => d.requestId === "req_outreach")).toHaveLength(0);
  });

  it("refuses outbound delivery after the customer rejects send", () => {
    const store = new MemoryStore(seedData());
    const { founder, manager } = actors(store);
    store.decideApproval(founder, "ap_mail", "rejected", "Do not send.");
    passQa(store, "req_outreach");
    store.data.requests.find((r) => r.id === "req_outreach")!.status = "ready_to_deliver";

    expect(() => store.deliverRequest(manager, "req_outreach", deliveryPack)).toThrow(
      /Outbound action requires customer approval/,
    );
    expect(store.data.deliveries.filter((d) => d.requestId === "req_outreach")).toHaveLength(0);
  });

  it("refuses sensitive delivery when sensitive_action is not approved", () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    passQa(store, "req_wire");
    expect(store.getRequest(manager, "req_wire").status).toBe("ready_to_deliver");

    expect(() => store.deliverRequest(manager, "req_wire", deliveryPack)).toThrow(
      /Sensitive action requires customer approval/,
    );
    expect(store.getRequest(manager, "req_wire").status).toBe("ready_to_deliver");
    expect(store.data.deliveries.filter((d) => d.requestId === "req_wire")).toHaveLength(0);
    expect(store.data.approvals.find((a) => a.id === "ap_wire")?.status).toBe("pending");
  });
});

describe("internal visibility", () => {
  it("hides internal comments and notes from clients and coerces client comments to customer", () => {
    const store = new MemoryStore(seedData());
    const { founder, teammate, manager } = actors(store);

    const internal = store.addComment(manager, "req_inbox", "CRM duplicate — escalate to Harbor later", "internal");
    const note = store.addInternalNote(manager, "req_inbox", "Do not mention Harbor in the customer pack");
    const coerced = store.addComment(founder, "req_inbox", "Please keep this operator-only", "internal");

    expect(internal.visibility).toBe("internal");
    expect(coerced.visibility).toBe("customer");

    const clientBundle = store.getRequestBundle(founder, "req_inbox");
    expect(clientBundle.comments.map((c) => c.id)).toContain(coerced.id);
    expect(clientBundle.comments.map((c) => c.id)).not.toContain(internal.id);
    expect(clientBundle.internalNotes).toEqual([]);

    const memberBundle = store.getRequestBundle(teammate, "req_inbox");
    expect(memberBundle.comments.map((c) => c.id)).not.toContain(internal.id);
    expect(memberBundle.internalNotes).toEqual([]);

    const opsBundle = store.getRequestBundle(manager, "req_inbox");
    expect(opsBundle.comments.map((c) => c.id)).toEqual(expect.arrayContaining([internal.id, coerced.id]));
    expect(opsBundle.internalNotes.map((n) => n.id)).toContain(note.id);
  });
});

describe("scheduled run idempotency", () => {
  it("does not create a second same-day scheduled run when the cron fires again", async () => {
    const store = new MemoryStore(seedData());
    const { manager } = actors(store);
    const now = new Date();

    const first = await store.runWorkstreamSchedule(manager, "ws_sales");
    expect(first.request.title).toMatch(/scheduled run/i);
    expect(first.request.recurring).toBe(true);

    const sales = store.data.workstreams.find((w) => w.id === "ws_sales")!;
    sales.nextRunAt = new Date(now.getTime() - 60_000).toISOString();
    const before = store.data.requests.filter(
      (r) => r.workstreamId === "ws_sales" && r.recurring && /scheduled run/i.test(r.title),
    ).length;

    const second = await store.runDueSchedules(manager, now);
    expect(second).toHaveLength(0);
    expect(
      store.data.requests.filter(
        (r) => r.workstreamId === "ws_sales" && r.recurring && /scheduled run/i.test(r.title),
      ),
    ).toHaveLength(before);
    expect(new Date(sales.nextRunAt!).getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("intake action-class elevation", () => {
  it("upgrades a prepare_only classifier result when the customer flagged outbound work", async () => {
    const store = new MemoryStore(seedData());
    const { founder } = actors(store);
    const spy = vi.spyOn(delegationAI, "classifyRisk").mockResolvedValue({
      riskLevel: "low",
      actionClass: "prepare_only",
      reasons: ["Live model under-classified outbound work."],
    });

    try {
      const bundle = await store.createRequest(founder, {
        title: "Draft a research brief on boutique firms",
        objective: "A sourced brief the partners can act on",
        description:
          "Research only. Prepare a sourced brief using public material. Do not invent contacts.",
        deliverable: "PDF brief",
        dueAt: null,
        workstreamId: "ws_research",
        recurring: false,
        externalCommunication: true,
      });
      expect(bundle.request.approvalLevel).toBe("external_execution");
      expect(bundle.request.externalCommunication).toBe(true);
      expect(bundle.request.riskLevel).toBe("low");
    } finally {
      spy.mockRestore();
    }
  });
});
