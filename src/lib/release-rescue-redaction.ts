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
  | "assigned_secret";

type SecretDetector = {
  readonly name: SecretDetectorName;
  readonly pattern: RegExp;
  /**
   * When set, only this capture group is replaced; the rest of the match is
   * preserved. Used by `assigned_secret` and `credential_in_url` so the reader
   * still sees WHICH setting held a secret.
   */
  readonly captureGroup?: number;
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
    name: "assigned_secret",
    pattern:
      /\b(?:password|passwd|pwd|secret|api[-_]?key|apikey|access[-_]?key|auth[-_]?token|client[-_]?secret|private[-_]?key|bearer|credential|session[-_]?key)\b\s*[:=]\s*(["'`]?)([^\s"'`,;)}\]]{8,})\1/gi,
    captureGroup: 2,
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
      if (detector.captureGroup !== undefined) {
        const value = groups[detector.captureGroup - 1];
        if (typeof value !== "string" || isNonSecretValue(value)) return match;
        count += 1;
        return match.replace(value, placeholderFor(detector.name));
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
