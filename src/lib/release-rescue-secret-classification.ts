// How confident are we that this is a credential, and what does that confidence
// entitle the pipeline to do about it?
//
// Until now there was one answer: "credential-shaped" or not, and anything
// credential-shaped hard-failed the report. That is wrong in both directions at
// once, and an audit demonstrated both in the same round:
//
//   * `DB_PASS=pr0d-Xk92mQvn7Lz` in a quoted docker-compose file was not
//     detected, and reached a `deliverable: true` report.
//   * `"Password: rotation policy is weak"` — the ordinary wording of a real
//     finding — WAS detected, and refused the $299 deliverable outright. The
//     same rule rejected `"Auth: Clerk. Payments: Stripe."` on the public intake
//     form, telling a customer describing their stack to "remove the credential".
//
// A single boolean cannot express the difference, because the difference is not
// about the KEY (both say "password") but about the VALUE and its context. So
// the answer is now three-valued, and each value carries a different authority:
//
//   credential_evidence         High confidence. Redact, and refuse delivery
//                               while it is present unredacted.
//   ambiguous_secret_candidate  Could be either. Redact for safety, do NOT
//                               hard-fail, and hold the report for a named human
//                               to clear. The customer is told a hold exists and
//                               why.
//   sensitive_prose             Security vocabulary in ordinary sentences.
//                               Preserve it exactly; it is what the report is
//                               FOR.
//
// Precedence is total and deterministic: credential_evidence beats
// ambiguous_secret_candidate beats sensitive_prose. Where two signals disagree
// about the same span the stronger one wins, so nothing is downgraded by finding
// a second, weaker reason to look at it. An ambiguous item never passes silently:
// the delivery gate refuses until it is cleared.

export const SECRET_CLASSIFICATIONS = [
  "credential_evidence",
  "ambiguous_secret_candidate",
  "sensitive_prose",
] as const;

export type SecretClassification = (typeof SECRET_CLASSIFICATIONS)[number];

/** Higher wins. Total order, so two signals on one span always resolve. */
const PRECEDENCE: Record<SecretClassification, number> = {
  credential_evidence: 3,
  ambiguous_secret_candidate: 2,
  sensitive_prose: 1,
};

export function strongerClassification(
  a: SecretClassification,
  b: SecretClassification,
): SecretClassification {
  return PRECEDENCE[a] >= PRECEDENCE[b] ? a : b;
}

/** True when this classification must stop a report reaching the customer. */
export function blocksDelivery(classification: SecretClassification): boolean {
  return classification === "credential_evidence";
}

/** True when this classification must be cleared by a human before delivery. */
export function requiresHumanClearance(classification: SecretClassification): boolean {
  return classification === "ambiguous_secret_candidate";
}

// --- Value shape ------------------------------------------------------------------

/**
 * Words common enough that seeing one as an assignment's "value" is far better
 * explained by a sentence than by a credential.
 *
 * Deliberately small and ordinary. It is not a dictionary and is not trying to
 * be: it exists to catch the shape of `Password: rotation policy is weak`, where
 * the tokens after the colon are English rather than entropy.
 */
const COMMON_PROSE_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "before", "but", "by", "can", "cannot",
  "checks", "config", "configured", "could", "customer", "data", "default", "disabled", "do",
  "does", "enabled", "every", "for", "from", "handled", "has", "have", "if", "in", "into", "is",
  "issue", "it", "its", "logic", "managed", "may", "missing", "must", "no", "none", "not", "of",
  "on", "only", "or", "our", "per", "policy", "present", "review", "reviewed", "rotated",
  "rotation", "routes", "same", "service", "set", "should", "so", "storage", "stored", "than",
  "that", "the", "their", "then", "there", "these", "they", "this", "three", "to", "two", "use",
  "used", "using", "via", "was", "we", "weak", "were", "when", "where", "which", "while", "will",
  "with", "would", "your",
]);

export type ValueShape = "placeholder" | "prose" | "ambiguous" | "credential";

/**
 * How many character classes a value draws on, as a proxy for entropy.
 *
 * Hyphens, underscores, dots and apostrophes do NOT count. They are how English
 * joins words, so counting them made `object-level` a two-class value and
 * therefore a credential — which turned "Authorization: object-level checks are
 * missing" into a delivery-blocking finding. Entropy comes from mixing letters,
 * cases and digits, not from punctuation a writer would use anyway.
 */
function characterClasses(value: string): number {
  let classes = 0;
  if (/[a-z]/.test(value)) classes += 1;
  if (/[A-Z]/.test(value)) classes += 1;
  if (/[0-9]/.test(value)) classes += 1;
  if (/[^A-Za-z0-9\-_.']/.test(value)) classes += 1;
  return classes;
}

/**
 * How credential-like a value looks, on its own.
 *
 * This is the signal the old boolean did not have. `rotation` and
 * `pr0d-Xk92mQvn7Lz` are both "the thing after `password:`"; only one of them is
 * plausibly a secret, and the difference is visible without knowing anything
 * about where it came from.
 */
export function valueShape(value: string, isNonSecretValue: (candidate: string) => boolean): ValueShape {
  const trimmed = value
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    // Sentence punctuation is not part of a value. `Auth: Clerk.` captures
    // "Clerk." because a full stop cannot terminate a value in general — a host
    // name is full of them — so it is removed here, where only the SHAPE is being
    // judged and the redaction span is already decided.
    .replace(/[.,!?;:]+$/, "");
  if (trimmed.length === 0 || isNonSecretValue(trimmed)) return "placeholder";

  // A single capitalised alphabetic word, before the entropy rules see it as
  // two character classes.
  //
  // Short ones are proper nouns: `Auth: Clerk. Payments: Stripe.` is a customer
  // answering "what is your stack?", and the intake form used to call it a
  // credential. Longer ones are genuinely undecidable — `Zephyrbolt` could be a
  // product or a weak password — which is what the ambiguous class exists for.
  if (/^[A-Z][a-z]+$/.test(trimmed)) return trimmed.length >= 8 ? "ambiguous" : "prose";

  const classes = characterClasses(trimmed);

  // Three or more character classes is the signature of a generated secret and
  // is vanishingly rare in an English word. Catches short ones like `Tr0ub4d`.
  if (classes >= 3 && trimmed.length >= 6) return "credential";
  // Two classes over a reasonable length: `s3cr3tvalue`, `hunter2hunter2`.
  if (classes >= 2 && trimmed.length >= 8) return "credential";
  // A long opaque run with no word structure: `abcdefghijklmnop`, base64, hex.
  if (trimmed.length >= 16 && /^[A-Za-z0-9._\-\/+=]+$/.test(trimmed) && !COMMON_PROSE_WORDS.has(trimmed.toLowerCase())) {
    return "credential";
  }

  // Lowercase words joined by hyphens, and short enough to be a word: prose.
  if (/^[a-z]+(?:[-'][a-z]+)*$/.test(trimmed)) {
    if (COMMON_PROSE_WORDS.has(trimmed.toLowerCase())) return "prose";
    if (trimmed.length < 12) return "prose";
  }

  return "ambiguous";
}

/**
 * Whether the text after a candidate value continues as a sentence.
 *
 * The decisive context signal, and the one that separates a finding's prose from
 * a config line. In `Authorization: object-level checks are missing on three
 * routes.` the tokens after the "value" are English; in `DB_PASS=s3cr3tvalue`
 * there are none, and in `psql --password S3cret -h db` the ones there are are
 * not words.
 */
/** How far past a value to look for a sentence. A clause is far shorter. */
const TAIL_LOOKAHEAD = 200;

export function tailReadsAsSentence(text: string, from: number): boolean {
  // Bounded. Reading to end-of-line costs O(line length) per span, and one span
  // per token on a single long line is quadratic — which is exactly what it was
  // when this function was first written: three adversarial shapes went from
  // milliseconds to seconds. Two hundred characters is far more than a sentence.
  const window = text.slice(from, Math.min(text.length, from + TAIL_LOOKAHEAD));
  const lineEnd = window.indexOf("\n");
  const tail = lineEnd === -1 ? window : window.slice(0, lineEnd);
  const words = tail.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 3) return false;

  const common = words.filter((word) => COMMON_PROSE_WORDS.has(word)).length;
  // A majority of ordinary words, and at least three of them. A config line's
  // trailing comment does not reach this; a sentence does.
  return common >= 3 && common * 2 >= words.length;
}

/**
 * The classification of one assignment-shaped hit.
 *
 * Pure and total: every combination of shape and context lands somewhere, and
 * the result never depends on evaluation order.
 */
export function classifyAssignment(shape: ValueShape, tailIsSentence: boolean): SecretClassification {
  if (shape === "placeholder") return "sensitive_prose";
  if (shape === "credential") {
    // Even inside a sentence, a value that looks generated is worth holding. It
    // is not downgraded to prose, but the sentence context drops it from
    // certainty to a hold, because a finding may legitimately quote one.
    return tailIsSentence ? "ambiguous_secret_candidate" : "credential_evidence";
  }
  if (shape === "prose") return "sensitive_prose";
  return tailIsSentence ? "sensitive_prose" : "ambiguous_secret_candidate";
}
