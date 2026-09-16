import { keyLooksSecret } from "@/lib/release-rescue-redaction-keys";
import {
  classifyAssignment,
  tailReadsAsSentence,
  valueShape,
  type AssignmentSyntax,
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
 * stops reading and reports `truncated`. `redactSecrets` propagates it as
 * `scanTruncated`, and the two functions that answer "is this text safe" —
 * `holdsCredentialEvidence` and `containsLikelySecret` — return true on it.
 *
 * That sentence used to say every caller treated it as unsafe. No caller read it
 * at all: a credential past this limit came back as "nothing found" from the one
 * function the whole pipeline depends on.
 */
export const MAX_SCAN_LENGTH = 64_000;

/**
 * Values that match an assignment shape but cannot be a literal secret.
 *
 * Every entry here is a SUPPRESSION, and a suppression is now recorded rather
 * than silent (see `pushSpan`). That changes what belongs in this list: an entry
 * is admissible only if it describes a value's STRUCTURE — a variable reference,
 * a placeholder convention, a call — and not if it is a guess about whether a
 * particular string looks secret.
 *
 * Audit 9 built a real credential for eight of the previous entries. Each of
 * those is tightened or gone, and `release-rescue-audit9-properties.test.ts`
 * generates a corpus that asserts the property directly: no real credential may
 * be suppressed behind a credential-named key.
 */
const NON_SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^process\.env\./i,
  /^import\.meta\.env\./i,
  /^Deno\.env\./i,
  /^os\.environ/i,
  // A shell variable. BRACED, or bare with an environment-style ALL-CAPS name.
  // The old pattern allowed any bare name, so `$ecretPass` — `$` plus a
  // perfectly ordinary password — was dropped in silence.
  //
  // The closing brace is optional because `}` terminates the value run, so the
  // scanner never sees it. Requiring it broke `${DB_PASSWORD}` outright, which
  // the structural-references test caught immediately.
  /^\$\{[A-Za-z_][A-Za-z0-9_]*\}?$/,
  // The bare form must carry an underscore, which is the environment-variable
  // convention. Without that, `$AKIAIOSFODNN7EXAMPLE` — an AWS key id somebody
  // prefixed — read as a shell variable.
  /^\$[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/,
  /^%[A-Za-z_][A-Za-z0-9_]*%$/,
  // An angle-bracket placeholder, whose contents must themselves look like a
  // placeholder. `<M3g@Secret>` is a password somebody wrapped in brackets.
  /^<[a-z][a-z0-9_ -]*>$/i,
  /^\[REDACTED/i,
  /^(?:null|undefined|none|nil|true|false)$/i,
  // Masking runs, in ONE case. The old pattern carried `i`, so `xXxXxXxXxX` —
  // an alternating-case password — was a row of asterisks as far as it was
  // concerned.
  /^[*•.\-_]+$/,
  /^x+$/,
  /^X+$/,
  // A placeholder phrase, which has to END like one. Requiring only the prefix
  // made `my-super-horse-staple` — a hyphenated diceware passphrase — a
  // placeholder, and `AWS_SECRET_ACCESS_KEY="a-Kx92mQvn7LzPr0dQQ"` before that.
  /^(?:your|my|the|a|an)[-_][a-z][a-z-]*[-_](?:here|value|goes|placeholder|name|key|secret|password|token)$/i,
  /^(?:changeme|change_me|placeholder|example|sample|dummy|fake|todo|tbd|none|empty|unset|xxx+)$/i,
  // NO literal-word list. `password`, `secret`, `token`, `key` and `test` were
  // here, and they are among the most common real passwords there are:
  // `DB_PASSWORD=password` and `JWT_SECRET=secret` were dropped in silence. A
  // credential whose value is the word "password" is a finding, not a placeholder.
  //
  // No numeric allowlist either. `PIN=4821` is a credential, and a genuinely
  // uninteresting number like `saltRounds = 10` is below the minimum value length.
  //
  // A command FLAG is the next argument, not this one's value:
  // `--password --verbose`. Lowercase words only — the old bare `/^-/` matched
  // `-Xk92mQvn7Lz`, and roughly one base64url secret in sixty-four starts with a
  // hyphen.
  // Long flags only. A single leading hyphen matched `-hunter2hunter`, and
  // roughly one base64url secret in sixty-four begins with one.
  /^--[a-z][a-z0-9-]*$/,
  // A CODE REFERENCE rooted at a known object, at most three segments deep.
  // `config.sessionSecret`, `req.headers.token`.
  //
  // Both bounds matter. The first version matched any dotted lowercase path,
  // which is how a diceware passphrase is written; the second kept roots like
  // `window` and `vault` and no depth bound, so `window.tiger.canvas.rope` was
  // still dropped. A config path is two or three segments; a passphrase is four
  // or more.
  // Two segments: a known root and a member. `config.sessionSecret`.
  /^(?:process|import|globalThis|config|configs|cfg|settings|options|opts|props|params|environment|constants|req|request|res|response|ctx|context|argv)\.[A-Za-z_$][A-Za-z0-9_$]*$/,
  // Three segments: the middle one must name a real API surface. Allowing any
  // three-segment path rooted at a config word let `config.horse.battery` and
  // `session.horse.battery` through — a hyphen-free diceware passphrase is
  // exactly that shape, and the generated corpus found 27 of them.
  /^(?:process|import|globalThis|config|req|request|res|response|ctx|context)\.(?:env|headers|body|query|params|cookies|session|locals|argv|meta|signedCookies)\.[A-Za-z_$][A-Za-z0-9_$]*$/,
  // An OPERATOR standing where the value would be: `token = await
  // refreshToken();` assigns the result of a call, not a literal.
  /^(?:await|typeof|require|function|async|return|yield|delete|throw|instanceof)$/,
];

/** The shortest run of characters worth treating as a credential. */
const MIN_VALUE_LENGTH = 4;

/**
 * The longest one.
 *
 * `:` is legitimately part of a value (`admin:pass`, a URL), so it cannot
 * terminate the run — which means on `password:password:password:...` the run
 * consumes bytes until this cap, once per token. The cap is therefore the
 * per-token cost, and 512 keeps a pathological 80KB input inside the repo's own
 * budget while still covering every real credential: a longer one is a PEM block
 * or a JWT, and both have their own prefix detectors that do not depend on this.
 */
const MAX_VALUE_LENGTH = 512;

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
  | "positional_record"
  | "opaque_token_near_noun";

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
/**
 * Whether the next line continues the value, rather than starting a new record.
 *
 * The first version of the cross-newline reach checked only that nothing followed
 * the operator on ITS OWN line, and its comment claimed that meant "a key with an
 * empty value cannot reach forward and swallow an unrelated line further down".
 * It could, and it did. In a committed `.env.example` — a file this product
 * explicitly accepts as evidence —
 *
 *     DB_PASSWORD=
 *     API_HOST=prod.example.com
 *
 * the empty `DB_PASSWORD` consumed all of line 2, and `API_HOST=prod.example.com`
 * scored `opaque` because `=` counts as a symbol, so the whole line became
 * `credential_evidence`. That classification cannot be cleared by any human, so
 * an env template containing no secret made the report permanently undeliverable.
 *
 * A continuation is a bare value: no assignment operator, no comment marker, not
 * blank, not a document fence. Anything shaped like the next record is the next
 * record.
 */
/** How far the line containing `offset` is indented. */
function indentOfLineAt(text: string, offset: number): number {
  const lineStart = text.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  let index = lineStart;
  while (index < text.length && (text[index] === " " || text[index] === "\t")) index += 1;
  return index - lineStart;
}

function isContinuationLine(line: string, keyIndent: number): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (/^(?:#|\/\/|--|\/\*)/.test(trimmed)) return false;
  if (/^(?:```|---|\.\.\.)/.test(trimmed)) return false;

  // A QUOTED line is a value. `"postgres:Xk92mQvn7Lz"` on its own line is what
  // `JSON.stringify(x, null, 2)` writes for a long value, and the previous
  // version rejected it because it contains a colon — giving up the highest-value
  // class there is, credentials with embedded userinfo.
  if (/^["'`]/.test(trimmed)) return true;

  // Otherwise INDENTATION decides, which is what the format itself uses.
  //
  // The previous version looked for an assignment operator, and that fires on the
  // VALUE as readily as on a key: `admin:Xk92mQvn7Lz` is a `user:pass` pair, not
  // a new record. It also let prose through, so `DB_PASSWORD=` followed by
  // `Rotate this before launch.` still swallowed the sentence and bricked the
  // report at `credential_evidence`.
  //
  // A continuation is indented further than its key. A sibling record is not.
  const indent = line.length - line.trimStart().length;
  return indent > keyIndent;
}

type ValueSpan = { start: number; end: number; call?: boolean };

function valueSpan(text: string, from: number): ValueSpan | null {
  let begin = skipSpaces(text, from);

  // The value may sit on the NEXT line.
  //
  // `skipSpaces` stops at a newline, so `"password":` followed by its value on
  // the following line produced no span at all. That is not an evasion: it is
  // what `JSON.stringify(x, null, 2)`, every YAML writer and every code
  // formatter produce once the line gets long. Both scanner test tables place
  // key and value adjacent on one line, which is how it went unnoticed.
  //
  // Exactly one line is crossed, and only when nothing else follows the operator
  // on its own line, so a key with an empty value cannot reach forward and
  // swallow an unrelated line further down.
  if (begin === -1) {
    const lineEnd = text.indexOf("\n", from);
    if (lineEnd === -1) return null;
    if (text.slice(from, lineEnd).trim().length > 0) return null;
    const nextEnd = text.indexOf("\n", lineEnd + 1);
    const nextLine = text.slice(lineEnd + 1, nextEnd === -1 ? text.length : nextEnd);
    if (!isContinuationLine(nextLine, indentOfLineAt(text, from))) return null;
    begin = skipSpaces(text, lineEnd + 1);
  }
  if (begin === -1) return null;

  // Step over an assignment operator sitting at the start of the run.
  //
  // The keyword and flag forms hand this function the position just after the
  // KEY, which for `export DB_PASSWORD=x`, `ENV DB_PASSWORD=x` and
  // `mytool --password=x` is the `=` itself. The run then began at `=`, so the
  // span covered `=x` rather than `x` — and, worse, `=${DB_PASSWORD}` no longer
  // matched the placeholder allowlist, so the correct Dockerfile idiom of
  // passing a build arg through was redacted as though it were a leaked
  // password. Found by crossing carriers with placeholder values.
  if (text[begin] === "=" || text[begin] === ":") {
    begin += 1;
    if (text[begin] === "=" || text[begin] === ">") begin += 1;
    let afterOperator = skipSpaces(text, begin);
    if (afterOperator === -1) {
      // Same one-line reach as above: `mysql --password=\` then the value.
      const lineEnd = text.indexOf("\n", begin);
      if (lineEnd === -1) return null;
      if (text.slice(begin, lineEnd).replace(/\\\s*$/, "").trim().length > 0) return null;
      const nextEnd = text.indexOf("\n", lineEnd + 1);
      const nextLine = text.slice(lineEnd + 1, nextEnd === -1 ? text.length : nextEnd);
      if (!isContinuationLine(nextLine, indentOfLineAt(text, begin))) return null;
      afterOperator = skipSpaces(text, lineEnd + 1);
    }
    if (afterOperator === -1) return null;
    begin = afterOperator;
  }

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
  //
  // `(` terminates it too, and that is what makes a CALL a call.
  //
  // It used to be absent from this set, so the run swallowed the open paren and
  // a special-cased allowlist pattern was added to recognise the result. That
  // pattern only matched when the call's first argument was a quoted string,
  // which is one spelling out of four: `getToken(req)`, `get_password(user)` and
  // `fetchToken(ctx)` were all still redacted at `credential_evidence` — an
  // unclearable hold, mangling ordinary middleware into invalid syntax. And
  // because the run ended at `(`, `DB_PASSWORD=hunter2(` matched the pattern and
  // was dropped in silence.
  //
  // Terminating here fixes both directions: the callee is the value, and the
  // check below decides what that means.
  while (index < limit && !/[\s"'`,;()}\]<>&#]/.test(text[index])) index += 1;
  if (index === begin) return null;

  // An identifier immediately followed by `(` is a call, not a literal.
  //
  // Reported as a suppression rather than discarded, because discarding it is
  // the silent drop this whole round is about: `DB_PASSWORD=hunter2(` and
  // `const token = getToken(req)` produce the same span, and the difference
  // between them is context this function does not have. Recording it means a
  // wrong call means an over-report, not a leak.
  // A call has arguments and a closing paren on the same line. Requiring that
  // keeps `getToken(req)` a call while `DB_PASSWORD=Xk92mQvn7Lz(` stays a value:
  // a trailing open paren alone is not a call, and treating it as one suppressed
  // a whole column of the generated corpus.
  const closes = text.indexOf(")", index);
  const lineEnd = text.indexOf("\n", index);
  const isCall =
    text[index] === "(" && closes !== -1 && (lineEnd === -1 || closes < lineEnd);

  return { start: begin, end: index, call: isCall };
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
  span: ValueSpan | null,
  form: CredentialForm,
  options: { syntax?: AssignmentSyntax } = {},
): void {
  if (!span) return;
  const value = text.slice(span.start, span.end);

  // Structured unless the caller says otherwise. Every form in this scanner is
  // machine syntax except the bare colon, which is the one shape an English
  // sentence can also produce.
  const syntax: AssignmentSyntax = options.syntax ?? "structured";
  const tailIsSentence = syntax === "bare_colon" ? tailReadsAsSentence(text, span.end) : false;
  // Sentence punctuation carried by the value itself, which only a clause does.
  const valueEndsSentence = syntax === "bare_colon" && /[.,;!?]$/.test(value.trimEnd());
  // A call expression is suppressed rather than redacted — recorded, visible in
  // `suppressed`, and left readable.
  const classification: SecretClassification = span.call
    ? "sensitive_prose"
    : classifyAssignment(
        syntax,
        valueShape(value, isNonSecretValue),
        tailIsSentence,
        valueEndsSentence,
      );
  // RECORDED, not dropped.
  //
  // This is the structural repair for the defect four consecutive audits kept
  // finding in a new disguise. `sensitive_prose` used to `return` here, so
  // "we decided this is not a secret" and "we never looked" were the same
  // observable state: nothing. Every time a false positive was closed by adding
  // an allowlist entry, a class of real credentials went silent, and the only
  // way to discover it was for an auditor to guess the exact value.
  //
  // Now the span is always recorded. `sensitive_prose` spans are NOT redacted —
  // the text stays readable, which is what they are for — but they are reported
  // as suppressions, so a wrong allowlist entry OVER-REPORTS instead of going
  // quiet, and a test can assert that no real credential is ever suppressed.
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
        pushSpan(spans, scanned, { start: valueStart, end: word.end }, "attached_flag");
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

    // F1. An operator assignment: `=`, `:=`, `=>`, or a bare `:`.
    if (scanned[next] === "=" || scanned[next] === ":") {
      let after = next + 1;
      const compound = scanned[after] === "=" || scanned[after] === ">";
      if (compound) after += 1;

      // A bare colon is the ONE ambiguous operator: YAML writes it and so does
      // English. `:=` and `:>` are compound and unambiguous, and a quoted key
      // (`"password":`) is JSON, which no sentence produces. Everything else in
      // this scanner is machine syntax and defaults to `structured`.
      // A QUOTED value settles the colon too. `DB_PASSWORD: "swordfish"` in a
      // compose file is machine syntax however ordinary the word inside is, and
      // English does not quote the object of a clause. Without this, the one
      // carrier in the whole matrix that quotes a YAML value fell back to
      // `ambiguous_secret_candidate` — still redacted, but held for a human
      // instead of refused outright, which is the wrong answer for a password
      // sitting in a compose file.
      const valueBegin = skipSpaces(scanned, compound ? next + 2 : next + 1);
      const isQuotedValue = valueBegin !== -1 && QUOTES.has(scanned[valueBegin]);

      const syntax: AssignmentSyntax =
        scanned[next] === ":" && !compound && !isQuotedKey && !isQuotedValue
          ? "bare_colon"
          : "structured";

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
        // The scheme introduces the credential, so the span worth taking is what
        // follows it — UNLESS nothing follows, in which case the scheme word IS
        // the value. `DB_PASSWORD=token` and `API_KEY=apikey` are real and
        // common passwords, and dropping them here was a silent leak the
        // generated corpus found.
        const afterScheme = valueSpan(scanned, assigned.end);
        pushSpan(spans, scanned, afterScheme ?? assigned, "operator_assignment", { syntax });
        continue;
      }
      pushSpan(spans, scanned, assigned, "operator_assignment", { syntax });
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
        pushSpan(spans, scanned, argument, "argument_list", { syntax: "structured" });
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
  collectOpaqueTokensNearCredentialNouns(scanned, words, spans);
  return { spans, truncated };
}

/** Nouns whose presence on a line makes a nearby opaque token a credential. */
const CREDENTIAL_NOUNS = new Set([
  "password", "passwords", "passphrase", "secret", "secrets", "credential", "credentials",
  "token", "tokens", "apikey", "key", "keys", "pin", "passcode", "otp",
]);

/**
 * A high-entropy token sitting next to the word "password".
 *
 * The form every key-driven rule misses, because there is no key: a reviewer
 * writing "Rotate pr0d-Xk92mQvn7Lz and move it to a secret store" has quoted the
 * credential in a sentence. An end-to-end test caught this — the unit tests could
 * not, because they all fed the scanner an assignment.
 *
 * Deliberately requires BOTH signals. Opaque tokens alone are everywhere in a
 * report (commit shas, content hashes, identifiers we mint ourselves), and
 * redacting those would corrupt the artifact. Pure hex of hash length is excluded
 * for the same reason; a secret in that shape is still caught wherever it appears
 * as an assigned value, which is how secrets normally appear.
 */
function collectOpaqueTokensNearCredentialNouns(
  text: string,
  words: readonly Word[],
  spans: CredentialSpan[],
): void {
  const lineHasNoun = new Map<number, boolean>();
  const lineStartOf = (offset: number) => text.lastIndexOf("\n", offset) + 1;

  for (const word of words) {
    if (!CREDENTIAL_NOUNS.has(word.text.toLowerCase())) continue;
    lineHasNoun.set(lineStartOf(word.start), true);
  }
  if (lineHasNoun.size === 0) return;

  for (const word of words) {
    if (!lineHasNoun.get(lineStartOf(word.start))) continue;

    const token = word.text;
    if (token.length < 12) continue;
    // Identifiers, not secrets: a commit sha, a content hash, a uuid.
    //
    // The lower bound was 32, which excluded a full SHA and admitted the
    // ABBREVIATED form git itself prints. A 12-character short SHA landed exactly
    // in the window, so "We fixed the token leak in commit a1b2c3d4e5f6 last
    // week." was refused at the public intake form — a prospect being told their
    // description of the fix they shipped is a credential.
    //
    // Any all-hex run is an identifier here. A hex secret in an ASSIGNMENT is
    // still caught by the assignment forms, which do not consult this; only the
    // near-noun prose form, which has no syntax to go on, gives them up.
    // Trimmed first: the tokenizer treats `.` as a word character, so a token at
    // the end of a sentence arrives as `4f9a2b1c8d3e.` and no anchored pattern
    // below would match it.
    const bare = token.replace(/^[.\-_]+|[.\-_]+$/g, "");
    if (/^[0-9a-f]+$/.test(bare)) continue;
    if (/^[0-9a-f-]{36}$/.test(bare)) continue;
    if (!/[0-9]/.test(token) || !/[A-Za-z]/.test(token)) continue;
    if (isNonSecretValue(token)) continue;
    if (CREDENTIAL_NOUNS.has(token.toLowerCase()) || keyLooksSecret(token)) continue;
    if (!hasContiguousEntropyRun(token)) continue;
    // Already covered by a stronger, more specific form.
    if (spans.some((span) => word.start >= span.start && word.end <= span.end)) continue;

    spans.push({
      start: word.start,
      end: word.end,
      form: "opaque_token_near_noun",
      // NOT `credential_evidence`. There is no assignment here — no `=`, no key,
      // nothing but a long token on a line that says "token" somewhere. That is
      // the definition of `ambiguous_secret_candidate`, and the first version of
      // this form claimed the top confidence level anyway, bypassing
      // `classifyAssignment` entirely.
      //
      // The cost of that was not over-redaction. `pendingSecretHolds` refuses to
      // clear a `credential_evidence` hold at all — correctly, because clearing
      // is for uncertainty and not an override — so this form made a $299 report
      // PERMANENTLY undeliverable, with no route out for any human, over a
      // sentence like "the session token is created in src/lib/auth-v2-helpers.ts".
      // Ambiguous redacts, holds, and can be cleared by a named manager.
      classification: "ambiguous_secret_candidate",
    });
  }
}

/**
 * A column name: one short identifier, nothing else.
 *
 * `import { getToken } from "./auth"` is not one, and that is the point.
 */
const HEADER_FIELD = /^"?[A-Za-z_][A-Za-z0-9_.()% -]{0,63}"?$/;

/**
 * Keywords that make a FIELD a fragment of code rather than a column name.
 *
 * Tested per field and only alongside other content, which is the distinction the
 * first version missed in both directions at once. `SELECT id` is a keyword plus
 * an operand, so it is code. A field that is exactly `from` is a column name, and
 * a `from` column is routine in any exported mail, event or ledger table — which
 * is exactly the artifact a "secrets in version control" finding quotes.
 *
 * Case-insensitive, because the first version was not, and uppercase SQL is how
 * SQL is written. `SELECT id, password, email` was read as a CSV header and the
 * next line's `created_at` was destroyed as `credential_evidence` — the audit-7
 * defect this guard was written to fix, moved from JavaScript to SQL.
 */
// The trailing `\s` matters: a statement verb is followed by its operands, while
// a CSV field is followed by the delimiter. Without it, a header whose first
// column is literally `from` disabled the form and a real CSV escaped.
const SQL_STATEMENT_START =
  /^\s*(?:select|insert|update|delete|with|from|where|order|group|having|join|union|create|alter|drop|values)\s/i;

/**
 * Whether a LINE is a fragment of a statement rather than a row of data.
 *
 * Anchored at the start of the line, which is the distinction the previous
 * version missed. It tested each field for "contains whitespace and a keyword",
 * so an ordinary two-word column name — `order date`, `update time`, `new value`
 * — disabled the form for every row beneath it, and a real CSV carrying a
 * password escaped unredacted. A SQL statement begins with its verb; a CSV header
 * begins with a column name.
 */
function lineLooksLikeStatement(line: string): boolean {
  return SQL_STATEMENT_START.test(line);
}

/**
 * Whether a line is source code rather than delimited data.
 *
 * `;` was in the delimiter list, and `;` is a statement terminator in every
 * language this product reviews. So three lines of routine route code — where
 * the first happened to contain `getToken`, which camel-splits to a credential
 * name — were read as a CSV header plus two rows, and every line's text before
 * its first `;` was redacted as `credential_evidence`. That destroyed the
 * finding's evidence AND made the report permanently undeliverable, because a
 * confident hold cannot be cleared by any human.
 *
 * A review of an AI application's auth code is close to certain to contain such
 * a line.
 */
function looksLikeSourceCode(line: string): boolean {
  // Braces and arrows only. SQL statement keywords are handled by
  // `lineLooksLikeStatement`, anchored at the start of the line — a per-field
  // keyword test disabled the form for any header with an ordinary two-word
  // column name (`order date`, `update time`), and real CSV escaped unredacted.
  return /[{}]|=>/.test(line);
}

/**
 * Whether a token carries its entropy in one contiguous blob.
 *
 * A generated secret is a run of characters with no word structure:
 * `Xk92mQvn7Lz`. A versioned code path spreads the same character classes across
 * word-joined English segments: `auth-v2-helpers.ts`, `stripe-client-v2.ts`,
 * `deploy-2024-prod-runner`, `ADR-2024-011-authentication`, `app-2024-config`.
 * Both have letters, digits and length; only the first has a blob.
 *
 * Without this the form fired on every one of those, and a release-readiness
 * report is made almost entirely of sentences that name a credential noun and a
 * versioned code path in the same breath.
 */
function hasContiguousEntropyRun(token: string): boolean {
  // A path is a path. No credential is written with a directory separator in it,
  // and a path near the word "token" is the single most common shape in this
  // product's own prose.
  if (token.includes("/") || token.includes("\\")) return false;

  for (const run of token.split(/[^A-Za-z0-9]+/)) {
    if (run.length < 10) continue;
    if (/[0-9]/.test(run) && /[A-Za-z]/.test(run)) return true;
  }
  return false;
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
      pushSpan(spans, text, { start: valueStart, end: offset + line.length }, "positional_record");
    }

    // F7. `.netrc`: `machine host login user password secret`.
    if (/\bmachine\b/.test(lower) || /\blogin\b/.test(lower)) {
      const marker = /\b(password|passwd|account)\b[ \t]+/i.exec(line);
      if (marker) {
        const from = offset + marker.index + marker[0].length;
        pushSpan(spans, text, valueSpan(text, from), "netrc_line", { syntax: "structured" });
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
              pushSpan(spans, text, { start: begin, end: cursor + field.length }, "delimited_column");
        }
        cursor += field.length + delimiter.length;
      }
    } else if (!looksLikeSourceCode(line)) {
      for (const candidate of [",", "\t", ";"]) {
        const fields = line.split(candidate);
        if (fields.length < 2) continue;
        // Every field of a real header is a column NAME: short, and not a
        // fragment of a statement. Both halves are needed — the name test alone
        // admits `SELECT id`, and the code test alone rejects a `from` column.
        if (!fields.every((field) => HEADER_FIELD.test(field.trim()))) continue;
        if (lineLooksLikeStatement(line)) continue;
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
