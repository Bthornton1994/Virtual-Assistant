type DeploymentEnvironment = Record<string, string | undefined>;

function normalizeOrigin(value: string | undefined) {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the origin that initiated an Auth flow. Preview deployments must
 * prefer Vercel's deployment URL over a stale canonical site variable.
 */
export function deploymentOrigin(env: DeploymentEnvironment = process.env) {
  const candidates =
    env.VERCEL_ENV === "preview"
      ? [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.NEXT_PUBLIC_VERCEL_URL]
      : [
          env.NEXT_PUBLIC_SITE_URL,
          env.NEXT_PUBLIC_APP_URL,
          env.VERCEL_PROJECT_PRODUCTION_URL,
          env.VERCEL_URL,
        ];

  for (const candidate of candidates) {
    const origin = normalizeOrigin(candidate);
    if (origin) return origin;
  }

  return "http://localhost:3000";
}
