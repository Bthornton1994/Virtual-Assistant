import { describe, expect, it } from "vitest";
import {
  WORKSTREAM_RUN_STATUSES,
  canTransitionWorkstreamRun,
  finalRunStatusForReceipt,
  requiresEvidence,
  type WorkstreamRunStatus,
} from "@/lib/execution-policy";

const TERMINAL: WorkstreamRunStatus[] = ["verified", "failed", "cancelled"];

describe("workstream execution-policy leftover gates", () => {
  it("does not let a running workstream skip verification and become verified", () => {
    expect(canTransitionWorkstreamRun("running", "verified")).toBe(false);
    expect(canTransitionWorkstreamRun("running", "awaiting_verification")).toBe(true);
    expect(canTransitionWorkstreamRun("awaiting_verification", "verified")).toBe(true);
    expect(canTransitionWorkstreamRun("awaiting_verification", "failed")).toBe(true);
  });

  it("does not cancel from awaiting_verification, and does not skip from planned to failed", () => {
    expect(canTransitionWorkstreamRun("awaiting_verification", "cancelled")).toBe(false);
    expect(canTransitionWorkstreamRun("awaiting_verification", "running")).toBe(false);
    expect(canTransitionWorkstreamRun("planned", "failed")).toBe(false);
    expect(canTransitionWorkstreamRun("planned", "cancelled")).toBe(true);
    expect(canTransitionWorkstreamRun("running", "failed")).toBe(true);
    expect(canTransitionWorkstreamRun("running", "cancelled")).toBe(true);
  });

  it("gives every terminal status no exit", () => {
    for (const from of TERMINAL) {
      for (const to of WORKSTREAM_RUN_STATUSES) {
        expect(canTransitionWorkstreamRun(from, to), `${from} -> ${to}`).toBe(false);
      }
    }
  });

  it("fails a receipt when verification failed even if definition-of-done is claimed", () => {
    expect(finalRunStatusForReceipt("failed", false)).toBe("failed");
    expect(finalRunStatusForReceipt("failed", true)).toBe("failed");
    expect(finalRunStatusForReceipt("passed", false)).toBe("failed");
    expect(finalRunStatusForReceipt("passed", true)).toBe("verified");
  });

  it("still requires evidence when a blank rule sits beside a real one", () => {
    expect(requiresEvidence(["", "Re-read every changed record"])).toBe(true);
    expect(requiresEvidence(["   "])).toBe(false);
  });
});
