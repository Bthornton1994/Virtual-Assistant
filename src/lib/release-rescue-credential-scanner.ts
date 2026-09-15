import { keyLooksSecret } from "@/lib/release-rescue-redaction-keys";
import {
  classifyAssignment,
  strongerClassification,
  tailReadsAsSentence,
  valueShape,
  type SecretClassification,
} from "@/lib/release-rescue-secret-classification";

// A bounded, linear scanner for credential assignments.
//
// This replaces the regex that three rounds of auditing kept defeating, and it
// replaces it for a reason rather than out of taste.
//
// The regex asked "does this text contain a credential-shaped assignment?" and
// answered by matching key, operator and value in one expression. Three things
// followed from that, and all three were exploited:
//
//  1. It could only see the assignment syntaxes someone had written down, so
//     `ENV DB_PASSWORD x`, `PASSWORD 'x'`, `--password x`, `.netrc`, `curl -u`
//     and XML all walked past it. Each fix added one more alternation; the next
//     audit brought a syntax nobody had added.
//
//  2. Because the pattern matched the WHOLE assignment, a non-secret key
//     consumed the text after it. `Config: DB_PASSWORD_PROD=hunter2` matched
//     with key `Config`, was judged not-secret, and `String.replace` resumed
//     AFTER the match — so the real assignment inside it was never examined.
//     That one is not an evasion; ordinary prose in front of a `.env` line was
//     enough.
//
//  3. Its quantifiers had to be tuned by hand for backtracking, and one of them
//     was missed twice.
//
// So the question is asked the other way round. Scan the text ONCE, left to
// right. At each position, decide whether a KEY NAME is credential-shaped — a
// decision that is already property-based, made by segment rather than by
// substring, and which no audit has broken. Only then look at what follows, using
// a small table of assignment FORMS.
//
// The consequences that matter:
//
//   * A non-secret key can never swallow a secret one, because the scan advances
//     by token, not by match.
//   * Adding a syntax is adding a form, not widening an expression.
//   * Every loop is bounded by the input length with no nesting, so the whole
//     scan is O(n). There is no expression here that can backtrack.
//
// What this deliberately does NOT do is treat a bare `KEY VALUE` pair as an
// assignment. "The password rotation policy is weak" would redact "rotation",
// and over-redaction is not free: the report validator hard-fails on a detected
// credential, so a false positive blocks a delivery. Every form below therefore
// requires real evidence of an assignment — an operator, a quote, a flag, a
// known keyword, or a file format's own structure.

/**
 * The largest input this scanner will read.
 *
 * Callers must bound their input BEFORE calling, and the intake parser now does.
 * This is the backstop for the ones that forget: past the limit the scanner
 * stops reading and reports `truncated`, and every caller treats that as unsafe
 * rather than as "no credentials found".
 */
export const MAX_SCAN_LENGTH = 64_000;

/** Values that match an assignment shape but are not secrets. */
const NON_SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^process\.env\./i,
  /^import\.meta\.env\./i,
  /^Deno\.env\./i,
  /^os\.environ/i,
  /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/,
  /^%[A-Za-z_][A-Za-z0-9_]*%$/,
  /^<[^>]*>$/,
  /^\[REDACTED/i,
  /^(?:null|undefined|none|nil|true|false)$/i,
  /^[*x•.\-_]+$/i,
  /^(?:your|my|the|a|an)[-_ ]/i,
  /^(?:changeme|change_me|placeholder|example|sample|dummy|fake|test|todo|tbd|none|empty|unset|xxx+)$/i,
  /^(?:secret|password|passwd|token|apikey|api_key|key|value|string|text)$/i,
  /^[0-9]{1,4}$/,
  // A flag is the next argument, not this one's value: `--password --verbose`.
  /^-/,
];

/** The shortest run of characters worth treating as a credential. */
const MIN_VALUE_LENGTH = 4;

/**
 * The longest one.
 *
 * `:` is legitimately part of a value (`admin:pass`, a URL), so it cannot
 * terminate the run — which means on `password:password:password:...` the run
 * would consume every remaining byte, once per token, and that is quadratic. A
 * credential is not four kilobytes long.
 */
const MAX_VALUE_LENGTH = 4_096;

export function isNonSecretValue(value: string): boolean {
  const trimmed = value.trim().replace(/^["'`]|["'`]$/g, "");
  if (trimmed.length < MIN_VALUE_LENGTH) return true;
  return NON_SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * A half-open span of the input that holds something worth acting on, and HOW
 * confident we are.
 *
 * The classification is the part that was missing. A span used to mean "this is
 * a credential, refuse the report"; it now means "this is what we found, and
 * here is what that entitles the pipeline to do".
 */
export type CredentialSpan = {
  start: number;
  end: number;
  form: CredentialForm;
  classification: SecretClassification;
};

export type CredentialForm =
  | "operator_assignment"
  | "keyword_assignment"
  | "command_flag"
  | "quoted_after_key"
  | "xml_attribute"
  | "xml_element"
  | "netrc_line"
  | "delimited_column"
  | "block_scalar"
  | "argument_list"
  | "attached_flag"
  | "positional_record";

const WORD = /[A-Za-z0-9_$.\-]/;
const QUOTES = new Set(['"', "'", "`"]);
/** Keywords that make the NEXT word a key and the word after it a value. */
const ASSIGNMENT_KEYWORDS = new Set(["env", "arg", "set", "setenv", "export", "declare", "readonly"]);
/** Short command flags whose argument is a credential. */
const CREDENTIAL_FLAGS = new Set(["u", "p", "pw", "user", "password", "passwd", "pass", "token", "secret", "apikey"]);
/** Authentication schemes that PRECEDE the credential rather than being one. */
const AUTH_SCHEMES = new Set(["bearer", "basic", "digest", "negotiate", "token", "apikey"]);

type Word = { text: string; start: number; end: number };

/**
 * Splits the input into word tokens, recording where each one sits.
 *
 * One pass, no lookahead, no backtracking. Everything that is not a word
 * character is a boundary; the forms below re-read the raw text around a word
 * when they need to, which is always a bounded scan forward.
 */
function tokenize(text: string): Word[] {
  const words: Word[] = [];
  let start = -1;

  for (let index = 0; index <= text.length; index += 1) {
    const isWord = index < text.length && WORD.test(text[index]);
    if (isWord && start === -1) start = index;
    if (!isWord && start !== -1) {
      words.push({ text: text.slice(start, index), start, end: index });
      start = -1;
    }
  }
  return words;
}

/** First non-space character at or after `from`, or -1. */
function skipSpaces(text: string, from: number, stopAtNewline = true): number {
  let index = from;
  while (index < text.length) {
    const character = text[index];
    if (character === "\n" && stopAtNewline) return -1;
    if (character !== " " && character !== "\t" && character !== "\r" && character !== "\n") return index;
    index += 1;
  }
  return -1;
}

/**
 * The span of the value starting at `from`: a quoted string's interior, or a run
 * of characters up to the next separator.
 */
function valueSpan(text: string, from: number): { start: number; end: number } | null {
  const begin = skipSpaces(text, from);
  if (begin === -1) return null;

  if (QUOTES.has(text[begin])) {
    const quote = text[begin];
    let index = begin + 1;
    while (index < text.length && text[index] !== quote && text[index] !== "\n") index += 1;
    return index > begin + 1 ? { start: begin + 1, end: index } : null;
  }

  let index = begin;
  const limit = Math.min(text.length, begin + MAX_VALUE_LENGTH);
  // `&` and `#` terminate the run so a query-string value cannot swallow the
  // parameters after it: `?api_key=x&sort=name` is two fields, not one value.
  while (index < limit && !/[\s"'`,;)}\]<>&#]/.test(text[index])) index += 1;
  return index > begin ? { start: begin, end: index } : null;
}

/**
 * Records a hit with its classification, or drops it when it is plain prose.
 *
 * `sensitive_prose` is not recorded at all: the report is ABOUT security, and a
 * finding that says "the password rotation policy is weak" must reach the
 * customer exactly as written. Only the two classifications that carry authority
 * become spans.
 */
function pushSpan(
  spans: CredentialSpan[],
  text: string,
  span: { start: number; end: number } | null,
  form: CredentialForm,
  options: { assumeStructured?: boolean } = {},
): void {
  if (!span) return;
  const value = text.slice(span.start, span.end);

  // A structured format (a `.pgpass` line, a CSV column, an argument list) is
  // its own evidence of an assignment, so the sentence heuristic does not apply.
  const tailIsSentence = options.assumeStructured === true ? false : tailReadsAsSentence(text, span.end);
  const classification = classifyAssignment(valueShape(value, isNonSecretValue), tailIsSentence);
  if (classification === "sensitive_prose") return;

  spans.push({ start: span.start, end: span.end, form, classification });
}

/**
 * Finds every credential-bearing span in `text`.
 *
 * Linear in the length of the input: one tokenize pass, then one pass over the
 * tokens, each doing a bounded forward read. The line-oriented forms make one
 * additional pass over the lines.
 */
export function findCredentialSpans(text: string): { spans: CredentialSpan[]; truncated: boolean } {
  const truncated = text.length > MAX_SCAN_LENGTH;
  const scanned = truncated ? text.slice(0, MAX_SCAN_LENGTH) : text;
  const spans: CredentialSpan[] = [];
  const words = tokenize(scanned);

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];

    // A key may be QUOTED, as in `"password": "x"` or `name="jdbc.password"`.
    // Its closing quote would otherwise read as the opening quote of a value, so
    // the position everything else works from steps over it.
    const openedWith = word.start > 0 ? scanned[word.start - 1] : "";
    const isQuotedKey = QUOTES.has(openedWith) && scanned[word.end] === openedWith;
    const afterKey = isQuotedKey ? word.end + 1 : word.end;

    const next = skipSpaces(scanned, afterKey);
    const secretKey = keyLooksSecret(word.text);

    // F3. A command flag: `--password x`, `-u user:pass`.
    //
    // The tokenizer treats `-` as a word character, so `--password` arrives as a
    // single token rather than as a dash followed by a word. Checking the
    // PRECEDING character therefore never fired, which is how `psql --password x`
    // and `curl -u user:pass` both survived the first version of this scanner.
    if (word.text.startsWith("-")) {
      const flag = word.text.replace(/^-+/, "");

      // F3b. An ATTACHED value: `mysql -pSECRET`, `-uroot`. The tokenizer keeps
      // `-pMyS3cretPass` as one word, so the credential is inside the flag token
      // itself rather than after it. Only single-letter flags attach this way.
      const attached = /^([a-zA-Z])(.{4,})$/.exec(flag);
      if (attached && CREDENTIAL_FLAGS.has(attached[1].toLowerCase()) && !word.text.startsWith("--")) {
        const valueStart = word.start + word.text.length - attached[2].length;
        pushSpan(spans, scanned, { start: valueStart, end: word.end }, "attached_flag", {
          assumeStructured: true,
        });
        continue;
      }
      // Lowercased ONLY for the fixed-flag lookup. `keyLooksSecret` splits on
      // camel-case boundaries, so lowercasing first destroys them and
      // `--dbPasswordProd` reads as one meaningless segment. Found by the
      // generated form-by-key matrix, which is the point of generating it.
      if (CREDENTIAL_FLAGS.has(flag.toLowerCase()) || keyLooksSecret(flag)) {
        pushSpan(spans, scanned, valueSpan(scanned, word.end), "command_flag");
        continue;
      }
    }

    // F2. A keyword that introduces a key and then a value: `ENV DB_PASSWORD x`.
    if (ASSIGNMENT_KEYWORDS.has(word.text.toLowerCase()) && index + 1 < words.length) {
      const key = words[index + 1];
      if (keyLooksSecret(key.text)) {
        pushSpan(spans, scanned, valueSpan(scanned, key.end), "keyword_assignment");
        continue;
      }
    }

    if (!secretKey) continue;

    // F6. An XML/HTML element: `<password>value</password>`.
    if (openedWith === "<" && next !== -1 && scanned[next] === ">") {
      let end = next + 1;
      while (end < scanned.length && scanned[end] !== "<") end += 1;
      pushSpan(spans, scanned, { start: next + 1, end }, "xml_element");
      continue;
    }

    if (next === -1) continue;

    // F1. An operator assignment: `=`, `:`, `:=`, `=>`.
    if (scanned[next] === "=" || scanned[next] === ":") {
      let after = next + 1;
      if (scanned[after] === "=" || scanned[after] === ">") after += 1;

      // F9. A YAML block scalar: `db_password: |` then indented lines.
      const indicator = skipSpaces(scanned, after);
      if (indicator !== -1 && (scanned[indicator] === "|" || scanned[indicator] === ">")) {
        const blockStart = scanned.indexOf("\n", indicator);
        if (blockStart !== -1) {
          let end = blockStart + 1;
          while (end < scanned.length) {
            const lineEnd = scanned.indexOf("\n", end);
            const stop = lineEnd === -1 ? scanned.length : lineEnd;
            if (!/^[ \t]+\S/.test(scanned.slice(end, stop))) break;
            end = stop + 1;
          }
          const body = valueSpan(scanned, blockStart + 1);
          pushSpan(spans, scanned, body, "block_scalar");
          continue;
        }
      }

      // `Authorization: Bearer <token>` assigns a SCHEME, not a credential. The
      // value worth removing is the token after it, and redacting the word
      // "Bearer" while leaving the token — which the first version did — is worse
      // than useless, because it looks like something was protected.
      const assigned = valueSpan(scanned, after);
      if (assigned && AUTH_SCHEMES.has(scanned.slice(assigned.start, assigned.end).toLowerCase())) {
        pushSpan(spans, scanned, valueSpan(scanned, assigned.end), "operator_assignment");
        continue;
      }
      pushSpan(spans, scanned, assigned, "operator_assignment");
      continue;
    }

    // F4. A quoted value directly after the key: `PASSWORD 'x'`, `IDENTIFIED BY 'x'`.
    //     A quote is the evidence of assignment. Without one this would fire on
    //     ordinary prose ("the password rotation policy"), so there is no bare
    //     `KEY VALUE` rule.
    //
    //     Not for a quoted key: there the next quote is an attribute boundary,
    //     not a value, and F5 below is the form that applies.
    if (!isQuotedKey && QUOTES.has(scanned[next])) {
      pushSpan(spans, scanned, valueSpan(scanned, afterKey), "quoted_after_key");
      continue;
    }

    // F10. An argument list: `define('DB_PASSWORD', 'secret')`, the canonical
    //      wp-config.php shape. The key arrives QUOTED and the value is the next
    //      quoted argument, separated by a comma rather than by an operator — so
    //      neither the operator form nor the quoted-after-key form applies, and
    //      F5 does not either because there is no `value=` attribute.
    if (isQuotedKey && next !== -1 && scanned[next] === ",") {
      const argument = valueSpan(scanned, next + 1);
      if (argument) {
        pushSpan(spans, scanned, argument, "argument_list", { assumeStructured: true });
        continue;
      }
    }

    // F5. An XML attribute pair: `name="jdbc.password" value="x"`.
    //     The key arrives as the CONTENTS of one attribute and the secret as the
    //     contents of a later one in the same tag.
    if (isQuotedKey) {
      const tagEnd = scanned.indexOf(">", afterKey);
      const limit = tagEnd === -1 ? scanned.length : tagEnd;
      const carrier = /\b(?:value|content|password|secret)\s*=\s*(["'])/i.exec(scanned.slice(afterKey, limit));
      if (carrier) {
        const open = afterKey + carrier.index + carrier[0].length;
        let end = open;
        while (end < scanned.length && scanned[end] !== carrier[1]) end += 1;
        pushSpan(spans, scanned, { start: open, end }, "xml_attribute");
        continue;
      }
    }
  }

  collectLineOrientedSpans(scanned, spans);
  return { spans, truncated };
}

/**
 * Forms whose unit is a line rather than a token: `.netrc`, and delimited data
 * whose header names a credential column.
 */
function collectLineOrientedSpans(text: string, spans: CredentialSpan[]): void {
  let offset = 0;
  let secretColumns: number[] = [];
  let delimiter = ",";

  for (const line of text.split("\n")) {
    const lower = line.toLowerCase();

    // F11. A positional credential record: `.pgpass` is
    //      `host:port:database:user:password` with the secret in the last field
    //      and no key name anywhere on the line. No key-driven form can see it,
    //      so the FORMAT is the evidence: five colon-separated fields whose
    //      second is a port number.
    const pgpass = /^([^:\s]+):(\d{1,5}):([^:]*):([^:]*):(.+)$/.exec(line.trim());
    if (pgpass && pgpass[5].length >= 4) {
      const valueStart = offset + line.length - pgpass[5].length;
      pushSpan(spans, text, { start: valueStart, end: offset + line.length }, "positional_record", {
        assumeStructured: true,
      });
    }

    // F7. `.netrc`: `machine host login user password secret`.
    if (/\bmachine\b/.test(lower) || /\blogin\b/.test(lower)) {
      const marker = /\b(password|passwd|account)\b[ \t]+/i.exec(line);
      if (marker) {
        const from = offset + marker.index + marker[0].length;
        pushSpan(spans, text, valueSpan(text, from), "netrc_line", { assumeStructured: true });
      }
    }

    // F8. Delimited data: a header row naming a credential column fixes that
    //     column for the rows beneath it, until a blank line resets.
    if (line.trim().length === 0) {
      secretColumns = [];
    } else if (secretColumns.length > 0) {
      let cursor = offset;
      for (const [column, field] of line.split(delimiter).entries()) {
        if (secretColumns.includes(column)) {
          const begin = cursor + (field.length - field.trimStart().length);
          pushSpan(spans, text, { start: begin, end: cursor + field.length }, "delimited_column", { assumeStructured: true });
        }
        cursor += field.length + delimiter.length;
      }
    } else {
      for (const candidate of [",", "\t", ";"]) {
        const fields = line.split(candidate);
        if (fields.length < 2) continue;
        const hits = fields
          .map((field, column) => (keyLooksSecret(field.trim()) ? column : -1))
          .filter((column) => column >= 0);
        if (hits.length > 0) {
          secretColumns = hits;
          delimiter = candidate;
          break;
        }
      }
    }

    offset += line.length + 1;
  }
}

/** True when any credential-bearing span was found. */
export function textHoldsCredential(text: string): boolean {
  return findCredentialSpans(text).spans.length > 0;
}
