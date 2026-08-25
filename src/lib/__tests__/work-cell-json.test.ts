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
});
