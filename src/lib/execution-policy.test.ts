import { describe, expect, it } from "vitest";
import {
  canTransitionWorkstreamRun,
  finalRunStatusForReceipt,
  requiresEvidence,
} from "@/lib/execution-policy";

describe("workstream execution policy", () => {
  it("requires a planned run to start before verification", () => {
    expect(canTransitionWorkstreamRun("planned", "running")).toBe(true);
    expect(canTransitionWorkstreamRun("planned", "awaiting_verification")).toBe(false);
    expect(canTransitionWorkstreamRun("planned", "verified")).toBe(false);
  });

  it("freezes terminal runs", () => {
    expect(canTransitionWorkstreamRun("verified", "running")).toBe(false);
    expect(canTransitionWorkstreamRun("failed", "running")).toBe(false);
    expect(canTransitionWorkstreamRun("cancelled", "running")).toBe(false);
  });

  it("only produces a verified final state when verification passes and done is met", () => {
    expect(finalRunStatusForReceipt("passed", true)).toBe("verified");
    expect(finalRunStatusForReceipt("passed", false)).toBe("failed");
    expect(finalRunStatusForReceipt("failed", true)).toBe("failed");
    expect(finalRunStatusForReceipt("failed", false)).toBe("failed");
  });

  it("does not let a run skip verification or reopen after it starts", () => {
    expect(canTransitionWorkstreamRun("running", "awaiting_verification")).toBe(true);
    expect(canTransitionWorkstreamRun("running", "verified")).toBe(false);
    expect(canTransitionWorkstreamRun("planned", "failed")).toBe(false);
    expect(canTransitionWorkstreamRun("awaiting_verification", "verified")).toBe(true);
    expect(canTransitionWorkstreamRun("awaiting_verification", "running")).toBe(false);
    expect(canTransitionWorkstreamRun("awaiting_verification", "cancelled")).toBe(false);
  });

  it("requires evidence when the spec defines a verification rule", () => {
    expect(requiresEvidence([])).toBe(false);
    expect(requiresEvidence(["", "   "])).toBe(false);
    expect(requiresEvidence(["Re-read every changed record"])).toBe(true);
  });
});
