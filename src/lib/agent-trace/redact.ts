/**
 * Redaction helpers for agent-trace and agent-eval reports.
 * Fail-closed: only explicitly allowlisted label keys may retain values.
 * Never persist secrets, raw prompts, or chain-of-thought.
 */

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|session|cookie|bearer)/i;

const SECRET_VALUE_PATTERN =
  /\b(sk-[a-zA-Z0-9]{8,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;

/**
 * Content keys that must never survive sanitization, even if a caller
 * mistakenly allowlists them later. Matched case-insensitively with
 * common separators normalized away.
 */
const SENSITIVE_CONTENT_KEY_PATTERN =
  /^(prompt|prompttext|prompt_text|completion|response|content|body|payload|message|messages|chainofthought|chain_of_thought|cot|raw|systemprompt|system_prompt|userprompt|user_prompt|inputtext|outputtext)$/i;

/**
 * Explicit allowlist of safe observational label keys.
 * Anything else is dropped or redacted — fail closed.
 */
export const SAFE_TRACE_LABEL_KEYS = new Set([
  "caseId",
  "harness",
  "toolClass",
  "toolKey",
  "note",
  "kind",
  "status",
  "graderId",
  "reasonCode",
]);

const REDACTED = "[REDACTED]";

export function isSecretLikeKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function isSensitiveContentKey(key: string): boolean {
  const normalized = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return SENSITIVE_CONTENT_KEY_PATTERN.test(normalized) || SENSITIVE_CONTENT_KEY_PATTERN.test(key.trim());
}

export function isSafeTraceLabelKey(key: string): boolean {
  return SAFE_TRACE_LABEL_KEYS.has(key);
}

export function redactSecretLikeString(value: string): string {
  return value.replace(SECRET_VALUE_PATTERN, REDACTED);
}

/**
 * Fail-closed label sanitization:
 * - secret-like or prompt/CoT/content keys → `[REDACTED]` (key retained for audit)
 * - allowlisted safe keys → value kept after secret-pattern scrub, max 256 chars
 * - all other keys → dropped
 */
export function redactLabels(labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (isSecretLikeKey(key) || isSensitiveContentKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (!isSafeTraceLabelKey(key)) {
      continue;
    }
    out[key] = redactSecretLikeString(value).slice(0, 256);
  }
  return out;
}

/** Hash-friendly minimization: keep a short, stable identifier hash prefix. */
export function minimizeIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 16) return value;
  return value.slice(0, 8) + "…" + value.slice(-4);
}
