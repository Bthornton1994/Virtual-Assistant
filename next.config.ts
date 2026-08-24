import type { NextConfig } from "next";

const previewSupabaseEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://qbvmtgaphvpwpwemplje.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_Tl55fEkqLrElRf2O4j_Z6g_Vpi6qi6y",
};

/**
 * Every Vercel Preview is Delegation Cloud QA. The publishable key is designed
 * for browser use and remains protected by Auth plus RLS. Production never
 * inherits this fallback; it must use its own explicitly configured project.
 */
const nextConfig: NextConfig = {
  ...(process.env.VERCEL_ENV === "preview" ? { env: previewSupabaseEnv } : {}),
  async headers() {
    return [
      {
        source: "/ops/requests/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
