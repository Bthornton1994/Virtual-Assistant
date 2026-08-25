import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractJsonObject, parseExtractedJson } from "@/lib/work-cell-json";

const packet = '{"schemaVersion":"catalog-evidence-packet/v1","runId":"abc"}';

describe("work-cell JSON extract", () => {
  it("accepts a bare JSON object", () => {
    const parsed = parseExtractedJson(packet);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect((parsed.value as { runId: string }).runId).toBe("abc");
  });

  it("strips Hermes chatter before and after the object", () => {
    const parsed = parseExtractedJson(`I'll load the skill.\n${packet}\nDone.`);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect((parsed.value as { schemaVersion: string }).schemaVersion).toBe("catalog-evidence-packet/v1");
  });

  it("does not repair truncated JSON", () => {
    expect(extractJsonObject('{"schemaVersion":"catalog-evidence-packet/v1"').ok).toBe(false);
  });

  it("rejects empty paste", () => {
    expect(parseExtractedJson("   ").ok).toBe(false);
  });

  it("prefers the schemaVersion object when chatter contains other braces", () => {
    const parsed = parseExtractedJson(`note {not-json}\n${packet}`);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect((parsed.value as { runId: string }).runId).toBe("abc");
  });

  it("extracts a catalog-record map that has no schemaVersion", () => {
    const parsed = parseExtractedJson('Here you go\n{"ks-sbd-5mm":{"price":89.99}}\n');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect((parsed.value as { "ks-sbd-5mm": { price: number } })["ks-sbd-5mm"].price).toBe(89.99);
    }
  });

  it("keeps string contents with braces intact", () => {
    const parsed = parseExtractedJson('{"schemaVersion":"catalog-evidence-packet/v1","reason":"uses {exact} identity"}');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect((parsed.value as { reason: string }).reason).toBe("uses {exact} identity");
  });

  it("is wired into packet ingest and freeze without repairing values", () => {
    const workCell = readFileSync(resolve(process.cwd(), "src/lib/work-cell.ts"), "utf8");
    const actions = readFileSync(resolve(process.cwd(), "src/app/actions/work-cell.ts"), "utf8");
    expect(workCell).toMatch(/parseExtractedJson/);
    expect(actions).toMatch(/parseExtractedJson/);
    expect(workCell).toMatch(/Field values are never repaired/);
  });
});
