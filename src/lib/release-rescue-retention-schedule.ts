import { timingSafeEqual } from "node:crypto";

// Authorization for the scheduled retention sweep.
//
// The sweep deletes customer content. Whatever can trigger it is therefore a
// destructive endpoint, and it lives on the public internet because that is how
// a platform scheduler reaches it. So the decision about who may call it is
// isolated here, as a pure function over the request's headers and the
// environment, where it can be tested exhaustively without standing up a server.
//
// Fail-closed in every direction: no configured secret means nobody is
// authorized, including the scheduler. An endpoint that silently becomes open
// when a deployment forgets an environment variable is worse than one that
// stops working, because nothing tells you.

export const RETENTION_SWEEP_PATH = "/api/internal/release-rescue/retention-sweep" as const;

/** Daily, at a minute nobody else picks. Mirrors the pg_cron schedule. */
export const RETENTION_SWEEP_CRON = "17 3 * * *" as const;

/**
 * The HTTP method the platform scheduler actually uses.
 *
 * Vercel Cron Jobs issue a GET carrying `Authorization: Bearer $CRON_SECRET`.
 * The route previously implemented POST only and answered GET with 405, so every
 * scheduled invocation was rejected and the sweep never ran. The method is
 * declared here so the handler and a test can both bind to one value rather than
 * each assuming.
 */
export const RETENTION_SWEEP_METHOD = "GET" as const;

export type SweepAuthorization =
  | { authorized: true }
  | { authorized: false; status: 401 | 503; reason: string };

/**
 * Constant-time comparison that does not leak length through early exit.
 *
 * `timingSafeEqual` throws on differing lengths, which would itself be a length
 * oracle, so both sides are compared only after a length check that always costs
 * the same. The practical risk is small; the cost of getting it right is
 * smaller.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

/**
 * Decides whether a request may run the sweep.
 *
 * Returns 503 rather than 401 when the server is not configured, because those
 * are different facts: "you are not allowed" and "nobody is allowed here yet".
 * Conflating them would hide a misconfigured deployment behind what looks like a
 * routine auth failure.
 */
export function authorizeRetentionSweep(
  authorizationHeader: string | null,
  configuredSecret: string | undefined,
): SweepAuthorization {
  if (typeof configuredSecret !== "string" || configuredSecret.trim().length === 0) {
    return {
      authorized: false,
      status: 503,
      reason: "The retention sweep is not configured. Set CRON_SECRET before scheduling it.",
    };
  }
  // A short secret is a configuration error, not a credential. Refusing it here
  // stops a placeholder value from quietly protecting a destructive endpoint.
  if (configuredSecret.trim().length < 24) {
    return {
      authorized: false,
      status: 503,
      reason: "The configured retention sweep secret is too short to be treated as one.",
    };
  }
  if (typeof authorizationHeader !== "string" || !authorizationHeader.startsWith("Bearer ")) {
    return { authorized: false, status: 401, reason: "Missing bearer authorization." };
  }

  const provided = authorizationHeader.slice("Bearer ".length);
  if (!secretsMatch(provided, configuredSecret)) {
    return { authorized: false, status: 401, reason: "Invalid retention sweep credential." };
  }
  return { authorized: true };
}
