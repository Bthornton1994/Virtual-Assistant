import { describe, expect, it } from "vitest";
import { extractJsonObject, parseExtractedJson } from "@/lib/work-cell-json";

const packet = '{"schemaVersion":"catalog-evidence-packet/v1","runId":"abc"}';

describe("work-cell JSON leftover extract and parse gates", () => {
  it("refuses a non-object paste instead of coercing null, arrays, or scalars into an artifact", () => {
    expect(parseExtractedJson("null").ok).toBe(false);
    expect(parseExtractedJson("true").ok).toBe(false);
    expect(parseExtractedJson('"just a string"').ok).toBe(false);
    expect(parseExtractedJson("Here is the packet without braces").ok).toBe(false);
  });

  it("does not repair a trailing comma or a truncated nested object", () => {
    const trailing = parseExtractedJson(
      '{"schemaVersion":"catalog-evidence-packet/v1","runId":"abc",}',
    );
    expect(trailing.ok).toBe(false);
    expect(trailing.ok ? "" : trailing.error).toMatch(/not valid JSON/i);

    const nested = extractJsonObject(
      '{"schemaVersion":"catalog-evidence-packet/v1","nested":{"runId":"abc"',
    );
    expect(nested.ok).toBe(false);
    expect(nested.ok ? "" : nested.error).toMatch(/truncated/);
  });

  it("does not let an unclosed string or escaped quote end the object early", () => {
    const unclosed = extractJsonObject(
      '{"schemaVersion":"catalog-evidence-packet/v1","reason":"uses {exact} identity',
    );
    expect(unclosed.ok).toBe(false);
    expect(unclosed.ok ? "" : unclosed.error).toMatch(/truncated/);

    const escaped = parseExtractedJson(
      '{"schemaVersion":"catalog-evidence-packet/v1","reason":"say \\"hi\\" and {exact}"}',
    );
    expect(escaped.ok).toBe(true);
    if (escaped.ok) {
      expect((escaped.value as { reason: string }).reason).toBe('say "hi" and {exact}');
    }
  });

  it("extracts only the first schemaVersion object when chatter contains a second", () => {
    const parsed = parseExtractedJson(
      `${packet}\noperator note { "schemaVersion" : "forged/v1", "runId": "forged" }`,
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect((parsed.value as { runId: string }).runId).toBe("abc");
      expect((parsed.value as { schemaVersion: string }).schemaVersion).toBe(
        "catalog-evidence-packet/v1",
      );
    }
  });
});
