import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_NON_CLAIMS, REPORT_LIMITATIONS_VERBATIM } from "@/lib/ai-app-release-rescue/constants";
import { RELEASE_RESCUE_RUBRIC_V1, RUBRIC_DIMENSIONS } from "@/lib/release-rescue-rubric";

const SURFACE_FILES = [
  "src/app/(marketing)/ai-app-release-rescue/page.tsx",
  "src/components/ai-app-release-rescue/intake-form.tsx",
  "src/components/ai-app-release-rescue/report-view.tsx",
  "src/components/ai-app-release-rescue/non-claims.tsx",
];

describe("rescue customer copy", () => {
  it("keeps the verbatim limitations text in the shared callout", () => {
    const callout = readFileSync(resolve(process.cwd(), "src/components/ai-app-release-rescue/non-claims.tsx"), "utf8");
    expect(callout).toMatch(/REPORT_LIMITATIONS_VERBATIM/);
    expect(REPORT_LIMITATIONS_VERBATIM).toMatch(/not a penetration test/i);
    expect(CANONICAL_NON_CLAIMS).toHaveLength(4);
  });

  it("does not claim certification, guarantees, or paying customers on offer surfaces", () => {
    for (const file of SURFACE_FILES) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/penetration test of your/i);
      expect(source).not.toMatch(/we certify/i);
      expect(source).not.toMatch(/guarantees the absence/i);
      expect(source).not.toMatch(/trusted by/i);
      expect(source).not.toMatch(/paying customers/i);
      expect(source).not.toMatch(/SOC 2 certified/i);
    }
  });

  it("does not promise a numeric score the report contract cannot produce", () => {
    // The rubric records an outcome and evidence per check. It has no 1-5 score,
    // and a marketing page that advertised one would be selling a deliverable
    // the pipeline cannot make.
    for (const file of [...SURFACE_FILES, "src/components/ai-app-release-rescue/offer-pricing.tsx"]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source, file).not.toMatch(/1\u20135 score|1-5 score|out of 5|\/5\b/i);
    }
  });

  it("states the rubric size that the rubric actually has", () => {
    const landing = readFileSync(
      resolve(process.cwd(), "src/app/(marketing)/ai-app-release-rescue/page.tsx"),
      "utf8",
    );
    expect(RELEASE_RESCUE_RUBRIC_V1).toHaveLength(24);
    expect(RUBRIC_DIMENSIONS).toHaveLength(9);
    expect(landing).toMatch(/Twenty-four checks across nine areas/);
  });
});
