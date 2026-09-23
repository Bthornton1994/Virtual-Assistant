// Whether the internal, local-only Release Rescue workflow is switched on.
//
// It is off unless an operator switches it on for a process on their own
// machine, and it refuses to run anywhere that looks like a deployment. This is
// an internal-use tool: it reads source from a local checkout, stores drafts
// on the local disk, and authenticates a reviewer against credentials that
// exist only in a local, gitignored directory. None of that is a production
// path, and the gate below is what keeps it from becoming one by accident.

export const INTERNAL_MODE_ENV = "RELEASE_RESCUE_INTERNAL";
export const INTERNAL_MODE_VALUE = "local";

type Env = Readonly<Record<string, string | undefined>>;

export type InternalModeDecision =
  | { enabled: true }
  | { enabled: false; reason: "not_switched_on" | "deployment_environment" };

/**
 * On only when `RELEASE_RESCUE_INTERNAL=local` is set AND nothing says this is
 * a Vercel deployment. A deployment that inherits the variable by mistake still
 * refuses, because the second condition does not depend on anyone remembering
 * to unset the first.
 */
export function internalModeDecision(env: Env = process.env): InternalModeDecision {
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) {
    return { enabled: false, reason: "deployment_environment" };
  }
  if (env[INTERNAL_MODE_ENV] !== INTERNAL_MODE_VALUE) {
    return { enabled: false, reason: "not_switched_on" };
  }
  return { enabled: true };
}

export function internalModeEnabled(env: Env = process.env): boolean {
  return internalModeDecision(env).enabled;
}

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

function hostnameOf(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

/**
 * The request came to a loopback address, from a loopback address, with no
 * proxy in between.
 *
 * Defence in depth, not the control: the control is starting the server with
 * `--hostname 127.0.0.1`, which makes it unreachable from anywhere else.
 *
 * `next start` fills in `x-forwarded-host` (a copy of `host`) and
 * `x-forwarded-for` (the socket's address) on every request, but only when the
 * request does not already carry them. So a direct local request arrives with a
 * forwarded host equal to its host and a single loopback forwarded address,
 * while anything a client or a proxy set survives and is refused here.
 */
export function isLoopbackRequest(headers: { get(name: string): string | null }): boolean {
  const host = headers.get("host");
  if (!host || !LOOPBACK_HOSTNAMES.has(hostnameOf(host))) return false;
  const forwardedHost = headers.get("x-forwarded-host");
  if (forwardedHost !== null && forwardedHost !== host) return false;
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor !== null && !LOOPBACK_ADDRESSES.has(forwardedFor.trim())) return false;
  return true;
}
