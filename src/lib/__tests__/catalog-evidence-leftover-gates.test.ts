import { describe, expect, it } from "vitest";
import { authorityReportSchema } from "@/lib/catalog-evidence-shared";
import {
  validateCatalogEvidencePacket,
  validateEvidenceUrl,
} from "@/lib/catalog-evidence-validator";
import {
  APPROVED_LIST_URL,
  MANUFACTURER_URL,
  ZERO_AUTHORITY,
  approvedListSource,
  catalogFieldCorrection,
  manufacturerSource,
  packet,
  product,
} from "@/lib/__tests__/catalog-evidence-fixtures";

function failuresMatching(result: { hardFailures: string[] }, pattern: RegExp) {
  return result.hardFailures.filter((failure) => pattern.test(failure));
}

describe("catalog evidence leftover URL and authority gates", () => {
  it("rejects an evidence URL that contains internal whitespace", () => {
    const spaced = validateEvidenceUrl("https://example.com/path with space");
    expect(spaced).toEqual({ ok: false, reason: "contains whitespace" });

    const tabbed = validateEvidenceUrl("https://example.com/path\tfile");
    expect(tabbed).toEqual({ ok: false, reason: "contains whitespace" });
  });

  it("rejects a catalog-field correction to Approvals regardless of spelling", () => {
    for (const field of ["Approvals", "APPROVALS"]) {
      const result = validateCatalogEvidencePacket(
        packet({
          products: [
            product({
              primarySources: [manufacturerSource(), approvedListSource()],
              federationEvidence: [
                {
                  federation: "IPF",
                  status: "approved-list",
                  scope: "exact-configuration",
                  basis: "Listed.",
                  sourceUrls: [APPROVED_LIST_URL],
                },
              ],
              candidateCorrections: [
                catalogFieldCorrection({ field, proposedValue: true, sourceUrls: [APPROVED_LIST_URL] }),
              ],
            }),
          ],
        }),
      );
      expect(result.hardGatePass, field).toBe(false);
      expect(failuresMatching(result, /File this as a federation-status correction/)).toHaveLength(1);
    }
  });

  it("schema-rejects extra authority-report keys and negative action counts", () => {
    const extra = authorityReportSchema.safeParse({ ...ZERO_AUTHORITY, stealthPurchases: 1 });
    expect(extra.success).toBe(false);

    const negative = authorityReportSchema.safeParse({ ...ZERO_AUTHORITY, purchasesMade: -1 });
    expect(negative.success).toBe(false);

    const packetExtra: unknown = {
      ...packet(),
      authorityReport: { ...ZERO_AUTHORITY, stealthPurchases: 1 },
    };
    const extraResult = validateCatalogEvidencePacket(packetExtra);
    expect(extraResult.hardGatePass).toBe(false);
    expect(extraResult.metrics.schemaViolationCount).toBeGreaterThan(0);

    const packetNegative: unknown = {
      ...packet(),
      authorityReport: { ...ZERO_AUTHORITY, purchasesMade: -1 },
    };
    const negativeResult = validateCatalogEvidencePacket(packetNegative);
    expect(negativeResult.hardGatePass).toBe(false);
    expect(negativeResult.metrics.schemaViolationCount).toBeGreaterThan(0);
  });

  it("still accepts a plain https manufacturer URL", () => {
    expect(validateEvidenceUrl(MANUFACTURER_URL)).toEqual({ ok: true });
  });
});
