import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Hosted Supabase Auth redirect. Unused in demo-cookie mode. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const type = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next") || "";
  const next = type === "recovery" ? "/login/reset" : nextParam || "/app/dashboard";
  const supabase = await supabaseServer();
  if (supabase && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(new URL("/login?error=unavailable", url.origin));
    }
  }
  const dest = new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/app/dashboard", url.origin);
  return NextResponse.redirect(dest);
}
