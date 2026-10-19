import { describe, expect, it } from "vitest";
import {
  REQUEST_STATUSES,
  canTransition,
  identifyMissingContext,
  inferApprovalKind,
  type RequestStatus,
} from "@/lib/domain";

const CLOSED: RequestStatus[] = ["accepted", "cancelled"];

describe("domain leftover lifecycle-skip gates", () => {
  it("does not let any leftover status skip QA into delivered", () => {
    for (const from of REQUEST_STATUSES) {
      if (from === "ready_to_deliver") {
        expect(canTransition(from, "delivered")).toBe(true);
        continue;
      }
      expect(canTransition(from, "delivered"), `${from} -> delivered`).toBe(false);
    }
  });

  it("does not let leftover statuses skip delivery into accepted", () => {
    for (const from of REQUEST_STATUSES) {
      expect(canTransition(from, "accepted"), `${from} -> accepted`).toBe(from === "delivered");
    }
  });

  it("does not let leftover in-progress, blocked, or queued work skip into QA or ready-to-deliver", () => {
    expect(canTransition("in_progress", "ready_to_deliver")).toBe(false);
    expect(canTransition("in_progress", "accepted")).toBe(false);
    expect(canTransition("blocked", "qa")).toBe(false);
    expect(canTransition("blocked", "delivered")).toBe(false);
    expect(canTransition("queued", "qa")).toBe(false);
    expect(canTransition("queued", "ready_to_deliver")).toBe(false);
    expect(canTransition("draft", "qa")).toBe(false);
    expect(canTransition("triage", "in_progress")).toBe(false);
    expect(canTransition("qa", "delivered")).toBe(false);
    expect(canTransition("revision_required", "delivered")).toBe(false);
    expect(canTransition("ready_to_deliver", "accepted")).toBe(false);
  });

  it("gives leftover accepted and cancelled statuses no exit", () => {
    for (const from of CLOSED) {
      for (const to of REQUEST_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });
});

describe("domain leftover missing-context and approval-kind gates", () => {
  it("does not ask which CRM when the description already names HubSpot or Salesforce", () => {
    expect(
      identifyMissingContext({
        title: "CRM cleanup",
        objective: "Clean the pipeline",
        description: "Please clean stale HubSpot deals using the pipeline views already named here.",
        deliverable: "Updated deal list",
      }),
    ).not.toEqual(expect.arrayContaining(["Which CRM and which records or pipeline views should we use?"]));
  });

  it("still asks which CRM when leftover copy names CRM without HubSpot or Salesforce", () => {
    expect(
      identifyMissingContext({
        title: "Pipeline cleanup",
        objective: "Clean the pipeline",
        description: "Please clean stale CRM deals in the pipeline views we discussed last week.",
        deliverable: "Updated deal list",
      }),
    ).toEqual(expect.arrayContaining(["Which CRM and which records or pipeline views should we use?"]));
  });

  it("does not ask for an attachment when leftover copy refers to a file that is already attached", () => {
    expect(
      identifyMissingContext({
        title: "Use the attached export",
        objective: "Update owners",
        description: "Please use the attached export of last week's deals and update owners.",
        deliverable: "Updated deal list",
        files: ["export.csv"],
      }),
    ).not.toEqual(expect.arrayContaining(["Attach the source file or export this request refers to."]));
  });

  it("maps leftover approval-kind keywords without treating vendor copy as a payment approval", () => {
    expect(inferApprovalKind("follow-up mail to the champion")).toBe("external_email");
    expect(inferApprovalKind("delete deal in the pipeline")).toBe("crm_destructive_change");
    expect(inferApprovalKind("rotate production access")).toBe("sensitive_action");
    expect(inferApprovalKind("fund transfer to the operating account")).toBe("sensitive_action");
    expect(inferApprovalKind("payment to the vendor")).toBe("vendor_communication");
  });
});
