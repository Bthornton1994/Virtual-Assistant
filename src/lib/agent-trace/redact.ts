/**
 * Redaction helpers for agent-trace and agent-eval reports.
 * Never persist secrets, raw prompts, or chain-of-thought.
 */

const SECRET_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|authorization|credential|private[_-]?key|session|cookie|bearer)/i;

const SECRET_VALUE_PATTERN =
  /\b(sk-[a-zA-Z0-9]{8,}|Bearer\s+[A-Za-z0-9\-._~+/]+=*|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;

const REDACTED = "[REDACTED]";

export function isSecretLikeKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

export function redactSecretLikeString(value: string): string {
  return value.replace(SECRET_VALUE_PATTERN, REDACTED);
}

export function redactLabels(labels: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (isSecretLikeKey(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactSecretLikeString(value).slice(0, 256);
  }
  return out;
}

/** Hash-friendly minimization: keep a short, stable identifier hash prefix. */
export function minimizeIdentifier(value: string | null | undefined): string | null {
  if (!value) return null;
  // Callers should usually pass a pre-hashed id. When they pass a raw id,
  // we still avoid logging the full value by truncating after a local digest
  // would be preferred — use sha256Hex at the call site when available.
  if (value.length <= 16) return value;
  return value.slice(0, 8) + "…" + value.slice(-4);
}
