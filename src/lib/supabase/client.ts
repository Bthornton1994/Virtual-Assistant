import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";

export function supabaseBrowser() {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}

export { supabaseConfigured } from "@/lib/supabase/env";
