import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Hosted Supabase Auth redirect. Unused in demo-cookie mode. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/app/dashboard";
  const supabase = await supabaseServer();
  if (supabase && code) {
    await supabase.auth.exchangeCodeForSession(code);
  }
  const dest = new URL(next.startsWith("/") ? next : "/app/dashboard", url.origin);
  return NextResponse.redirect(dest);
}
