import { describe, expect, it } from "vitest";
import { isValidEvidenceUrl, validateEvidenceUrl } from "@/lib/catalog-evidence-validator";
import { MANUFACTURER_URL } from "@/lib/__tests__/catalog-evidence-fixtures";

describe("catalog evidence leftover URL protocol gates", () => {
  it("refuses remaining non-https schemes and non-string values", () => {
    const leftover = [
      "data:text/plain,secret",
      "file:///etc/passwd",
      "ws://example.com/live",
      "wss://example.com/live",
      "blob:https://example.com/1",
      "about:blank",
    ];
    for (const url of leftover) {
      const checked = validateEvidenceUrl(url);
      expect(checked.ok, url).toBe(false);
      if (!checked.ok) {
        expect(checked.reason, url).toMatch(/uses protocol ".+" instead of https:/);
      }
      expect(isValidEvidenceUrl(url), url).toBe(false);
    }

    expect(isValidEvidenceUrl(null)).toBe(false);
    expect(isValidEvidenceUrl(undefined)).toBe(false);
    expect(isValidEvidenceUrl("")).toBe(false);
    expect(isValidEvidenceUrl(MANUFACTURER_URL)).toBe(true);
    expect(validateEvidenceUrl(MANUFACTURER_URL)).toEqual({ ok: true });
  });
});
