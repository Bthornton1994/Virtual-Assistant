const SECRET_VALUE_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "github_pat", pattern: /\bghp_[A-Za-z0-9_]{20,}/ },
  { name: "github_fine_grained_pat", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { name: "gitlab_pat", pattern: /\bglpat-[A-Za-z0-9_\-]{20,}/ },
  { name: "slack_token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "stripe_live_secret", pattern: /\bsk_live_[A-Za-z0-9]{16,}/ },
  { name: "stripe_test_secret", pattern: /\bsk_test_[A-Za-z0-9]{16,}/ },
  { name: "aws_access_key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private_key_pem", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./ },
  { name: "supabase_service_role", pattern: /\beyJ[A-Za-z0-9_-]+.*service_role/i },
];

const ASSIGNMENT_WITH_VALUE =
  /\b(?:api[_-]?key|secret|password|token|private[_-]?key|access[_-]?key)\s*[=:]\s*['"]?[^\s'"]{8,}/i;

export const REDACTION_MARKER = "REDACTED_VALUE_FOUND_IN_SOURCE";

export type SecretScanResult = { ok: true } | { ok: false; reason: string };

export function scanTextForSecrets(value: string): SecretScanResult {
  if (!value) return { ok: true };
  if (value.includes(REDACTION_MARKER) && !hasUnredactedSecret(value)) return { ok: true };
  if (hasUnredactedSecret(value)) {
    return {
      ok: false,
      reason: "This field looks like it contains a credential or token. Remove it. Access is granted separately.",
    };
  }
  return { ok: true };
}

function hasUnredactedSecret(value: string): boolean {
  const masked = value.replaceAll(REDACTION_MARKER, "");
  for (const { pattern } of SECRET_VALUE_PATTERNS) {
    if (pattern.test(masked)) return true;
  }
  return ASSIGNMENT_WITH_VALUE.test(masked);
}

export function redactSecretSnippets(value: string): string {
  let next = value;
  for (const { pattern } of SECRET_VALUE_PATTERNS) {
    next = next.replace(pattern, `"${REDACTION_MARKER}"`);
  }
  next = next.replace(ASSIGNMENT_WITH_VALUE, (match) => {
    const name = match.split(/[=:]/)[0]?.trim() ?? "SECRET";
    return `${name} = "${REDACTION_MARKER}"`;
  });
  return next;
}

const FORBIDDEN_EVIDENCE_NAME = /(\.env(?:\.|$)|(?:^|\/)id_(?:rsa|ed25519|ecdsa)|credentials\.json|\.pem$|\.p12$|\.key$)/i;

export function isForbiddenEvidenceFilename(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const base = trimmed.split(/[/\\]/).pop() ?? trimmed;
  return FORBIDDEN_EVIDENCE_NAME.test(base) || base.toLowerCase() === ".env";
}

export function urlContainsCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return true;
    const joined = `${parsed.search}#${parsed.hash}`.toLowerCase();
    return /(?:token|access_token|secret|password|pat)=/.test(joined);
  } catch {
    return /https?:\/\/[^/\s]+[:@]/.test(url);
  }
}
