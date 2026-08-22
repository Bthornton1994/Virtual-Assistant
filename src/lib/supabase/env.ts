/** Browser-safe project URL + publishable/anon key. Never includes the service role. */
export function supabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

export function supabasePublishableKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  );
}

export function supabaseConfigured() {
  return Boolean(supabaseUrl() && supabasePublishableKey());
}
