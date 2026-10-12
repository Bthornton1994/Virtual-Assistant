import { describe, expect, it } from "vitest";
import { generatedValueIsNotWhatItClaims } from "@/lib/release-rescue-field-policy";
import { HOLD_REASONS, sanitizeReportInput } from "@/lib/release-rescue-pipeline";

describe("Release Rescue leftover hold gates", () => {
  it("records an ambiguous clearance as a hold without a delivery-redaction path", () => {
    const { value, holds, redactedPaths } = sanitizeReportInput({
      note: "Auth: Clerk. Payments: Stripe.",
    });

    expect(holds).toEqual([
      expect.objectContaining({
        path: "$.note",
        classification: "ambiguous_secret_candidate",
        reason: HOLD_REASONS.ambiguous,
      }),
    ]);
    expect(redactedPaths).toEqual([]);
    expect(value.note).toContain("[REDACTED:assigned_secret]");
    expect(value.note).not.toContain("Clerk");
  });

  it("closes hold reasons to the two owned sentences, including trailing-space lookalikes", () => {
    expect(generatedValueIsNotWhatItClaims("$.unresolvedHolds[].reason", HOLD_REASONS.credential_evidence)).toBeNull();
    expect(generatedValueIsNotWhatItClaims("$.unresolvedHolds[].reason", HOLD_REASONS.ambiguous)).toBeNull();

    const padded = HOLD_REASONS.credential_evidence + " ";
    const wrong = generatedValueIsNotWhatItClaims("$.unresolvedHolds[].reason", padded);
    expect(wrong).toMatch(/is not one of the 2 values/);
    expect(wrong).not.toContain(padded);
  });
});
