const PROTECTED_PREFIXES = ["/app", "/ops"];

export type AuthRedirectDecision =
  | { type: "next" }
  | { type: "redirect"; pathname: string; next?: string };

export function sanitizeNext(next: string | null | undefined) {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.startsWith("/login") || next.startsWith("/signup")) return null;
  return next;
}

export function resolveAuthRedirect(input: {
  pathname: string;
  hasSupabaseUser: boolean;
  hasDemoSession: boolean;
  nextParam?: string | null;
}): AuthRedirectDecision {
  const isProtected = PROTECTED_PREFIXES.some((p) => input.pathname === p || input.pathname.startsWith(`${p}/`));
  const isLogin = input.pathname === "/login";

  if (isProtected && !input.hasSupabaseUser && !input.hasDemoSession) {
    return { type: "redirect", pathname: "/login", next: sanitizeNext(input.pathname) ?? undefined };
  }

  // Production identity only. A demo cookie must never bounce /login into /app.
  if (isLogin && input.hasSupabaseUser) {
    return { type: "redirect", pathname: sanitizeNext(input.nextParam) ?? "/app/dashboard" };
  }

  return { type: "next" };
}
