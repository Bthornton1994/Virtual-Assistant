import { createClient } from "@supabase/supabase-js";

/** Server-only privileged client. Never import from a Client Component. */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (typeof window !== "undefined") {
    throw new Error("supabaseAdmin must not run in the browser");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
