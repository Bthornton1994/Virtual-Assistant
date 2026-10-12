import { describe, expect, it } from "vitest";
import {
  bindPlanToAuthority,
  classifyRequestRisk,
  reapprovalAfterRaise,
  requiredApprovals,
  restrictModelStepOwners,
} from "@/lib/ai-authority";
import { REQUEST_STATUSES, type ExecutionPlan, type RequestStatus } from "@/lib/domain";

// Remaining fail-closed branches from #119 that the store suites and
// ai-authority-pure-gates do not pin on their own: keyword floors,
// CRM/vendor approval pairing, raise-status matrix, and model-plan binding.

const BENIGN = {
  title: "Vendor prep",
  objective: "Choose the pilot vendor",
  description: "Compare the shortlisted vendors and pick one for the pilot.",
  deliverable: "Vendor decision",
  externalCommunication: false,
};

function text(description: string) {
  return { ...BENIGN, description };
}

describe("classifyRequestRisk reads remaining consequential keywords", () => {
  it.each([
    ["payroll", "Update the payroll file for March"],
    ["password", "Rotate the password for the vendor portal"],
    ["credential", "Issue a new credential for the contractor"],
    ["contract sign", "Prepare the contract sign packet"],
    ["nda", "Send the nda to the new hire"],
    ["legal", "Ask legal about the clause"],
    ["lawsuit", "Summarize the lawsuit timeline"],
    ["buy", "Buy the extra seats"],
    ["purchase", "Purchase the remaining licenses"],
    ["commit", "Commit the change to the customer repo"],
    ["prod access", "Grant prod access for the weekend"],
    ["production access", "Request production access for the deploy"],
    ["delete account", "Delete account for the departed user"],
    ["invoice pay", "Handle the invoice pay for April"],
    ["publish", "Publish the launch note"],
  ])("classifies %s as sensitive", (_label, description) => {
    expect(classifyRequestRisk(text(description))).toMatchObject({
      actionClass: "sensitive_execution",
      riskLevel: "critical",
    });
  });

  it.each([
    ["email the client", "Email the client the weekly note"],
    ["send to", "Send to the customer list"],
    ["outreach", "Start outreach to the shortlist"],
    ["call the", "Call the account owner"],
    ["post on", "Post on the customer forum"],
    ["linkedin", "Draft the linkedin update"],
    ["customer email", "Write the customer email"],
  ])("classifies %s as external without the outbound flag", (_label, description) => {
    expect(classifyRequestRisk(text(description))).toMatchObject({
      actionClass: "external_execution",
      riskLevel: "high",
    });
  });

  it("keeps unmarked internal work at low-risk execution", () => {
    expect(
      classifyRequestRisk({
        title: "Team calendar",
        objective: "Move standup",
        description: "Move the weekly standup to Tuesday",
        deliverable: "Updated invite",
        externalCommunication: false,
      }),
    ).toMatchObject({
      actionClass: "low_risk_execution",
      riskLevel: "medium",
    });
  });
});

describe("requiredApprovals pairs CRM and vendor language", () => {
  it("requests a CRM approval when the text names a destructive CRM action", () => {
    const approvals = requiredApprovals({
      title: "CRM cleanup",
      description: "HubSpot overwrite of closed deals",
      actionClass: "prepare_only",
      externalCommunication: false,
    });
    expect(approvals.kinds).toEqual(expect.arrayContaining(["execution_plan", "crm_destructive_change"]));
    expect(approvals.kinds).not.toContain("sensitive_action");
    expect(approvals.requiresCustomerDecision).toBe(true);
  });

  it("requests vendor communication only when outbound is also flagged", () => {
    const withFlag = requiredApprovals({
      title: "Vendor note",
      description: "Tell the vendor the deposit landed",
      actionClass: "external_execution",
      externalCommunication: true,
    });
    const withoutFlag = requiredApprovals({
      title: "Vendor note",
      description: "Tell the vendor the deposit landed",
      actionClass: "prepare_only",
      externalCommunication: false,
    });
    expect(withFlag.kinds).toEqual(
      expect.arrayContaining(["execution_plan", "external_email", "vendor_communication"]),
    );
    expect(withoutFlag.kinds).not.toContain("vendor_communication");
  });

  it("does not treat a CRM mention without a destructive verb as CRM approval", () => {
    const approvals = requiredApprovals({
      title: "CRM export",
      description: "Export the HubSpot contact list for the briefing",
      actionClass: "prepare_only",
      externalCommunication: false,
    });
    expect(approvals.kinds).toEqual(["execution_plan"]);
  });
});

describe("reapprovalAfterRaise follows status, not the raise itself", () => {
  const HOLD = { requestApprovals: false, newPlanApproval: false, returnToPlanApproval: false };
  const PRE_PLAN_NO_PRIOR = { requestApprovals: true, newPlanApproval: false, returnToPlanApproval: false };
  const PRE_PLAN_PRIOR = { requestApprovals: true, newPlanApproval: true, returnToPlanApproval: false };
  const ACTIVE = { requestApprovals: true, newPlanApproval: true, returnToPlanApproval: true };

  it("does not reopen accepted or cancelled work", () => {
    expect(reapprovalAfterRaise("accepted", true)).toEqual(HOLD);
    expect(reapprovalAfterRaise("cancelled", false)).toEqual(HOLD);
  });

  it("keeps draft and clarification in place and only re-asks a plan that already existed", () => {
    for (const status of ["draft", "needs_clarification"] as const) {
      expect(reapprovalAfterRaise(status, false)).toEqual(PRE_PLAN_NO_PRIOR);
      expect(reapprovalAfterRaise(status, true)).toEqual(PRE_PLAN_PRIOR);
    }
  });

  it("returns every other live status to plan approval", () => {
    const prePlan = new Set<RequestStatus>(["draft", "needs_clarification", "accepted", "cancelled"]);
    for (const status of REQUEST_STATUSES) {
      if (prePlan.has(status)) continue;
      expect(reapprovalAfterRaise(status, false)).toEqual(ACTIVE);
      expect(reapprovalAfterRaise(status, true)).toEqual(ACTIVE);
    }
  });
});

describe("model plan binding cannot lower authority", () => {
  const plan: ExecutionPlan = {
    summary: "Do it.",
    actionClass: "prepare_only",
    riskLevel: "low",
    steps: [
      { title: "Draft", detail: "Write the note", owner: "operator" },
      { title: "Send", detail: "Send the note", owner: "ai" },
      { title: "File", detail: "File the note", owner: "automation" },
    ],
    approvalsRequired: false,
    automationCandidates: ["Send"],
    humanOwned: [],
  };

  it("keeps a higher plan risk and forces approval on external or sensitive work", () => {
    const raisedRisk = bindPlanToAuthority(
      { ...plan, riskLevel: "high" },
      { actionClass: "low_risk_execution", riskLevel: "medium" },
    );
    expect(raisedRisk).toMatchObject({
      actionClass: "low_risk_execution",
      riskLevel: "high",
      approvalsRequired: false,
    });

    expect(bindPlanToAuthority(plan, { actionClass: "external_execution", riskLevel: "high" })).toMatchObject({
      actionClass: "external_execution",
      riskLevel: "high",
      approvalsRequired: true,
    });
  });

  it("leaves a non-plan or prepare_only plan alone and remaps unsupervised owners above it", () => {
    expect(restrictModelStepOwners("not-a-plan", "sensitive_execution")).toBe("not-a-plan");
    expect(restrictModelStepOwners({ summary: "no steps" }, "external_execution")).toEqual({ summary: "no steps" });
    expect(restrictModelStepOwners(plan, "prepare_only").steps.map((step) => step.owner)).toEqual([
      "operator",
      "ai",
      "automation",
    ]);
    expect(restrictModelStepOwners(plan, "low_risk_execution").steps.map((step) => step.owner)).toEqual([
      "operator",
      "operator",
      "operator",
    ]);
  });
});
