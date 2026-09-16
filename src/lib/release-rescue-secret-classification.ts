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
// about the same span the stronger one wins.
//
// THE RULE THE PREVIOUS VERSION GOT WRONG, and the one everything below is
// arranged around:
//
//   A credential-named key in a structured assignment is credential_evidence.
//   Always. The VALUE cannot lower that, and neither can a trailing comment or a
//   sentence around it.
//
// The previous version let the value's shape decide, so `DB_PASS=swordfish`
// produced `sensitive_prose` — and `sensitive_prose` drops the span entirely, so
// the password was neither redacted nor held nor reported. It shipped. Audit 5
// reproduced that in ten forms, and showed it was a REGRESSION: the commit before
// it redacted `DB_PASSWORD=swordfish` correctly.
//
// The mistake was treating "I am not sure this value is a secret" as a reason to
// do nothing, on a line that says `password=`. On a credential-named key the
// uncertainty is about how bad the leak is, never about whether to act.
//
// So value shape and sentence context are no longer permitted to downgrade
// anything. They survive in exactly one place: deciding what a BARE COLON means,
// because `:` is both YAML and English punctuation and nothing else can tell
// `db_password: hunter2` from `Password: rotation policy is weak`. Every other
// assignment syntax — `=`, `:=`, `=>`, a quoted value, a keyword form, a flag, an
// XML attribute, `.netrc`, `.pgpass`, a URL — is machine syntax that no sentence
// can be mistaken for, and on those the key alone decides.

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
 * Words common enough that seeing one as a bare-colon "value" is far better
 * explained by a sentence than by a credential.
 *
 * Used ONLY to read the bare-colon form. It can no longer downgrade a structured
 * assignment, which is what let a password through.
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

export type ValueShape = "placeholder" | "opaque" | "wordlike";

/**
 * How credential-like a value looks.
 *
 * Deliberately weak now. It answers one narrow question — is this value opaque
 * enough to settle a bare colon on its own? — and it has no authority to say a
 * value is harmless. A value cannot make `password=` safe.
 */
export function valueShape(value: string, isNonSecretValue: (candidate: string) => boolean): ValueShape {
  const trimmed = value
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .replace(/[.,!?;:]+$/, "");
  if (trimmed.length === 0 || isNonSecretValue(trimmed)) return "placeholder";

  // A QUANTITY reads as a measurement, not as entropy: `30-day`, `8-character`,
  // `24h`, `256bit`. Returning `wordlike` rather than `placeholder` is the whole
  // point — `placeholder` DROPS the span, and this is only ever consulted by the
  // bare-colon branch, where `Tokens: 30-day lifetime with no rotation.` then
  // falls through to the sentence check and is correctly left alone. A structured
  // `PGPASSWORD=123456abcdef` never reaches here at all, because structured
  // syntax ignores value shape.
  //
  // The previous fix put this in the value allowlist instead, which applies to
  // EVERY form, so `PGPASSWORD=123456abcdef` and `DB_PASSWORD=1qazXSW` were
  // dropped in silence and shipped to the customer in a deliverable report.
  if (/^[0-9]+[-_]?[a-z]+$/i.test(trimmed)) return "wordlike";

  const hasDigit = /[0-9]/.test(trimmed);
  const hasLower = /[a-z]/.test(trimmed);
  const hasUpper = /[A-Z]/.test(trimmed);
  // Word joiners are how English joins words, so they are not entropy.
  const hasSymbol = /[^A-Za-z0-9\-_.']/.test(trimmed);

  // A digit mixed with letters, or any punctuation beyond a joiner, is the
  // signature of a generated secret and is vanishingly rare in a word.
  if (hasDigit && (hasLower || hasUpper) && trimmed.length >= 6) return "opaque";
  if (hasSymbol && trimmed.length >= 6) return "opaque";
  // A long run with no word structure: base64, hex, a random string.
  if (trimmed.length >= 16 && /^[A-Za-z0-9._\-\/+=]+$/.test(trimmed)) return "opaque";

  return "wordlike";
}

/**
 * Whether the text after a candidate value continues as a sentence.
 *
 * Reads at most a bounded window: scanning to end-of-line costs O(line) per span,
 * and one span per token on a long line is quadratic.
 */
const TAIL_LOOKAHEAD = 200;

export function tailReadsAsSentence(text: string, from: number): boolean {
  const window = text.slice(from, Math.min(text.length, from + TAIL_LOOKAHEAD));
  const lineEnd = window.indexOf("\n");
  const tail = lineEnd === -1 ? window : window.slice(0, lineEnd);

  // A COMMENT is not a sentence, whatever it says.
  //
  // `DB_PASSWORD: swordfish # this is the value we use in the staging config`
  // read as prose here, and prose DROPS the span entirely, so the password
  // shipped. English does not write `#` or `//`; a config file does, and a
  // config file is exactly what a `#` on the line proves this is.
  //
  // This is the same bypass as the `valueEndsSentence` rule reverted above, one
  // comment marker instead of one full stop. Both existed because a route to
  // `sensitive_prose` is a route to silence.
  if (/^\s*(?:#|\/\/|;)/.test(tail)) return false;
  const words = tail.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 3) return false;

  const common = words.filter((word) => COMMON_PROSE_WORDS.has(word)).length;
  // At least three ordinary words, and at least two in five. A majority was too
  // strict for real sentences carrying domain nouns — "managed via environment
  // variables in the deploy pipeline" is plainly prose and only three of its
  // seven words are common ones.
  return common >= 3 && common * 5 >= words.length * 2;
}

/**
 * How the assignment was written, which is what decides its authority.
 *
 * `structured` covers every syntax that only a machine writes: `=`, `:=`, `=>`, a
 * quoted value, `ENV K V`, a command flag, an XML attribute or element, a
 * `.netrc` or `.pgpass` line, a delimited column, a URL's userinfo. No English
 * sentence is mistakable for any of them.
 *
 * `bare_colon` is the single ambiguous case, because `:` is both YAML and
 * punctuation.
 */
export type AssignmentSyntax = "structured" | "bare_colon";

/**
 * The classification of one credential-named assignment.
 *
 * Total, deterministic, and — the part that matters — monotone in the key: a
 * credential-named key never produces `sensitive_prose` under `structured`
 * syntax, whatever the value is and whatever follows it.
 */
/**
 * @param valueEndsSentence Recorded, never acted on. An earlier version of this
 * function returned `sensitive_prose` when the bare-colon value carried trailing
 * sentence punctuation, to stop `Auth: Clerk. Payments: Stripe.` being redacted
 * out of a customer's own description of their stack.
 *
 * It was a bypass. `pushSpan` DROPS a `sensitive_prose` span entirely, so
 * `password: swordfish.` produced no span at all — not redacted, not held, not
 * reported — while `password: swordfish` was caught. One full stop, and a compose
 * file's password shipped. The same trick worked with `!` and `?`.
 *
 * The parameter stays so the reasoning stays attached to the code rather than
 * only to a commit message. `Auth: Clerk.` now lands on
 * `ambiguous_secret_candidate`, which redacts it, holds it, and lets a named
 * manager clear it — a cost the customer can undo, unlike a leaked password.
 */
export function classifyAssignment(
  syntax: AssignmentSyntax,
  shape: ValueShape,
  tailIsSentence: boolean,
  valueEndsSentence = false,
): SecretClassification {
  if (shape === "placeholder") return "sensitive_prose";

  if (syntax === "structured") {
    // The key said `password`. The syntax said `=`. Nothing downstream gets a
    // vote, because this is exactly where the last version gave the value one
    // and shipped the password. `valueEndsSentence` is not consulted here
    // either: `DB_PASS=swordfish.` is still a password.
    return "credential_evidence";
  }

  // Bare colon. An opaque value settles it on its own.
  if (shape === "opaque") return "credential_evidence";

  // `valueEndsSentence` is accepted and deliberately IGNORED. See the parameter's
  // doc comment: routing it to `sensitive_prose` was a one-keystroke bypass.
  void valueEndsSentence;

  if (tailIsSentence) return "sensitive_prose";
  return "ambiguous_secret_candidate";
}
