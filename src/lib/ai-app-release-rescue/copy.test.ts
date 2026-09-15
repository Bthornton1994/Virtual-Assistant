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

const CTA_FILES = [
  "src/app/(marketing)/ai-app-release-rescue/page.tsx",
  "src/app/(marketing)/ai-app-release-rescue/demo/page.tsx",
  "src/components/ai-app-release-rescue/offer-pricing.tsx",
];

function relativeLuminance(hex: string) {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

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

  it("styles navigation CTAs as links instead of nested buttons", () => {
    for (const file of CTA_FILES) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).toMatch(/buttonClassName/);
      expect(source).not.toMatch(/<Button\b/);
    }
  });

  it("keeps gold labels on accent above WCAG AA contrast", () => {
    expect(contrastRatio("#c5a46e", "#17332e")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#b0894a", "#17332e")).toBeLessThan(4.5);
    const landing = readFileSync(resolve(process.cwd(), CTA_FILES[0]), "utf8");
    const pricing = readFileSync(resolve(process.cwd(), CTA_FILES[2]), "utf8");
    expect(landing).toMatch(/text-\[#c5a46e\]/);
    expect(pricing).toMatch(/text-\[#c5a46e\]/);
  });
});
