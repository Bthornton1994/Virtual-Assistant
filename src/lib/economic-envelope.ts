export const ECONOMIC_ENVELOPE_LIMIT_KEYS = [
  "maxHumanMinutes",
  "maxOwnerMinutes",
  "maxAiCostMicros",
  "maxToolCostMicros",
] as const;

export type EconomicEnvelopeLimitKey = (typeof ECONOMIC_ENVELOPE_LIMIT_KEYS)[number];

export type EconomicEnvelopeLimits = Partial<Record<EconomicEnvelopeLimitKey, number>>;

export type EconomicTotals = {
  humanMinutes: number;
  ownerMinutes: number;
  aiCostMicros: number;
  toolCostMicros: number;
};

export type EconomicEnvelopeValidation =
  | { ok: true; limits: EconomicEnvelopeLimits }
  | { ok: false; failures: string[] };

type LimitDefinition = {
  totalKey: keyof EconomicTotals;
  integer: boolean;
};

const LIMIT_DEFINITIONS: Record<EconomicEnvelopeLimitKey, LimitDefinition> = {
  maxHumanMinutes: { totalKey: "humanMinutes", integer: false },
  maxOwnerMinutes: { totalKey: "ownerMinutes", integer: false },
  maxAiCostMicros: { totalKey: "aiCostMicros", integer: true },
  maxToolCostMicros: { totalKey: "toolCostMicros", integer: true },
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function validateTotalValue(key: keyof EconomicTotals, value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return `Economic total ${key} must be a finite non-negative number.`;
  }
  if ((key === "aiCostMicros" || key === "toolCostMicros") && !Number.isInteger(value)) {
    return `Economic total ${key} must be a non-negative integer.`;
  }
  return null;
}

/**
 * Validates the reserved numeric keys in a Delegation Spec economic envelope.
 *
 * Existing envelopes may contain non-numeric recording flags such as
 * record_human_minutes. Unknown keys remain accepted for backward compatibility;
 * only the reserved max* keys are interpreted as ceilings.
 */
export function validateEconomicEnvelope(input: unknown): EconomicEnvelopeValidation {
  if (!isObject(input)) {
    return { ok: false, failures: ["economicEnvelope must be a JSON object."] };
  }

  const limits: EconomicEnvelopeLimits = {};
  const failures: string[] = [];

  for (const key of ECONOMIC_ENVELOPE_LIMIT_KEYS) {
    if (!hasOwn(input, key)) continue;

    const value = input[key];
    const definition = LIMIT_DEFINITIONS[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      failures.push(
        definition.integer
          ? `economicEnvelope.${key} must be a non-negative integer.`
          : `economicEnvelope.${key} must be a finite non-negative number.`,
      );
      continue;
    }
    if (definition.integer && !Number.isInteger(value)) {
      failures.push(`economicEnvelope.${key} must be a non-negative integer.`);
      continue;
    }
    limits[key] = value;
  }

  return failures.length ? { ok: false, failures } : { ok: true, limits };
}

/**
 * Checks observed run economics against the numeric ceilings declared by its
 * governing Delegation Spec. Equality is allowed. An absent ceiling is not an
 * implicit zero; it means that dimension has no numeric cap in this spec.
 */
export function checkEconomicEnvelope(
  envelope: unknown,
  totals: EconomicTotals,
): EconomicEnvelopeValidation {
  const envelopeCheck = validateEconomicEnvelope(envelope);
  const failures = envelopeCheck.ok ? [] : [...envelopeCheck.failures];

  for (const [key, value] of Object.entries(totals) as Array<[keyof EconomicTotals, number]>) {
    const failure = validateTotalValue(key, value);
    if (failure) failures.push(failure);
  }

  if (!envelopeCheck.ok || failures.length) {
    return { ok: false, failures };
  }

  for (const key of ECONOMIC_ENVELOPE_LIMIT_KEYS) {
    const limit = envelopeCheck.limits[key];
    if (limit === undefined) continue;

    const actual = totals[LIMIT_DEFINITIONS[key].totalKey];
    if (actual > limit) {
      failures.push(
        `Economic envelope ${key} exceeded: actual ${actual} is greater than limit ${limit}.`,
      );
    }
  }

  return failures.length ? { ok: false, failures } : { ok: true, limits: envelopeCheck.limits };
}
