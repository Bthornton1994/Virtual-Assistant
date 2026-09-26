import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, parseCssHexToken } from "@/lib/color-contrast";

function mixHex(foreground: string, background: string, alpha: number): string {
  const channel = (hex: string, start: number) => parseInt(hex.slice(start, start + 2), 16);
  const fg = foreground.replace("#", "");
  const bg = background.replace("#", "");
  const out = [0, 2, 4]
    .map((start) =>
      Math.round(alpha * channel(fg, start) + (1 - alpha) * channel(bg, start))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");
  return `#${out}`;
}

describe("rescue marketing contrast tokens", () => {
  const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
  const accent = parseCssHexToken(css, "accent");
  const gold = parseCssHexToken(css, "gold");
  const goldOnAccent = parseCssHexToken(css, "gold-on-accent");
  const accentFg = parseCssHexToken(css, "accent-fg");

  it("meets WCAG AA 4.5:1 for small gold labels on accent", () => {
    expect(contrastRatio(gold, accent)).toBeCloseTo(4.21, 2);
    expect(contrastRatio(goldOnAccent, accent)).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps footer caption opacity on accent at 4.5:1", () => {
    const caption = mixHex(accentFg, accent, 0.65);
    expect(contrastRatio(caption, accent)).toBeGreaterThanOrEqual(4.5);
  });
});
