import { describe, expect, it } from "vitest";
import type { RequestRecord } from "@/lib/domain";
import { countOverdue } from "@/lib/ops-metrics";

function request(partial: Pick<RequestRecord, "status" | "dueAt">): RequestRecord {
  return {
    id: "req_x",
    organizationId: "org_northline",
    workstreamId: null,
    title: "Overdue check",
    objective: "x",
    description: "x",
    deliverable: "x",
    priority: "medium",
    riskLevel: "low",
    approvalLevel: "prepare_only",
    createdBy: "usr_x",
    assignedOperatorId: null,
    estimatedEffort: 1,
    actualEffort: 0,
    automationScore: 0,
    recurring: false,
    externalCommunication: false,
    playbookId: null,
    missingContext: [],
    customerInstructions: "",
    internalInstructions: "",
    qaChecklist: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

describe("ops overdue count", () => {
  const now = Date.parse("2026-09-10T12:00:00.000Z");

  it("counts only open requests whose due date has already passed", () => {
    expect(
      countOverdue(
        [
          request({ status: "in_progress", dueAt: "2026-09-09T12:00:00.000Z" }),
          request({ status: "qa", dueAt: "2026-09-10T11:59:59.000Z" }),
          request({ status: "queued", dueAt: "2026-09-10T12:00:00.000Z" }),
          request({ status: "assigned", dueAt: null }),
        ],
        now,
      ),
    ).toBe(2);
  });

  it("ignores delivered, accepted, and cancelled work even when the due date is past", () => {
    expect(
      countOverdue(
        [
          request({ status: "delivered", dueAt: "2026-09-01T00:00:00.000Z" }),
          request({ status: "accepted", dueAt: "2026-09-01T00:00:00.000Z" }),
          request({ status: "cancelled", dueAt: "2026-09-01T00:00:00.000Z" }),
          request({ status: "ready_to_deliver", dueAt: "2026-09-01T00:00:00.000Z" }),
        ],
        now,
      ),
    ).toBe(1);
  });
});
