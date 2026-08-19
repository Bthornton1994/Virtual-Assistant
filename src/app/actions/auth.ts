"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_SESSION_COOKIE, LEGACY_SESSION_COOKIE } from "@/lib/auth-cookie";
import { isOpsRole } from "@/lib/domain";
import { getStore } from "@/lib/store";
import { supabaseServer } from "@/lib/supabase/server";
import { observe } from "@/lib/observe";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  };
}

function loginError(code: string, next = "") {
  const qs = new URLSearchParams();
  qs.set("error", code);
  if (next) qs.set("next", next);
  redirect(`/login?${qs.toString()}`);
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "");
  const supabase = await supabaseServer();
  if (!supabase) loginError("unavailable", next);
  const client = supabase!;
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    observe({ level: "warn", area: "auth", message: "Password login failed", error });
    loginError("invalid", next);
  }
  const jar = await cookies();
  jar.set(LEGACY_SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  if (next.startsWith("/") && !next.startsWith("/login")) redirect(next);
  redirect("/app/dashboard");
}

export async function requestPasswordResetAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const supabase = await supabaseServer();
  if (!supabase) redirect("/login/forgot?error=unavailable");
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://virtual-assistant-bryant4.vercel.app";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/login/reset`,
  });
  if (error) redirect("/login/forgot?sent=1");
  redirect("/login/forgot?sent=1");
}

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (password.length < 10) redirect("/login/reset?error=short");
  if (password !== confirm) redirect("/login/reset?error=mismatch");
  const supabase = await supabaseServer();
  if (!supabase) redirect("/login/reset?error=unavailable");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) redirect("/login/reset?error=failed");
  redirect("/app/dashboard");
}

export async function logoutAction() {
  const supabase = await supabaseServer();
  if (supabase) await supabase.auth.signOut();
  const jar = await cookies();
  jar.set(DEMO_SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  jar.set(LEGACY_SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  redirect("/");
}

export async function demoPasswordLoginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "");
  const store = getStore();
  let actor;
  try {
    actor = store.authenticate(email, password);
  } catch {
    redirect("/demo?error=invalid");
  }
  const jar = await cookies();
  jar.set(DEMO_SESSION_COOKIE, actor.id, cookieOptions());
  jar.set(LEGACY_SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  if (next.startsWith("/") && !next.startsWith("/login")) redirect(next);
  redirect(isOpsRole(actor.role) ? "/ops/dashboard" : "/app/dashboard");
}

export async function demoLoginAction(userId: string, next = "") {
  const store = getStore();
  const actor = store.actorFromUser(userId);
  if (!actor) throw new Error("Unknown demo account");
  const jar = await cookies();
  jar.set(DEMO_SESSION_COOKIE, actor.id, cookieOptions());
  jar.set(LEGACY_SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  if (next.startsWith("/") && !next.startsWith("/login")) redirect(next);
  redirect(isOpsRole(actor.role) ? "/ops/dashboard" : "/app/dashboard");
}
