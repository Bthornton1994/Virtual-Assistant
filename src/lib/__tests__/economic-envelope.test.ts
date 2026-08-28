import { describe, expect, it } from "vitest";
import {
  checkEconomicEnvelope,
  validateEconomicEnvelope,
} from "@/lib/economic-envelope";

const ZERO_TOTALS = {
  humanMinutes: 0,
  ownerMinutes: 0,
  aiCostMicros: 0,
  toolCostMicros: 0,
};

describe("economic envelope guard", () => {
  it("accepts legacy recording flags and absent numeric ceilings", () => {
    const envelope = validateEconomicEnvelope({
      record_human_minutes: true,
      record_ai_cost_micros: true,
    });

    expect(envelope).toEqual({ ok: true, limits: {} });
    expect(checkEconomicEnvelope({ record_tool_cost_micros: true }, {
      humanMinutes: 400,
      ownerMinutes: 20,
      aiCostMicros: 99,
      toolCostMicros: 12,
    }).ok).toBe(true);
  });

  it("accepts legacy snake_case ceiling aliases", () => {
    const check = validateEconomicEnvelope({
      max_owner_minutes: 5,
      max_ai_cost_micros: 100,
      track_tool_cost_micros: true,
    });

    expect(check).toEqual({
      ok: true,
      limits: {
        maxOwnerMinutes: 5,
        maxAiCostMicros: 100,
      },
    });
  });

  it("accepts valid ceilings and equality at the boundary", () => {
    const envelope = {
      maxHumanMinutes: 30.5,
      maxOwnerMinutes: 10,
      maxAiCostMicros: 500_000,
      maxToolCostMicros: 25_000,
    };

    expect(validateEconomicEnvelope(envelope)).toEqual({
      ok: true,
      limits: envelope,
    });
    expect(checkEconomicEnvelope(envelope, {
      humanMinutes: 30.5,
      ownerMinutes: 10,
      aiCostMicros: 500_000,
      toolCostMicros: 25_000,
    }).ok).toBe(true);
  });

  it("rejects malformed reserved ceilings and conflicting aliases", () => {
    const check = validateEconomicEnvelope({
      currency: "USD",
      record_human_minutes: true,
      maxHumanMinutes: "30",
      maxOwnerMinutes: null,
      maxAiCostMicros: 1.5,
      maxToolCostMicros: -1,
      max_owner_minutes: 6,
    });

    expect(check.ok).toBe(false);
    const failures = check.ok ? [] : check.failures.join(" ");
    expect(failures).toContain("maxHumanMinutes");
    expect(failures).toContain("maxOwnerMinutes");
    expect(failures).toContain("maxAiCostMicros");
    expect(failures).toContain("maxToolCostMicros");
    expect(failures).toContain("conflicts");
  });

  it("reports every dimension that exceeds its ceiling", () => {
    const check = checkEconomicEnvelope(
      {
        maxHumanMinutes: 1,
        maxOwnerMinutes: 2,
        maxAiCostMicros: 3,
        maxToolCostMicros: 4,
      },
      {
        humanMinutes: 2,
        ownerMinutes: 3,
        aiCostMicros: 5,
        toolCostMicros: 6,
      },
    );

    expect(check.ok).toBe(false);
    const failures = check.ok ? [] : check.failures.join(" ");
    expect(failures).toContain("maxHumanMinutes");
    expect(failures).toContain("maxOwnerMinutes");
    expect(failures).toContain("maxAiCostMicros");
    expect(failures).toContain("maxToolCostMicros");
  });

  it("rejects malformed observed totals instead of treating them as zero", () => {
    const check = checkEconomicEnvelope({}, {
      ...ZERO_TOTALS,
      aiCostMicros: 1.2,
    });

    expect(check.ok).toBe(false);
    expect(check.ok ? [] : check.failures.join(" ")).toContain("aiCostMicros");
  });
});
