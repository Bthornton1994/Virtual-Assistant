import { describe, expect, it } from "vitest";
import {
  authorityReportSchema,
  identifierString,
  isoDateTimeSchema,
  nonEmptyString,
  sumAuthorityReport,
  urlFieldSchema,
} from "@/lib/catalog-evidence-shared";
import { ZERO_AUTHORITY } from "@/lib/__tests__/catalog-evidence-fixtures";

describe("identifierString", () => {
  it("accepts a raw identifier unchanged so later matching sees the same bytes", () => {
    const parsed = identifierString.safeParse("ks:ipf");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe("ks:ipf");
  });

  it("rejects leading or trailing whitespace instead of silently trimming", () => {
    expect(identifierString.safeParse(" ks:ipf ").success).toBe(false);
    expect(identifierString.safeParse("ks:ipf ").success).toBe(false);
    expect(identifierString.safeParse(" ks:ipf").success).toBe(false);
  });

  it("rejects empty and whitespace-only values", () => {
    expect(identifierString.safeParse("").success).toBe(false);
    expect(identifierString.safeParse("   ").success).toBe(false);
  });
});

describe("authority report contract", () => {
  it("sums every counted external action", () => {
    expect(sumAuthorityReport(ZERO_AUTHORITY)).toBe(0);
    expect(
      sumAuthorityReport({
        ...ZERO_AUTHORITY,
        externalMessagesSent: 1,
        purchasesMade: 2,
        otherExternalActions: 3,
      }),
    ).toBe(6);
  });

  it("rejects extra keys so an executor cannot smuggle an uncounted action", () => {
    const parsed = authorityReportSchema.safeParse({
      ...ZERO_AUTHORITY,
      fundsTransferred: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects negative or fractional action counts", () => {
    expect(authorityReportSchema.safeParse({ ...ZERO_AUTHORITY, purchasesMade: -1 }).success).toBe(
      false,
    );
    expect(authorityReportSchema.safeParse({ ...ZERO_AUTHORITY, purchasesMade: 1.5 }).success).toBe(
      false,
    );
  });
});

describe("shared field shapes", () => {
  it("trims prose fields but leaves URL content validation to the packet validator", () => {
    const prose = nonEmptyString.safeParse("  Direct, no exclamation points.  ");
    expect(prose.success).toBe(true);
    if (prose.success) expect(prose.data).toBe("Direct, no exclamation points.");
    expect(nonEmptyString.safeParse("   ").success).toBe(false);
    expect(urlFieldSchema.safeParse("not a url").success).toBe(true);
    expect(urlFieldSchema.safeParse("").success).toBe(false);
  });

  it("requires an ISO datetime with an offset", () => {
    expect(isoDateTimeSchema.safeParse("2026-08-23T12:00:00Z").success).toBe(true);
    expect(isoDateTimeSchema.safeParse("2026-08-23T12:00:00").success).toBe(false);
    expect(isoDateTimeSchema.safeParse("yesterday").success).toBe(false);
  });
});
