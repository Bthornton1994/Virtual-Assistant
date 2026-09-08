/**
 * Evaluation clock for deterministic expiry checks.
 * Independent of report `generatedAt`, which reflects real invocation time.
 *
 * Fail-closed: malformed or non-finite ISO timestamps are rejected.
 * Callers must not skip evidence expiry when the clock is invalid.
 */

import { z } from "zod";

export const DEFAULT_EVALUATION_CLOCK = "2026-09-08T16:00:00.000Z";

export const EVALUATION_CLOCK_ERROR_CODE = "INVALID_EVALUATION_CLOCK" as const;

const evaluationClockSchema = z.iso.datetime({ offset: true });

export type EvaluationClockValidation =
  | { ok: true; clock: string; epochMs: number }
  | { ok: false; code: typeof EVALUATION_CLOCK_ERROR_CODE; reason: string };

export class EvaluationClockError extends Error {
  readonly code = EVALUATION_CLOCK_ERROR_CODE;

  constructor(reason: string) {
    super(reason);
    this.name = "EvaluationClockError";
  }
}

/**
 * Validate an evaluation clock. Accepts only finite ISO-8601 datetimes with offset
 * (same contract family as `isoDateTimeSchema` elsewhere in the repo).
 */
export function validateEvaluationClock(input: unknown): EvaluationClockValidation {
  if (typeof input !== "string") {
    return {
      ok: false,
      code: EVALUATION_CLOCK_ERROR_CODE,
      reason: "evaluationClock must be a non-empty ISO-8601 datetime string with offset.",
    };
  }

  const trimmed = input.trim();
  if (!trimmed || trimmed !== input) {
    return {
      ok: false,
      code: EVALUATION_CLOCK_ERROR_CODE,
      reason: "evaluationClock must be a non-empty ISO-8601 datetime string with offset (no surrounding whitespace).",
    };
  }

  const parsed = evaluationClockSchema.safeParse(trimmed);
  if (!parsed.success) {
    return {
      ok: false,
      code: EVALUATION_CLOCK_ERROR_CODE,
      reason: `evaluationClock is not a valid ISO-8601 datetime with offset: ${JSON.stringify(trimmed)}.`,
    };
  }

  const epochMs = Date.parse(parsed.data);
  if (!Number.isFinite(epochMs)) {
    return {
      ok: false,
      code: EVALUATION_CLOCK_ERROR_CODE,
      reason: `evaluationClock parsed to a non-finite timestamp: ${JSON.stringify(trimmed)}.`,
    };
  }

  return { ok: true, clock: parsed.data, epochMs };
}

/** Resolve a caller-supplied clock or the default. Throws EvaluationClockError if invalid. */
export function requireEvaluationClock(input: string | undefined): { clock: string; epochMs: number } {
  const candidate = input ?? DEFAULT_EVALUATION_CLOCK;
  const validated = validateEvaluationClock(candidate);
  if (!validated.ok) {
    throw new EvaluationClockError(validated.reason);
  }
  return { clock: validated.clock, epochMs: validated.epochMs };
}
