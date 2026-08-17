import { describe, expect, it } from "vitest";
import {
  ACTION_CLASSES,
  ROLES,
  REQUEST_STATUSES,
  blocksWithoutApproval,
  canTransition,
  requiresExplicitApproval,
} from "@/lib/domain";

describe("domain contracts", () => {
  it("includes every product role", () => {
    expect(ROLES).toEqual([
      "client_admin",
      "client_member",
      "operator",
      "ops_manager",
      "platform_admin",
    ]);
  });

  it("includes every request status", () => {
    expect(REQUEST_STATUSES).toContain("triage");
    expect(REQUEST_STATUSES).toContain("awaiting_approval");
    expect(REQUEST_STATUSES).toContain("accepted");
    expect(REQUEST_STATUSES).toHaveLength(11);
  });

  it("treats sensitive execution as a hard approval gate", () => {
    expect(blocksWithoutApproval("sensitive_execution")).toBe(true);
    expect(blocksWithoutApproval("prepare_only")).toBe(false);
    expect(requiresExplicitApproval("external_execution")).toBe(true);
    expect(ACTION_CLASSES).toHaveLength(4);
  });

  it("does not allow skipping QA on the way to accepted", () => {
    expect(canTransition("in_progress", "accepted")).toBe(false);
    expect(canTransition("queued", "delivered")).toBe(false);
    expect(canTransition("ready", "delivered")).toBe(true);
  });
});
