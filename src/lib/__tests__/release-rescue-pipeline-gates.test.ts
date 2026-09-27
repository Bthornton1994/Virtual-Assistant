import { describe, expect, it } from "vitest";
import { assertNoCredentialMaterial } from "@/lib/release-rescue-pipeline";

const PASSWORD = ["sword", "fish"].join("");

describe("assertNoCredentialMaterial is the last line before assembly", () => {
  it("passes empty, null, and ordinary objects", () => {
    expect(() => assertNoCredentialMaterial(null, "ctx")).not.toThrow();
    expect(() => assertNoCredentialMaterial(undefined, "ctx")).not.toThrow();
    expect(() => assertNoCredentialMaterial(12, "ctx")).not.toThrow();
    expect(() => assertNoCredentialMaterial({ ok: true, note: "Auth: Clerk." }, "ctx")).not.toThrow();
  });

  it("throws a path and classification, never the surviving secret", () => {
    let message = "";
    try {
      assertNoCredentialMaterial(
        { findings: [{ whatWeObserved: `DB_PASSWORD=${PASSWORD}` }] },
        "Release Rescue report assembly",
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("Release Rescue report assembly");
    expect(message).toContain("credential material survived sanitisation");
    expect(message).toContain("$.findings[0].whatWeObserved");
    expect(message).toContain("credential_evidence");
    expect(message).not.toContain(PASSWORD);
    expect(message).toContain("withheld from this message");
  });

  it("joins every surviving delivery-class hit in one refusal", () => {
    let message = "";
    try {
      assertNoCredentialMaterial(
        {
          findings: [{ whatWeObserved: `DB_PASSWORD=${PASSWORD}` }],
          reviewedBy: { displayName: `SMTP_PASS=${PASSWORD}` },
        },
        "assembly",
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("$.findings[0].whatWeObserved");
    expect(message).toContain("$.reviewedBy.displayName");
    expect(message).not.toContain(PASSWORD);
  });

  it("does not throw on an ambiguous candidate that is not delivery-blocking", () => {
    expect(() =>
      assertNoCredentialMaterial({ note: "Auth: Clerk. Payments: Stripe. Database: Neon." }, "assembly"),
    ).not.toThrow();
  });
});
