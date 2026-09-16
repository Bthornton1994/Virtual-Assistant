import { keyLooksSecret } from "@/lib/release-rescue-redaction-keys";

// An auditor's observation DESCRIBES what was seen. It does not reproduce it.
//
// This file is the second half of the excerpt decision, and it exists because of
// what the eleventh audit found after the first half shipped. Removing
// `excerpt` closed the field the system copied source into, and the audit then
// asked the obvious next question: where does customer text live now? In
// `whatWeObserved`, `whyItMatters`, `recommendation`, `residualUncertainty` and
// an assessment's `rationale` — four thousand characters each, written by an
// executor whose single most likely finding is "a credential is hardcoded here".
//
// Measured on this tree: with a prose prefix in front of the assignment,
// 30 of 116 generated credential values reached a DELIVERABLE report with the
// value intact. The same 116 values, in the same assignment, with no prose
// prefix: 0. The detector's span extractor stops at `#`, judges the two
// characters it did capture a placeholder, and suppresses the span.
//
// The tempting fix is the terminator set. That is the seventh round of the cycle
// the owner ended, and the previous six each closed the examples the audit before
// them used. So this does not look at the VALUE at all.
//
// The rule is about the CONSTRUCT: an observation may not contain an assignment
// to a credential-named key, a credentialed URL, or a private-key header. It is
// fail-closed by construction — there is no "is this value safe?" question for a
// detector to get wrong, because there is no shape of value that clears it. An
// auditor writes "the file assigns DB_PASSWORD a literal value"; the customer
// opens `config/app.env:14` and reads it in their own checkout, where it already
// is. That is the same sentence the excerpt decision made about source windows.
//
// What this does NOT claim: that these fields cannot carry customer source at
// all. They are free text an auditor authors, and no rule short of refusing
// prose can prove a sentence is not a quotation. See the stated limit in
// `docs/AI-APP-RELEASE-RESCUE-V1.md`.

/** A refused construct. Names the construct and the key, never the value. */
export type ProseConstruct = {
  kind: "assignment" | "configuration_line" | "credentialed_url" | "private_key_block";
  /** The credential-named key, or the URL scheme. Never what followed it. */
  subject: string;
};

/** A run of characters that could be an identifier in some language. */
const TOKEN = /[A-Za-z_][A-Za-z0-9_.-]*/g;

/**
 * A capitalised English word: `Tokens`, `Passwords`, `Secrets`, `Credentials`,
 * `Auth`.
 *
 * These are subjects of sentences, and the rubric asks auditors to write exactly
 * such sentences — "Tokens: 30-day lifetime with no rotation." A rule that
 * refused them would brick correct reports, which is the other half of what the
 * tenth audit found and the more expensive half to discover in production.
 */
function isProseWord(token: string): boolean {
  return /^[A-Z][a-z]+$/.test(token);
}

/**
 * A token no English sentence contains: it has an underscore, a hyphen, a digit,
 * an internal capital, or it is shouted.
 *
 * `DB_PASSWORD`, `db_password`, `apiKey`, `PGPASSWORD`. Wherever one of these
 * appears, it is a key — its position in the line does not change that.
 */
function isIdentifierShaped(token: string): boolean {
  if (/[_\-0-9]/.test(token)) return true;
  if (token.length >= 2 && token === token.toUpperCase() && /[A-Z]/.test(token)) return true;
  return /^[a-z]+[A-Z]/.test(token);
}

/**
 * True when nothing but structure precedes the token on its line.
 *
 * `password: swordfish` at the start of a line is a config line. `API keys:
 * rotated quarterly` is a noun phrase, because a word precedes `keys` — and no
 * configuration format has a space inside a key.
 */
function inKeyPosition(line: string, index: number): boolean {
  const before = line.slice(0, index);
  return /(^|[-"'{,;:])\s*$/.test(before);
}

/** The assignment operators, minus every comparison that shares their spelling. */
function assignmentAfter(line: string, index: number): boolean {
  const rest = line.slice(index);
  const operator = /^\s*(:=|=>|={1,3}|!=|<=|>=)/.exec(rest);
  if (!operator) return false;
  if (operator[1] === ":=") return true;
  // `==`, `===`, `!=`, `<=`, `>=` and `=>` compare or point; they do not assign.
  if (operator[1] !== "=") return false;
  return rest.slice(operator[0].length).trim().length > 0;
}

function configurationValueAfter(line: string, index: number): boolean {
  const rest = line.slice(index);
  if (!rest.startsWith(":")) return false;
  if (rest.startsWith(":=")) return false;
  return rest.slice(1).trim().length > 0;
}

/**
 * The constructs an observation may not contain, in the order they appear.
 *
 * Deterministic and total. Every branch is decided by the KEY and the OPERATOR;
 * no branch reads the value.
 */
export function findQuotedCredentialConstructs(text: string): ProseConstruct[] {
  const found: ProseConstruct[] = [];

  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    found.push({ kind: "private_key_block", subject: "PRIVATE KEY" });
  }

  const url = /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@:]+:[^\s/@]+@/.exec(text);
  if (url) found.push({ kind: "credentialed_url", subject: url[1] });

  for (const line of text.split(/\r?\n/)) {
    TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN.exec(line)) !== null) {
      const token = match[0];
      if (!keyLooksSecret(token)) continue;

      const after = match.index + token.length;
      if (assignmentAfter(line, after)) {
        found.push({ kind: "assignment", subject: token });
        continue;
      }

      // A colon is both YAML and punctuation, so this arm is the narrow one: a
      // capitalised English word never triggers it, and a plain lowercase word
      // triggers it only where a key can stand.
      if (isProseWord(token)) continue;
      if (!isIdentifierShaped(token) && !inKeyPosition(line, match.index)) continue;
      if (configurationValueAfter(line, after)) {
        found.push({ kind: "configuration_line", subject: token });
      }
    }
  }

  return found;
}

const GUIDANCE: Readonly<Record<ProseConstruct["kind"], string>> = {
  assignment:
    'name the setting and cite its location instead of writing the assignment — "the file assigns %s a literal value"',
  configuration_line:
    'name the setting and cite its location instead of copying the configuration line — "%s is set to a literal value"',
  credentialed_url:
    "cite the file and line that holds the URL instead of reproducing it with its credentials",
  private_key_block: "cite the file that holds the key instead of reproducing any part of it",
};

/** One sentence naming every construct, or null when there are none. */
export function describeQuotedCredentialConstructs(
  constructs: readonly ProseConstruct[],
  field: string,
): string | null {
  if (constructs.length === 0) return null;
  const first = constructs[0];
  const others = constructs.length > 1 ? ` (and ${constructs.length - 1} more)` : "";
  return (
    `${field} reproduces a credential construct rather than describing it: ` +
    `${first.kind.replace(/_/g, " ")} for "${first.subject}"${others}. ` +
    `A finding cites path and line; it does not carry the value — ` +
    `${GUIDANCE[first.kind].replace("%s", first.subject)}. ` +
    `The text is withheld from this message deliberately.`
  );
}

/** True when this prose describes rather than quotes. */
export function describesWithoutQuoting(text: string): boolean {
  return findQuotedCredentialConstructs(text).length === 0;
}
