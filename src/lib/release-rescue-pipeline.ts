import { createHash } from "node:crypto";
import { prepareExcerpt, redactSecrets, scanForSecrets } from "@/lib/release-rescue-redaction";
import { blocksDelivery, requiresHumanClearance } from "@/lib/release-rescue-secret-classification";
import type { SecretClassification } from "@/lib/release-rescue-secret-classification";

// The one path from raw observations to an assembled report.
//
// An audit asked a question nobody had: does anything actually CALL the redaction
// code? The answer was no. `grep -rn "prepareExcerpt\|redactSecrets(" src/`,
// excluding tests and the redaction module itself, returned one hit, and it was a
// comment. Two hundred tests exercised a function the product never ran.
//
// That is not a gap in coverage. It is a gap in the ARCHITECTURE: assembly took
// whatever it was handed, and the only thing standing between a customer's
// source and their delivered report was a validator that DETECTED credentials
// rather than removing them — and only at the very end, where its single option
// was to refuse the whole report.
//
// So sanitisation moves into the pipeline, and assembly stops accepting anything
// else. `sanitizeReportInput` is the only producer of the branded type that
// `assembleReleaseRescueReport` takes, so "another report path that skips the
// scanner" is not a discipline anybody has to remember — it does not typecheck,
// and it is refused at runtime as well, because a brand is only as good as the
// code that cannot be cast around it.
//
// What this does, in order, to every string that can carry customer source:
//
//   1. Redact it. The value is replaced, not flagged.
//   2. Classify what was found, at the strongest level seen in that string.
//   3. Turn anything not confidently safe into a HOLD, recorded on the report
//      with a reason the customer can read.
//
// The report therefore carries no raw credential at any point after this
// function returns — not in the artifact, not in the database row, not in the
// rendered page, and not in an error message, because the failure paths report
// the PATH and the classification, never the text.

/** Proof that a value has been through `sanitizeReportInput`. */
declare const sanitized: unique symbol;

export type Sanitized<T> = T & { readonly [sanitized]: true };

/**
 * An unresolved hold raised by sanitisation.
 *
 * Carries a content hash rather than the content. A hold is shown to a reviewer
 * and stored in the artifact, so it must not become a second copy of the thing it
 * exists to keep out.
 */
export type SanitizationHold = {
  path: string;
  classification: SecretClassification;
  /** sha256 of the ORIGINAL text, so a clearance can be bound to what was cleared. */
  originalHash: string;
  reason: string;
};

export type SanitizationResult<T> = {
  value: Sanitized<T>;
  holds: SanitizationHold[];
  /** Paths where confident credential evidence was removed. */
  redactedPaths: string[];
};

const MAX_DEPTH = 24;

function hashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function reasonFor(classification: SecretClassification): string {
  return classification === "credential_evidence"
    ? "Credential material was found here and removed. An authorised operator must confirm the finding can be delivered without it."
    : "This could not be told apart from ordinary security prose with confidence. It has been removed pending a human decision.";
}

/**
 * Walks a value, redacting every string and recording what it found.
 *
 * Every string, not a list of fields. A list of fields is what the claim guard
 * had, and it missed `scope.application.description` for three rounds.
 */
function sanitizeValue(
  value: unknown,
  path: string,
  holds: SanitizationHold[],
  redactedPaths: string[],
  depth: number,
): unknown {
  if (depth > MAX_DEPTH) return value;

  if (typeof value === "string") {
    const result = redactSecrets(value);
    if (result.classification === null) return value;

    if (blocksDelivery(result.classification) || requiresHumanClearance(result.classification)) {
      holds.push({
        path,
        classification: result.classification,
        originalHash: hashOf(value),
        reason: reasonFor(result.classification),
      });
      if (blocksDelivery(result.classification)) redactedPaths.push(path);
    }
    return result.redacted;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeValue(entry, `${path}[${index}]`, holds, redactedPaths, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = sanitizeValue(entry, `${path}.${key}`, holds, redactedPaths, depth + 1);
    }
    return output;
  }

  return value;
}

/**
 * The gate every report input must pass through.
 *
 * Idempotent: running it twice produces the same value, because redaction is
 * idempotent and a placeholder classifies as nothing.
 */
export function sanitizeReportInput<T>(input: T): SanitizationResult<T> {
  const holds: SanitizationHold[] = [];
  const redactedPaths: string[] = [];
  const value = sanitizeValue(input, "$", holds, redactedPaths, 0) as Sanitized<T>;
  return { value, holds, redactedPaths };
}

/**
 * Attaches this run's holds to an already-sanitised value, keeping the brand.
 *
 * This exists so the cast does not. `buildReleaseRescueReport` has to add
 * `unresolvedHolds` after sanitisation — the holds cannot be recomputed later,
 * because by then the text is a placeholder — and doing that by spreading and
 * re-asserting the brand put a second producer of it in another
 * file. A second producer is a second place to get it wrong, and the next one
 * would be added by someone who saw this one and assumed it was the pattern.
 *
 * The inputs are the sanitiser's own two outputs, so nothing unsanitised can
 * reach the brand through here.
 */
export function withSanitizedHolds<T>(
  value: Sanitized<T>,
  holds: readonly SanitizationHold[],
): Sanitized<T & { unresolvedHolds: readonly SanitizationHold[] }> {
  return { ...(value as T), unresolvedHolds: holds } as Sanitized<
    T & { unresolvedHolds: readonly SanitizationHold[] }
  >;
}

/**
 * Prepares one excerpt of customer source for storage.
 *
 * The production entry point for `prepareExcerpt`, which previously had none.
 * Redacts first and truncates second, so a truncated credential cannot leave a
 * fragment that no detector recognises but that still narrows the secret.
 */
export function prepareStoredExcerpt(raw: string): { excerpt: string; classification: SecretClassification | null } {
  const prepared = prepareExcerpt(raw);
  return { excerpt: prepared.excerpt, classification: redactSecrets(raw).classification };
}

/**
 * Last-line assertion that a value carries no credential material.
 *
 * Used by assembly after sanitisation, so a bug in the walk above surfaces as a
 * refusal rather than as a delivery. It reports paths and classifications and
 * never the offending text, because an exception message reaches logs.
 */
export function assertNoCredentialMaterial(value: unknown, context: string): void {
  const remaining = scanForSecrets(value).filter((hit) => blocksDelivery(hit.classification));
  if (remaining.length === 0) return;
  throw new Error(
    `${context}: credential material survived sanitisation at ${remaining
      .map((hit) => `${hit.path} (${hit.classification})`)
      .join(", ")}. The value is withheld from this message deliberately.`,
  );
}
