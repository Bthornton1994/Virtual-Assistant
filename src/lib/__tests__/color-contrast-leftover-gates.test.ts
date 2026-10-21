import { describe, expect, it } from "vitest";
import { contrastRatio, parseCssHexToken, relativeLuminance } from "@/lib/color-contrast";

describe("color-contrast leftover hex and token gates", () => {
  it("refuses leftover 3-digit, 8-digit, and non-hex colors instead of computing luminance", () => {
    expect(() => relativeLuminance("#fff")).toThrow(/expected 6-digit hex/);
    expect(() => relativeLuminance("#ffffffff")).toThrow(/expected 6-digit hex/);
    expect(() => relativeLuminance("rgb(255,255,255)")).toThrow(/expected 6-digit hex/);
    expect(() => relativeLuminance("")).toThrow(/expected 6-digit hex/);
    expect(() => contrastRatio("#fff", "#000000")).toThrow(/expected 6-digit hex/);
  });

  it("accepts leftover 6-digit hex with or without a leading hash", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
  });

  it("refuses leftover missing CSS tokens and leftover names that are not 6-digit hex", () => {
    expect(parseCssHexToken(":root { --accent: #112233; }", "accent")).toBe("#112233");
    expect(() => parseCssHexToken(":root { --accent: #112233; }", "gold")).toThrow(/missing CSS token --gold/);
    expect(() => parseCssHexToken(":root { --accent: #fff; }", "accent")).toThrow(/missing CSS token --accent/);
  });
});
