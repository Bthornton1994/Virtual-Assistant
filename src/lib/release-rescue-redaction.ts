// Secret detection and redaction for Release Rescue evidence.
//
// The review reads a customer's private source. Every finding wants to quote the
// line that proves it, and the single worst outcome of this service is a report
// that lifts a live credential out of a customer's repository and copies it into
// our database, a rendered page, and an email attachment. So excerpts pass
// through here before they are stored, and the finding contract refuses an
// excerpt that did not.
//
// The posture is deliberately conservative: over-redacting costs a reader some
// context, under-redacting copies a customer's production key into three new
// places. Where the two trade off, this module over-redacts.
//
// What this is NOT: a secret scanner for the customer's benefit. Finding
// committed secrets is a rubric check with its own evidence requirements
// (secrets.no_secrets_in_version_control). This module protects OUR pipeline
// from the material that check may discover. The auditor reports "a live Stripe
// key is committed at src/pay.ts:14"; it never reports the key.
//
// Pure, deterministic, no I/O, no clock — the same text always redacts the same
// way, so a stored excerpt's hash is reproducible.

/** Excerpts are proof of a finding, not a copy of the file. */
export const MAX_EXCERPT_LENGTH = 480;

export type SecretDetectorName =
  | "pem_private_key"
  | "aws_access_key_id"
  | "github_token"
  | "github_fine_grained_token"
  | "slack_token"
  | "stripe_key"
  | "anthropic_key"
  | "openai_key"
  | "google_api_key"
  | "sendgrid_key"
  | "npm_token"
  | "json_web_token"
  | "credential_in_url"
  | "credential_in_query"
  | "bearer_credential"
  | "assigned_secret";

type SecretDetector = {
  readonly name: SecretDetectorName;
  readonly pattern: RegExp;
  /**
   * When set, only this capture group is replaced; the rest of the match is
   * preserved. Used by `credential_in_url` and `credential_in_query` so the
   * reader still sees WHICH setting held a secret.
   */
  readonly captureGroup?: number;
  /**
   * Alternative capture groups, where the value may arrive quoted or bare. The
   * first group that actually matched is the one replaced.
   */
  readonly captureGroups?: readonly number[];
  /**
   * When set, the match counts as a secret only if the named capture group's
   * text satisfies this predicate. Used by `assigned_secret` to decide from the
   * KEY name rather than from a keyword baked into the pattern, which is what
   * lets the key be examined as a whole token instead of as a prefix.
   */
  readonly keyGuard?: { readonly group: number; readonly test: (key: string) => boolean };
};

/**
 * Values that match an assignment shape but are not secrets. Keeping these
 * readable matters: `apiKey: process.env.API_KEY` is the CORRECT pattern, and a
 * finding that recommends it should be able to show it.
 */
const NON_SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /^process\.env\./i,
  /^import\.meta\.env\./i,
  /^Deno\.env\./i,
  /^os\.environ/i,
  /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/,
  /^<[^>]*>$/,
  /^\[REDACTED/i,
  /^(?:null|undefined|none|nil|true|false)$/i,
  /^[*x•]+$/i,
  /^(?:your|my|the)[-_]/i,
  /^(?:changeme|placeholder|example|sample|dummy|fake|test|todo|tbd|xxx+)$/i,
  /^(?:secret|password|token|apikey|api_key|key|value)$/i,
];

function isNonSecretValue(value: string): boolean {
  const trimmed = value.trim().replace(/^["'`]|["'`]$/g, "");
  if (trimmed.length === 0) return true;
  return NON_SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Key-name segments that name a credential on their own.
 *
 * Matched as whole segments, never as substrings: "tokenizer" is not "token",
 * and "bypass" is not "pass". A substring match here would hard-fail reports
 * over ordinary prose, and this scanner blocks delivery when it fires.
 */
const SECRET_KEY_WORDS: ReadonlySet<string> = new Set([
  "password",
  "passwords",
  "passwd",
  "pwd",
  "passphrase",
  "passphrases",
  "secret",
  "secrets",
  "token",
  "tokens",
  "apikey",
  "apikeys",
  "credential",
  "credentials",
  "creds",
  "authorization",
  "bearer",
  "privatekey",
  "dsn",
  "salt",
]);

/** Key names that are credential-shaped only when they are the WHOLE name. */
const SECRET_WHOLE_KEYS: ReadonlySet<string> = new Set(["key", "keys", "pass", "auth", "pat"]);

/** Adjacent segment pairs that name a credential together but not apart. */
const SECRET_KEY_PHRASES: ReadonlySet<string> = new Set([
  "api key",
  "api keys",
  "access key",
  "access keys",
  "secret key",
  "private key",
  "signing key",
  "encryption key",
  "session key",
  "master key",
  "shared key",
  "account key",
  "security key",
  "auth key",
  "service role",
  "connection string",
  "service account",
]);

/**
 * Splits a key name into lowercase segments on separators AND camel-case
 * boundaries, so `DB_PASSWORD_PROD`, `dbPasswordProd` and `db.password.prod`
 * all reduce to the same three words.
 */
export function keyNameSegments(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());
}

/**
 * True when a key name claims to hold a credential, wherever the claim sits.
 *
 * This is the property the detector is really about: a name is secret-shaped if
 * any of its parts names a secret. Prefixes, suffixes, infixes, casing and
 * separator style are all irrelevant, which is why none of them appears here.
 */
export function keyLooksSecret(key: string): boolean {
  const segments = keyNameSegments(key);
  if (segments.length === 0) return false;
  if (segments.length === 1 && SECRET_WHOLE_KEYS.has(segments[0])) return true;
  if (segments.some((segment) => SECRET_KEY_WORDS.has(segment))) return true;
  for (let index = 0; index + 1 < segments.length; index += 1) {
    if (SECRET_KEY_PHRASES.has(`${segments[index]} ${segments[index + 1]}`)) return true;
  }
  return false;
}

// Ordered most-specific first. A vendor-shaped token should be named by its
// vendor, not swallowed by the generic assignment detector, because "a GitHub
// token is committed here" is a materially different finding from "something
// secret-looking is assigned here".
const DETECTORS: readonly SecretDetector[] = [
  {
    name: "pem_private_key",
    pattern: /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----[\s\S]*?(?:-----END(?: [A-Z0-9]+)* PRIVATE KEY-----|$)/g,
  },
  { name: "aws_access_key_id", pattern: /\b(?:AKIA|ASIA|ABIA|ACCA|AGPA|AIDA|AROA|ANPA|ANVA)[0-9A-Z]{16}\b/g },
  { name: "github_fine_grained_token", pattern: /\bgithub_pat_[A-Za-z0-9_]{22,}/g },
  { name: "github_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { name: "slack_token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: "stripe_key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { name: "anthropic_key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai_key", pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { name: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "sendgrid_key", pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { name: "npm_token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  {
    name: "json_web_token",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    // Preserves scheme://user@host so the reader keeps the host, loses the password.
    name: "credential_in_url",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:([^\s@/]+)@/gi,
    captureGroup: 1,
  },
  {
    // A credential carried in a query string or fragment, e.g.
    // https://api.example.com/v1/items?access_token=abc123. Keeps the parameter
    // name so the reader still sees which one carried it.
    name: "credential_in_query",
    pattern:
      /([?&#](?:access[_-]?token|refresh[_-]?token|id[_-]?token|auth[_-]?token|client[_-]?secret|api[_-]?key|apikey|token|secret|password|passwd|pat|authorization|session)=)([^&\s#"'<>]+)/gi,
    captureGroup: 2,
  },
  {
    // A bearer or basic credential, with or without an Authorization key.
    //
    // `Authorization: Bearer <token>` defeats the assignment detector because
    // the value the assignment sees is the word "Bearer", not the credential.
    name: "bearer_credential",
    pattern: /\b(?:bearer|basic)\s+([A-Za-z0-9._~+/=-]{16,})/gi,
    captureGroup: 1,
  },
  {
    // Decided from the WHOLE key name, not from a keyword glued to the pattern.
    //
    // Two earlier versions failed the same way in opposite directions. The
    // first required a word boundary before the keyword, so every prefixed
    // variable (NEXTAUTH_SECRET, AWS_SECRET_ACCESS_KEY) escaped. The second
    // added an optional prefix, so every SUFFIXED one still escaped
    // (DB_PASSWORD_PROD, SESSION_PASSPHRASE) — and the unbounded prefix
    // backtracked quadratically on long identifier runs.
    //
    // Both were the same mistake: the pattern tried to describe where in a name
    // a secret word may sit. It can sit anywhere. So the pattern now matches an
    // assignment to ANY identifier-shaped key, and `keyLooksSecret` decides by
    // splitting that key into segments and asking whether any segment — or any
    // adjacent pair — names a credential. Position stops mattering, and every
    // quantifier is bounded.
    name: "assigned_secret",
    pattern:
      /(?<![A-Za-z0-9_$])([A-Za-z_][A-Za-z0-9_.-]{0,80})["'`]?\s*[:=]>?\s*(?:(["'`])([^"'`\n]{6,})\2|([^\s"'`,;)}\]]{8,}))/g,
    captureGroups: [3, 4],
    keyGuard: { group: 1, test: keyLooksSecret },
  },
];

export type SecretDetection = {
  detector: SecretDetectorName;
  count: number;
};

export type RedactionResult = {
  redacted: string;
  detections: SecretDetection[];
  /** True when anything was replaced. */
  hadSecrets: boolean;
};

function placeholderFor(name: SecretDetectorName): string {
  return `[REDACTED:${name}]`;
}

/**
 * Replaces credential-shaped substrings with a named placeholder.
 *
 * Detectors run in sequence over the progressively redacted text. Placeholders
 * are inert to every detector (the `[REDACTED` prefix is on the non-secret
 * allowlist, and no vendor pattern matches a bracketed word), so redaction is
 * idempotent: redacting twice equals redacting once.
 */
export function redactSecrets(input: string): RedactionResult {
  let working = input;
  const detections: SecretDetection[] = [];

  for (const detector of DETECTORS) {
    let count = 0;
    // A fresh RegExp per call: the module-level literals carry /g and therefore
    // lastIndex, which would make this function's result depend on call order.
    const pattern = new RegExp(detector.pattern.source, detector.pattern.flags);
    working = working.replace(pattern, (match, ...groups) => {
      if (detector.keyGuard) {
        const key = groups[detector.keyGuard.group - 1];
        if (typeof key !== "string" || !detector.keyGuard.test(key)) return match;
      }
      const candidates =
        detector.captureGroups ?? (detector.captureGroup === undefined ? [] : [detector.captureGroup]);
      if (candidates.length > 0) {
        for (const group of candidates) {
          const value = groups[group - 1];
          if (typeof value !== "string" || value.length === 0) continue;
          if (isNonSecretValue(value)) return match;
          count += 1;
          return match.replace(value, placeholderFor(detector.name));
        }
        return match;
      }
      count += 1;
      return placeholderFor(detector.name);
    });
    if (count > 0) detections.push({ detector: detector.name, count });
  }

  return { redacted: working, detections, hadSecrets: detections.length > 0 };
}

/** True when `text` still holds something credential-shaped. */
export function containsLikelySecret(text: string): boolean {
  return redactSecrets(text).hadSecrets;
}

export type PreparedExcerpt = {
  excerpt: string;
  detections: SecretDetection[];
  truncated: boolean;
};

/**
 * Turns raw source text into an excerpt safe to persist: redacted first, then
 * truncated.
 *
 * Order matters. Truncating first could cut a credential in half and leave a
 * fragment that no detector recognises but that still narrows the key for anyone
 * holding the rest. Redacting first means the placeholder is what gets truncated.
 */
export function prepareExcerpt(raw: string, maxLength: number = MAX_EXCERPT_LENGTH): PreparedExcerpt {
  const { redacted, detections } = redactSecrets(raw);
  if (redacted.length <= maxLength) {
    return { excerpt: redacted, detections, truncated: false };
  }
  const ellipsis = "…";
  return {
    excerpt: redacted.slice(0, Math.max(0, maxLength - ellipsis.length)) + ellipsis,
    detections,
    truncated: true,
  };
}

export type ExcerptRejection = { path: string; detectors: SecretDetectorName[] };

/**
 * Walks a JSON-shaped value and reports every string still holding a secret.
 *
 * The report validator runs this over the entire assembled report rather than
 * trusting that each excerpt went through `prepareExcerpt`. A finding's excerpt
 * is not the only place raw source reaches a report — a recommendation or a
 * rationale can quote a line just as easily — so the check is applied to the
 * artifact as a whole, at the last moment before it is frozen.
 */
export function scanForSecrets(value: unknown, path = "$"): ExcerptRejection[] {
  if (typeof value === "string") {
    const result = redactSecrets(value);
    if (!result.hadSecrets) return [];
    return [{ path, detectors: result.detections.map((detection) => detection.detector) }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => scanForSecrets(entry, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      scanForSecrets(entry, `${path}.${key}`),
    );
  }
  return [];
}

// --- Evidence file names -------------------------------------------------------------

/**
 * File names a customer must never attach as evidence.
 *
 * Redaction protects us from credential-shaped TEXT. This protects us from a
 * customer helpfully attaching the file that holds their credentials: a `.env`,
 * an SSH private key, a service-account JSON, a certificate bundle. There is no
 * redaction to apply there — the whole file is the secret — so the intake
 * boundary refuses it by name rather than reading it.
 *
 * Matched against the base name only, so `config/prod/.env` is caught the same
 * as `.env`.
 */
const FORBIDDEN_EVIDENCE_NAME =
  /(?:^\.env\b|^\.env$|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?$|credentials(?:\.json)?$|service[-_]?account[A-Za-z0-9._-]*\.json$|^\.npmrc$|^\.pypirc$|^\.netrc$|^known_hosts$|\.(?:pem|p12|pfx|key|keystore|jks|ppk|asc|gpg)$)/i;

/**
 * Env templates, which carry placeholders rather than values.
 *
 * `.env.example` is the file a customer is SUPPOSED to commit, and a finding
 * about committed secrets often needs to cite it. Deliberately narrow: the
 * allowance applies only to the `.env` family. A template suffix on a key or
 * certificate (`id_rsa.example`, `server.pem.sample`) is not allowed through,
 * because the suffix is customer-controlled and nothing needs to read a private
 * key to report that one exists.
 */
const ENV_TEMPLATE_NAME = /^\.env[A-Za-z0-9._-]*\.(?:example|sample|template|dist|tpl)$/i;

export function isForbiddenEvidenceFilename(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  const base = trimmed.split(/[/\\]/).pop() ?? trimmed;
  if (ENV_TEMPLATE_NAME.test(base)) return false;
  return FORBIDDEN_EVIDENCE_NAME.test(base);
}
