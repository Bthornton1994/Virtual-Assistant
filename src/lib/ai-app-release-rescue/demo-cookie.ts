/**
 * Whether the demo engagement cookie should carry the Secure attribute.
 *
 * Next.js `cookies().set({ secure })` maps to the cookie Secure flag: the
 * cookie is sent only over HTTPS. See
 * https://nextjs.org/docs/app/api-reference/functions/cookies
 * and https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie#secure
 *
 * Production on Vercel is HTTPS, so Secure is required. Local `next dev` and
 * Playwright against `next start` on http://127.0.0.1 cannot ship a hardcoded
 * Secure=false default into production; they omit Secure only when the request
 * is actually HTTP. That local HTTP constraint is documented, not a shipped
 * insecure default.
 */
export function demoEngagementCookieSecure(input: {
  forwardedProto?: string | null;
  vercel?: string;
  nodeEnv?: string;
}): boolean {
  const proto = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (proto === "https") return true;
  if (proto === "http") return false;
  if (input.vercel) return true;
  return input.nodeEnv === "production";
}
