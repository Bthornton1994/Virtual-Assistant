import { describe, expect, it } from "vitest";
import { checkPayloadHash, sha256Hex } from "@/lib/catalog-evidence-hash";

describe("catalog evidence leftover stored-hash gates", () => {
  it("treats empty, uppercase, and padded stored hashes as tampered", () => {
    const payload = { runId: "run-1", schemaVersion: "catalog-evidence-packet/v1" };
    const stored = sha256Hex(payload);

    const empty = checkPayloadHash(payload, "", "packet");
    expect(empty.tampered).toBe(true);
    if (empty.tampered) {
      expect(empty.recomputedHash).toBe(stored);
      expect(empty.failure).toMatch(/Stored packet hash "" does not match/);
    }

    const uppercase = checkPayloadHash(payload, stored.toUpperCase(), "packet");
    expect(uppercase.tampered).toBe(true);

    const padded = checkPayloadHash(payload, ` ${stored}`, "review");
    expect(padded.tampered).toBe(true);
    if (padded.tampered) {
      expect(padded.failure).toMatch(/Stored review hash/);
    }

    expect(checkPayloadHash(payload, stored, "packet")).toEqual({ tampered: false });
  });
});
