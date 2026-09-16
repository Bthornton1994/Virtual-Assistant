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
// to a credential-named key, a credentialed URL, or a private-key header. No
// branch asks anything about the value except whether one exists — which is not
// the same as "nothing can get through", and the limits are listed below. An
// auditor writes "the file assigns DB_PASSWORD a literal value"; the customer
// opens `config/app.env:14` and reads it in their own checkout, where it already
// is. That is the same sentence the excerpt decision made about source windows.
//
// WHAT THIS DOES NOT CLAIM, stated plainly because two audits in a row have
// caught this file's neighbours claiming more than they do:
//
//   - A credential written with NO KEY AT ALL — "the committed value is
//     Xk92mQvn7Lz" — has no construct to refuse. Nothing here catches it, and
//     nothing here can: catching it means judging whether a token looks like a
//     secret, which is the detector the owner retired after ten rounds.
//   - A key the lexicon does not recognise (`STRIPE_SK`, `NEXTAUTH`) is not a
//     credential-named key as far as this rule is concerned.
//   - `key: value` on a bare colon is not refused, for the reason given on
//     `findQuotedCredentialConstructs` below.
//
// The controls standing at those gaps are the scanner, which still runs over
// every string as defence in depth, and the named human reviewer who signs the
// report before it is delivered. That is the honest description, and
// `docs/AI-APP-RELEASE-RESCUE-V1.md` gives the same one.

/** A refused construct. Names the construct and the key, never the value. */
export type ProseConstruct = {
  kind: "assignment" | "credentialed_url" | "private_key_block";
  /** The credential-named key, or the URL scheme. Never what followed it. */
  subject: string;
};

/** A run of characters that could be an identifier in some language. */
const TOKEN = /[\p{L}_][\p{L}\p{N}_.-]*/gu;

/**
 * Equals signs, in the spellings that reach a report.
 *
 * `\uFF1D` is the fullwidth equals an audit used to walk straight past the
 * first version of this rule.
 */
const EQUALS = /[=\uFF1D]/;

/** Comparisons that share an equals sign with assignment but assign nothing. */
const COMPARISONS = new Set(["==", "===", "!=", "!==", "<=", ">=", "=>", "==="]);

/**
 * The bridge between a key and its value: whatever non-word characters sit
 * between them.
 *
 * The first version of this rule enumerated operators — `:=|=>|={1,3}|!=|<=|>=`
 * — and an audit crossed a credential corpus with eighteen carriers against it.
 * `DB_PASSWORD += "value"` delivered 346 of 366 values to a customer-facing
 * report. So did `**DB_PASSWORD**=value`, `<code>DB_PASSWORD</code>=value`, and
 * the fullwidth sign. That list had exactly the shape of the terminator set the
 * owner retired: correct for the examples that built it, blind one character
 * away.
 *
 * So there is no list. A bridge is any run of non-word characters, and it counts
 * as an assignment when it contains an equals sign and is not a comparison.
 * `+=`, `||=`, `??=`, `.=`, `**=`, `</code>=` and `＝` are all assignments
 * without ever being named.
 */
function assignmentBridge(rest: string): number | null {
  const bridge = /^[^\p{L}\p{N}_]*/u.exec(rest);
  if (!bridge) return null;
  const text = bridge[0];
  if (!EQUALS.test(text)) return null;
  if (COMPARISONS.has(text.trim())) return null;
  return text.length;
}

/**
 * The value assigned, which may be on the next non-blank line.
 *
 * `DB_PASSWORD=` with the value one line down was invisible to the first
 * version, which looked only at the rest of the same line — and an audit
 * delivered 346 of 366 values through it. This looks at what is actually
 * assigned, wherever the writer put it. It reads only whether something IS
 * assigned, never what.
 */
function assignsSomething(lines: readonly string[], index: number, rest: string): boolean {
  if (rest.trim().length > 0) return true;
  for (let next = index + 1; next < lines.length; next += 1) {
    if (lines[next].trim().length > 0) return true;
  }
  return false;
}

/**
 * Removes HTML tags, keeping every character of the content between them.
 *
 * `<code>DB_PASSWORD</code>=value` put a word character — the `c` of the closing
 * tag — between the key and the equals sign, and a bridge made of non-word
 * characters stopped dead on it. The answer is not to teach the bridge about
 * tags, which is the enumeration again; it is that a tag is MARKUP and not part
 * of what the auditor wrote. Stripping it normalises the text once, and closes
 * `<b>`, `<strong>`, `<em>` and every other wrapper with it.
 *
 * Replaced with nothing rather than a space, so `<code>DB_PASSWORD</code>=x`
 * reads as `DB_PASSWORD=x` and not as two tokens.
 */
function withoutMarkup(text: string): string {
  return text.replace(/<\/?[A-Za-z][^>]*>/g, "");
}

/**
 * Removes redaction placeholders, because a placeholder is not content.
 *
 * `buildReleaseRescueReport` sanitises before it assembles, so this guard was
 * being asked about text the scanner had already rewritten. An audit measured
 * what that did: `if (token === expected) return true;` becomes
 * `if (token === [REDACTED:assigned_secret]) return true;`, the bridge is no
 * longer `===` but `=== [`, the comparison exclusion misses it, and the whole
 * report is thrown away. Three ordinary sentences about timing leaks — a routine
 * release-readiness finding — stopped being reportable, and the tests did not
 * see it because they call this function on RAW text while production never does.
 *
 * Stripping the placeholder makes the answer the same before and after
 * redaction, which is the property that was missing. It is also the right
 * answer: once the scanner has replaced a credential with a placeholder, there
 * is no longer a quoted credential there to refuse — there is a hold, which is a
 * different control saying a different thing.
 */
function withoutPlaceholders(text: string): string {
  return text.replace(/\[REDACTED:[a-z_]+\]/g, "");
}

/**
 * The constructs an observation may not contain, in the order they appear.
 *
 * Deterministic and total. Every branch is decided by the KEY and the BRIDGE.
 * The only thing any branch asks about the value is whether one exists.
 *
 * There is no bare-colon arm. The first version had one, and it refused
 * `- token: enforce a 30-day expiry`, `OTP: the one-time code is six digits`,
 * and — worst — `db_password: ${env.DB_PASSWORD_REF}`, which is the FIX this
 * product recommends. A Markdown bullet list is the default output shape of
 * every LLM executor, and the refusal threw away the whole report. Separating a
 * config line from a sentence needs the tail read as prose, and the owner ruled
 * that out: a credential-named key must never be downgraded because of sentence
 * shape. Since it cannot be done safely, it is not done at all.
 *
 * The comment that used to sit here said the colon forms were "left to the
 * scanner", on a claim published as measured. It was false: 12 of 35 colon
 * form × value-shape combinations deliver a live credential, and the parent
 * commit refused six of the seven that now do. The discriminator is the value —
 * `#`, `$` or a space defeats the scanner's extractor — and every corpus in this
 * workstream used alphanumeric bodies, which is how it survived thirteen audits.
 * `release-rescue-prose.test.ts` measures all 35 and records the 12.
 */
export function findQuotedCredentialConstructs(input: string): ProseConstruct[] {
  const found: ProseConstruct[] = [];
  const text = withoutPlaceholders(withoutMarkup(input));

  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(text)) {
    found.push({ kind: "private_key_block", subject: "PRIVATE KEY" });
  }

  const url = /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@:]+:[^\s/@]+@/i.exec(text);
  if (url) found.push({ kind: "credentialed_url", subject: url[1].toLowerCase() });

  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    TOKEN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = TOKEN.exec(line)) !== null) {
      const token = match[0];
      if (!keyLooksSecret(token)) continue;

      const rest = line.slice(match.index + token.length);
      const bridge = assignmentBridge(rest);
      if (bridge === null) continue;
      if (!assignsSomething(lines, index, rest.slice(bridge))) continue;

      found.push({ kind: "assignment", subject: token });
    }
  });

  return found;
}

const GUIDANCE: Readonly<Record<ProseConstruct["kind"], string>> = {
  assignment:
    'name the setting and cite its location instead of writing the assignment — "the file assigns %s a literal value"',
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
