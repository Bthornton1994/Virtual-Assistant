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

import { keyLooksSecret, keyNameSegments } from "@/lib/release-rescue-redaction-keys";
import {
  findCredentialSpans,
  isNonSecretValue,
  MAX_SCAN_LENGTH,
} from "@/lib/release-rescue-credential-scanner";
import {
  blocksDelivery,
  requiresHumanClearance,
  strongerClassification,
  type SecretClassification,
} from "@/lib/release-rescue-secret-classification";

export { keyLooksSecret, keyNameSegments, MAX_SCAN_LENGTH };
export { blocksDelivery, requiresHumanClearance, type SecretClassification };

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
    //
    // Two defects, both found by the third audit, both fixed by the same rewrite:
    //
    //   * `[^\s:@/]+` REQUIRED a username, so `redis://:password@host` — the
    //     normal form for Redis and Sentinel, and common for Mongo and Postgres —
    //     did not match at all. The username is optional now.
    //   * `[a-z0-9+.-]*` was unbounded, and a long run of scheme-shaped
    //     characters that never reaches `://` backtracks quadratically: 80KB took
    //     4.7 seconds, reachable from the public intake form. Every quantifier
    //     here is bounded, and the bounds are far above any real URL.
    //
    // The v3 pass bounded the OTHER detector's quantifier and then wrote in the
    // documentation that all of them were bounded, without checking this one.
    name: "credential_in_url",
    pattern: /\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s:@/]{0,256}:([^\s@/]{1,256})@/gi,
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
];

export type SecretDetection = {
  detector: SecretDetectorName;
  count: number;
};

export type RedactionResult = {
  redacted: string;
  /**
   * The strongest classification found, or null when nothing was found.
   *
   * `credential_evidence` refuses a delivery. `ambiguous_secret_candidate`
   * redacts and holds for human clearance. Ordinary security prose produces no
   * finding at all and is returned untouched.
   */
  classification: SecretClassification | null;
  detections: SecretDetection[];
  /** True when anything was replaced. */
  hadSecrets: boolean;
  /**
   * True when the input was longer than the scanner will read.
   *
   * Past `MAX_SCAN_LENGTH` the scanner stops, and everything after that point is
   * UNEXAMINED — which is not the same as clean. The scanner had reported this
   * from the beginning and nothing read it, so a credential at byte 64,001 came
   * back as `classification: null` and `hadSecrets: false`: a silent fail-open on
   * the one function the whole pipeline depends on.
   *
   * Callers deciding whether text is safe must treat this as unsafe. The two
   * that do are below.
   */
  scanTruncated: boolean;
};

function placeholderFor(name: SecretDetectorName): string {
  return `[REDACTED:${name}]`;
}

/**
 * Replaces credential-shaped substrings with a named placeholder.
 *
 * Two layers, and they answer different questions. The vendor DETECTORS know
 * what a particular provider's key looks like, so a finding can say "a GitHub
 * token is committed here" rather than "something secret-looking is". The
 * assignment SCANNER knows what an assignment looks like in the syntaxes a
 * repository actually contains, and does not need to recognise the value at all.
 *
 * Placeholders are inert to both (the `[REDACTED` prefix is on the non-secret
 * allowlist, and no vendor pattern matches a bracketed word), so redaction is
 * idempotent: redacting twice equals redacting once.
 */
export function redactSecrets(input: string): RedactionResult {
  let working = input;
  const detections: SecretDetection[] = [];
  let classification: SecretClassification | null = null;
  const record = (found: SecretClassification) => {
    classification = classification === null ? found : strongerClassification(classification, found);
  };

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
    if (count > 0) {
      detections.push({ detector: detector.name, count });
      // A vendor pattern recognises the VALUE, not just its surroundings. That
      // is the strongest evidence there is: `ghp_…` is a GitHub token wherever
      // it appears, including inside a sentence.
      record("credential_evidence");
    }
  }

  // The assignment scanner runs AFTER the vendor detectors, deliberately.
  //
  // A vendor detector names what it found: "a GitHub token is committed at
  // src/pay.ts:14" is a materially different finding from "something
  // secret-looking is assigned there". Running the scanner first would redact
  // `GITHUB_TOKEN=ghp_...` as a generic assignment and throw that away.
  //
  // Running it second is safe because placeholders are inert to it: the value it
  // would see is `[REDACTED:github_token]`, which is on the non-secret list.
  const scanned = findCredentialSpans(working);
  const scanTruncated = scanned.truncated;
  if (scanned.spans.length > 0) {
    // Assembled in ONE left-to-right pass. Replacing spans individually rebuilds
    // the whole string each time, which is quadratic in the number of spans, and
    // a file of flags produces one span per flag.
    const ordered = [...scanned.spans].sort((a, b) => a.start - b.start || b.end - a.end);
    const pieces: string[] = [];
    let cursor = 0;
    let assigned = 0;

    for (const span of ordered) {
      if (span.start < cursor) continue; // overlapping or nested: the first wins
      pieces.push(working.slice(cursor, span.start), placeholderFor("assigned_secret"));
      cursor = span.end;
      assigned += 1;
      record(span.classification);
    }
    pieces.push(working.slice(cursor));

    working = pieces.join("");
    if (assigned > 0) detections.push({ detector: "assigned_secret", count: assigned });
  }


  return {
    redacted: working,
    detections,
    classification,
    hadSecrets: detections.length > 0,
    scanTruncated,
  };
}

/**
 * True when `text` still holds something credential-shaped, at ANY confidence.
 *
 * Kept for the storage paths, where a hold is as good a reason to act as a
 * certainty. NOT for refusing a customer's input — see `holdsCredentialEvidence`.
 */
export function containsLikelySecret(text: string): boolean {
  const { hadSecrets, scanTruncated } = redactSecrets(text);
  // Same reason as `holdsCredentialEvidence`: an unexamined tail is not a clean
  // one, and this answers "is it safe to pass this along".
  return hadSecrets || scanTruncated;
}

/**
 * True only when we are CONFIDENT this is a credential.
 *
 * The distinction matters where the consequence is refusing a person rather than
 * redacting a string. An audit found the public intake form telling a customer
 * who wrote "Auth: Clerk. Payments: Stripe." to remove the credential, because
 * uncertainty and certainty shared one boolean. A form should refuse what it is
 * sure about and accept the rest; the report pipeline, which can redact and hold,
 * is where uncertainty is handled properly.
 */
export function holdsCredentialEvidence(text: string): boolean {
  const { classification, scanTruncated } = redactSecrets(text);
  // Unexamined is not clean. Text past the scan limit is refused rather than
  // accepted, because this is the function that decides whether a person is
  // turned away — and turning someone away over an oversized field is a worse
  // outcome than accepting a credential only in the sense that it is visible.
  if (scanTruncated) return true;
  return classification !== null && blocksDelivery(classification);
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

export type ExcerptRejection = {
  path: string;
  detectors: SecretDetectorName[];
  /** What this entitles the pipeline to do. See release-rescue-secret-classification. */
  classification: SecretClassification;
};

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
    if (!result.hadSecrets || result.classification === null) return [];
    return [
      {
        path,
        detectors: result.detections.map((detection) => detection.detector),
        classification: result.classification,
      },
    ];
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
