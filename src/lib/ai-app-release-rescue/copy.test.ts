import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_NON_CLAIMS, REPORT_LIMITATIONS_VERBATIM, formatUsd } from "@/lib/ai-app-release-rescue/constants";
import { RELEASE_RESCUE_RUBRIC_V1, RUBRIC_DIMENSIONS } from "@/lib/release-rescue-rubric";
import {
  DECLARED_CLAIM_BEARING_FILES,
  RELEASE_RESCUE_SURFACE_FILES,
  readSurface,
  visibleStrings,
} from "@/lib/__tests__/release-rescue-surface-files";

// The SECOND hand-written surface list this workstream kept, found by an audit
// one directory away from the first. It named four files and applied the
// certification / guarantee / numeric-score / ready-stamp rules only to those,
// so `demo/page.tsx`, `demo/report/page.tsx`, `demo/[id]/page.tsx`,
// `rubric-checklist.tsx`, `constants.ts` and `payment.ts` were exempt from all
// of them. Fixing the discovery in one test file and leaving the other is how
// the same defect survives its own remedy.
//
// Both now read the same discovered set.
const SURFACE_FILES = RELEASE_RESCUE_SURFACE_FILES;
const CHECKED_FILES = SURFACE_FILES.filter((file) => !(file in DECLARED_CLAIM_BEARING_FILES));

describe("rescue customer copy", () => {
  it("keeps the verbatim limitations text in the shared callout", () => {
    const callout = readFileSync(resolve(process.cwd(), "src/components/ai-app-release-rescue/non-claims.tsx"), "utf8");
    expect(callout).toMatch(/REPORT_LIMITATIONS_VERBATIM/);
    expect(REPORT_LIMITATIONS_VERBATIM).toMatch(/not a penetration test/i);
    expect(CANONICAL_NON_CLAIMS).toHaveLength(4);
  });

  it("does not claim certification, guarantees, or paying customers on offer surfaces", () => {
    // These read the VISIBLE STRINGS, not raw source, for the same reason the
    // claim guard does. Run over raw source across the whole customer-reachable
    // graph they fire on `release-rescue-intake.ts` — which holds "soc 2
    // certified" because it IS the prohibited-claims list — and on markup that
    // merely contains the characters. A rule that reads code cannot tell a
    // rendered promise from the vocabulary used to forbid one.
    for (const file of CHECKED_FILES) {
      for (const text of visibleStrings(readSurface(file))) {
        expect(text, file).not.toMatch(/penetration test of your/i);
        expect(text, file).not.toMatch(/we certify/i);
        expect(text, file).not.toMatch(/guarantees the absence/i);
        expect(text, file).not.toMatch(/trusted by/i);
        expect(text, file).not.toMatch(/paying customers/i);
        expect(text, file).not.toMatch(/SOC 2 certified/i);
      }
    }
  });

  it("does not promise a numeric score the report contract cannot produce", () => {
    // The rubric records an outcome and evidence per check. It has no 1-5 score,
    // and a marketing page that advertised one would be selling a deliverable
    // the pipeline cannot make.
    // `\/5\b` was the original rule and it is too broad for a set this size: it
    // matches the Tailwind class `hover:bg-black/5`. A score has a digit in
    // front of the slash, so that is what it asks for now.
    for (const file of CHECKED_FILES) {
      for (const text of visibleStrings(readSurface(file))) {
        expect(text, file).not.toMatch(/1\u20135 score|1-5 score|out of 5|\d\s*\/\s*5\b/i);
      }
    }
  });

  it("states the rubric size that the rubric actually has", () => {
    const landing = readFileSync(
      resolve(process.cwd(), "src/app/(marketing)/ai-app-release-rescue/page.tsx"),
      "utf8",
    );
    expect(RELEASE_RESCUE_RUBRIC_V1).toHaveLength(32);
    expect(RUBRIC_DIMENSIONS).toHaveLength(12);
    expect(landing).toMatch(/Thirty-two checks across twelve areas/);
  });

  it("formats the sprint price with a thousands separator", () => {
    expect(formatUsd(1250)).toBe("$1,250");
    expect(formatUsd(299)).toBe("$299");
  });

  it("does not sell a ready/not-ready stamp the report contract cannot produce", () => {
    const files = [
      ...SURFACE_FILES,
      "src/components/ai-app-release-rescue/offer-pricing.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/whether this web app is ready to ship/i);
      expect(source, file).not.toMatch(/ready, ready with caveats, or not ready/i);
      expect(source, file).not.toMatch(/A readiness call/);
    }
  });
});
