import { describe, expect, it } from "vitest";
import { checkEconomicEnvelope, validateEconomicEnvelope } from "@/lib/economic-envelope";

const ZERO_TOTALS = {
  humanMinutes: 0,
  ownerMinutes: 0,
  aiCostMicros: 0,
  toolCostMicros: 0,
};

function failuresOf(result: { ok: boolean; failures?: string[] }): string {
  return result.ok ? "" : result.failures!.join(" ");
}

describe("economic envelope leftover shape and alias gates", () => {
  it("refuses a non-object envelope instead of treating it as uncapped", () => {
    for (const input of [null, undefined, [], "USD", 30, true]) {
      const check = validateEconomicEnvelope(input);
      expect(check.ok, `expected ${String(input)} to fail`).toBe(false);
      expect(failuresOf(check)).toContain("JSON object");
    }
  });

  it("accepts matching camelCase and snake_case ceilings and the remaining human-minutes alias", () => {
    const matching = validateEconomicEnvelope({
      maxHumanMinutes: 10,
      max_human_minutes: 10,
      maxOwnerMinutes: 4,
      max_owner_minutes: 4,
    });
    expect(matching).toEqual({
      ok: true,
      limits: { maxHumanMinutes: 10, maxOwnerMinutes: 4 },
    });

    const humanAlias = validateEconomicEnvelope({ max_human_minutes: 12.5 });
    expect(humanAlias).toEqual({ ok: true, limits: { maxHumanMinutes: 12.5 } });
  });

  it("still accepts unknown recording flags while refusing non-finite reserved ceilings", () => {
    expect(validateEconomicEnvelope({ record_owner_minutes: true, track_human_minutes: "yes" }).ok).toBe(true);

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const human = validateEconomicEnvelope({ maxHumanMinutes: value });
      expect(human.ok).toBe(false);
      expect(failuresOf(human)).toContain("maxHumanMinutes");

      const ai = validateEconomicEnvelope({ maxAiCostMicros: value });
      expect(ai.ok).toBe(false);
      expect(failuresOf(ai)).toContain("maxAiCostMicros");
    }
  });
});

describe("economic envelope leftover observed-total gates", () => {
  it("refuses string and boolean totals instead of coercing them to zero", () => {
    const strings = checkEconomicEnvelope(
      { maxHumanMinutes: 10 },
      {
        humanMinutes: "0" as unknown as number,
        ownerMinutes: 0,
        aiCostMicros: 0,
        toolCostMicros: 0,
      },
    );
    expect(strings.ok).toBe(false);
    expect(failuresOf(strings)).toContain("humanMinutes");

    const flags = checkEconomicEnvelope(
      {},
      {
        humanMinutes: 0,
        ownerMinutes: false as unknown as number,
        aiCostMicros: 0,
        toolCostMicros: 0,
      },
    );
    expect(flags.ok).toBe(false);
    expect(failuresOf(flags)).toContain("ownerMinutes");
  });

  it("reports both a malformed envelope and malformed totals instead of stopping at the first", () => {
    const check = checkEconomicEnvelope(
      { maxHumanMinutes: "30" },
      { ...ZERO_TOTALS, toolCostMicros: 1.5 },
    );
    expect(check.ok).toBe(false);
    const failures = failuresOf(check);
    expect(failures).toContain("maxHumanMinutes");
    expect(failures).toContain("toolCostMicros");
  });
});
