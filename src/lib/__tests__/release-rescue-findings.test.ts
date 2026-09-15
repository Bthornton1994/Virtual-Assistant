import { describe, expect, it } from "vitest";
import {
  FINDING_CONFIDENCES,
  FINDING_EXPLOITABILITIES,
  FINDING_IMPACTS,
  computeFindingBlocking,
  computeFindingSeverity,
  releaseRescueFindingV1Schema,
  severityRank,
  validateFinding,
  type FindingConfidence,
  type FindingExploitability,
  type FindingImpact,
} from "@/lib/release-rescue-findings";
import { getRubricCheck } from "@/lib/release-rescue-rubric";
import { makeFinding } from "@/lib/__tests__/release-rescue-fixtures";

const BLOCKING_CHECK = getRubricCheck("authz.object_level_authorization")!;
const NON_BLOCKING_CHECK = getRubricCheck("deps.known_vulnerable_dependencies")!;

describe("finding severity model", () => {
  it("reaches critical only for a severe, remotely reachable, confirmed problem", () => {
    expect(
      computeFindingSeverity({ impact: "severe", exploitability: "remote_unauthenticated", confidence: "confirmed" }),
    ).toBe("critical");
  });

  it("never lets confidence raise severity", () => {
    for (const impact of FINDING_IMPACTS) {
      for (const exploitability of FINDING_EXPLOITABILITIES) {
        const confirmed = computeFindingSeverity({ impact, exploitability, confidence: "confirmed" });
        for (const confidence of FINDING_CONFIDENCES) {
          const actual = computeFindingSeverity({ impact, exploitability, confidence });
          expect(severityRank(actual), `${impact}/${exploitability}/${confidence}`).toBeLessThanOrEqual(
            severityRank(confirmed),
          );
        }
      }
    }
  });

  it("caps a suspicion at medium and a likely finding at high", () => {
    const severe = { impact: "severe" as FindingImpact, exploitability: "remote_unauthenticated" as FindingExploitability };

    expect(computeFindingSeverity({ ...severe, confidence: "likely" })).toBe("high");
    expect(computeFindingSeverity({ ...severe, confidence: "possible" })).toBe("medium");
  });

  it("is monotonic in exploitability", () => {
    // Easier to reach must never be less severe than harder to reach.
    const order: FindingExploitability[] = [
      "theoretical",
      "requires_privilege",
      "requires_user_interaction",
      "remote_unauthenticated",
    ];
    for (const impact of FINDING_IMPACTS) {
      const ranks = order.map((exploitability) =>
        severityRank(computeFindingSeverity({ impact, exploitability, confidence: "confirmed" })),
      );
      const sorted = [...ranks].sort((a, b) => a - b);
      expect(ranks, impact).toEqual(sorted);
    }
  });

  it("returns informational whenever impact is none", () => {
    for (const exploitability of FINDING_EXPLOITABILITIES) {
      for (const confidence of FINDING_CONFIDENCES) {
        expect(computeFindingSeverity({ impact: "none", exploitability, confidence })).toBe("informational");
      }
    }
  });

  it("is total and deterministic across the whole input space", () => {
    for (const impact of FINDING_IMPACTS) {
      for (const exploitability of FINDING_EXPLOITABILITIES) {
        for (const confidence of FINDING_CONFIDENCES) {
          const first = computeFindingSeverity({ impact, exploitability, confidence });
          const second = computeFindingSeverity({ impact, exploitability, confidence });
          expect(first).toBe(second);
          expect(first).toBeDefined();
        }
      }
    }
  });
});

describe("blocking rule", () => {
  it("never blocks on an unconfirmed finding", () => {
    for (const confidence of ["likely", "possible"] as FindingConfidence[]) {
      expect(computeFindingBlocking(BLOCKING_CHECK, "critical", confidence), confidence).toBe(false);
    }
  });

  it("blocks on a confirmed critical wherever it was found", () => {
    expect(computeFindingBlocking(NON_BLOCKING_CHECK, "critical", "confirmed")).toBe(true);
    expect(computeFindingBlocking(BLOCKING_CHECK, "critical", "confirmed")).toBe(true);
  });

  it("blocks on a confirmed high only on a gated check", () => {
    expect(computeFindingBlocking(BLOCKING_CHECK, "high", "confirmed")).toBe(true);
    expect(computeFindingBlocking(NON_BLOCKING_CHECK, "high", "confirmed")).toBe(false);
  });

  it("never blocks below high", () => {
    for (const severity of ["medium", "low", "informational"] as const) {
      expect(computeFindingBlocking(BLOCKING_CHECK, severity, "confirmed"), severity).toBe(false);
    }
  });
});

describe("finding validation", () => {
  it("accepts a well-formed finding", () => {
    expect(validateFinding(makeFinding())).toEqual({ ok: true, failures: [] });
  });

  it("rejects an inflated severity label", () => {
    // The whole point of the derived model: an executor cannot promote its own
    // finding by writing a bigger word next to the same observations.
    const result = validateFinding(makeFinding({ severity: "critical" }));

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain('stores severity "critical"');
  });

  it("rejects a hand-set blocking flag", () => {
    const result = validateFinding(
      makeFinding({
        rubricCheckId: "deps.known_vulnerable_dependencies",
        dimension: "dependency_and_supply_chain",
        impact: "serious",
        exploitability: "remote_unauthenticated",
        confidence: "confirmed",
        severity: "high",
        blocking: true,
      }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("stores blocking=true");
  });

  it("rejects a finding on an unknown rubric check", () => {
    const result = validateFinding(makeFinding({ rubricCheckId: "made.up_check" }));

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("unknown rubric check");
  });

  it("rejects a dimension that disagrees with its check", () => {
    const result = validateFinding(makeFinding({ dimension: "ai_boundary" }));

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("belongs to");
  });

  it("requires an unconfirmed finding to say what is unproven", () => {
    const result = validateFinding(
      makeFinding({ confidence: "possible", severity: "medium", blocking: false, residualUncertainty: "  " }),
    );

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("residual uncertainty");
  });

  it("requires a confirmed finding to cite a location", () => {
    const result = validateFinding(makeFinding({ locations: [] }));

    expect(result.ok).toBe(false);
    expect(result.failures.join(" ")).toContain("must cite at least one location");
  });
});

describe("finding schema boundary", () => {
  it("refuses an excerpt that still holds a credential", () => {
    const parsed = releaseRescueFindingV1Schema.safeParse(
      makeFinding({
        locations: [{ path: "src/pay.ts", startLine: 1, endLine: 1, excerpt: "sk_live_abcdefghijklmnopqrstuvwx" }],
      }),
    );

    expect(parsed.success).toBe(false);
  });

  it("accepts an excerpt that was redacted", () => {
    const parsed = releaseRescueFindingV1Schema.safeParse(
      makeFinding({
        locations: [
          { path: "src/pay.ts", startLine: 1, endLine: 1, excerpt: "const key = [REDACTED:stripe_key];" },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
  });

  it("refuses paths that leave the reviewed repository", () => {
    for (const path of ["/etc/passwd", "../../secrets.env", "https://example.com/x"]) {
      const parsed = releaseRescueFindingV1Schema.safeParse(
        makeFinding({ locations: [{ path, startLine: null, endLine: null, excerpt: null }] }),
      );
      expect(parsed.success, path).toBe(false);
    }
  });

  it("refuses a line range that runs backwards", () => {
    const parsed = releaseRescueFindingV1Schema.safeParse(
      makeFinding({ locations: [{ path: "src/a.ts", startLine: 40, endLine: 2, excerpt: null }] }),
    );

    expect(parsed.success).toBe(false);
  });
});
