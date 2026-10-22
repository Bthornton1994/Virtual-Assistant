import { describe, expect, it } from "vitest";
import { REQUEST_STATUSES, type RequestRecord, type RequestStatus } from "@/lib/domain";
import { countOverdue } from "@/lib/ops-metrics";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const PAST = "2026-09-01T00:00:00.000Z";

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

const CLOSED: RequestStatus[] = ["delivered", "accepted", "cancelled"];

describe("ops leftover overdue-count gates", () => {
  it("still counts leftover remaining open statuses when the due date has already passed", () => {
    const leftoverOpen: RequestStatus[] = [
      "draft",
      "triage",
      "needs_clarification",
      "awaiting_plan_approval",
      "assigned",
      "blocked",
      "revision_required",
      "awaiting_action_approval",
    ];
    expect(leftoverOpen.every((status) => REQUEST_STATUSES.includes(status))).toBe(true);
    expect(
      countOverdue(
        leftoverOpen.map((status) => request({ status, dueAt: PAST })),
        NOW,
      ),
    ).toBe(leftoverOpen.length);
  });

  it("does not count leftover closed statuses even when every leftover open status is also past due", () => {
    expect(
      countOverdue(
        [
          ...CLOSED.map((status) => request({ status, dueAt: PAST })),
          request({ status: "blocked", dueAt: PAST }),
        ],
        NOW,
      ),
    ).toBe(1);
  });

  it("does not treat leftover missing, leftover exact-now, or leftover malformed due dates as overdue", () => {
    expect(
      countOverdue(
        [
          request({ status: "draft", dueAt: null }),
          request({ status: "blocked", dueAt: "2026-09-10T12:00:00.000Z" }),
          request({ status: "triage", dueAt: "not-a-date" }),
          request({ status: "assigned", dueAt: "" }),
        ],
        NOW,
      ),
    ).toBe(0);
  });
});
