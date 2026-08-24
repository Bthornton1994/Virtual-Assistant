import { Buffer } from "node:buffer";
import { createClient } from "@supabase/supabase-js";

function projectRefFromUrl(url: string) {
  try {
    const hostname = new URL(url).hostname;
    if (!hostname.endsWith(".supabase.co")) return null;
    return hostname.split(".")[0] || null;
  } catch {
    return null;
  }
}

export function projectRefFromServiceRoleKey(key: string) {
  const payload = key.split(".")[1];
  if (!payload) return null;

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      ref?: unknown;
    };
    return typeof decoded.ref === "string" && decoded.ref ? decoded.ref : null;
  } catch {
    return null;
  }
}

export function serviceRoleMatchesProject(input: {
  url: string;
  key: string;
  configuredProjectRef?: string;
}) {
  const urlProjectRef = projectRefFromUrl(input.url);
  const embeddedProjectRef = projectRefFromServiceRoleKey(input.key);
  const configuredProjectRef = input.configuredProjectRef?.trim() || null;

  if (!urlProjectRef) return false;
  if (embeddedProjectRef && configuredProjectRef && embeddedProjectRef !== configuredProjectRef) {
    return false;
  }

  return (embeddedProjectRef || configuredProjectRef) === urlProjectRef;
}

/** Server-only privileged client. Never import from a Client Component. */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin must not run in the browser");
  }

  const configuredProjectRef = process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF;
  if (!serviceRoleMatchesProject({ url, key, configuredProjectRef })) {
    console.error("[supabase.admin] Refusing unverified or mismatched privileged credentials", {
      urlProjectRef: projectRefFromUrl(url) || "invalid-url",
      keyProjectRef: projectRefFromServiceRoleKey(key) || configuredProjectRef || "unverified",
    });
    return null;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
