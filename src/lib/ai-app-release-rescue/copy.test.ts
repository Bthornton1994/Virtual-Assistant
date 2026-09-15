import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_NON_CLAIMS, REPORT_LIMITATIONS_VERBATIM } from "@/lib/ai-app-release-rescue/constants";

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
});
