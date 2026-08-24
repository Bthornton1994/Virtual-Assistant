"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEMO_SESSION_COOKIE, LEGACY_SESSION_COOKIE } from "@/lib/auth-cookie";
import { deploymentOrigin } from "@/lib/deployment-origin";
import { isOpsRole } from "@/lib/domain";
import { getStore } from "@/lib/store";
import { supabaseServer } from "@/lib/supabase/server";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  };
}

function loginError(code: string, next = ""): never {
  const qs = new URLSearchParams();
  qs.set("error", code);
  if (next) qs.set("next", next);
  redirect(`/login?${qs.toString()}`);
}

function authConfigState() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  let projectRef = "unconfigured";
  if (url) {
    try {
      projectRef = new URL(url).hostname.split(".")[0] || "invalid-url";
    } catch {
      projectRef = "invalid-url";
    }
  }

  return {
    vercelEnvironment: process.env.VERCEL_ENV || "non-vercel",
    projectRef,
    hasUrl: Boolean(url),
    hasPublishableKey: Boolean(publishableKey),
  };
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "");
  const supabase = await supabaseServer();

  if (!supabase) {
    console.error("[auth.login] Supabase client unavailable", authConfigState());
    loginError("unavailable", next);
  }

  const result = await supabase.auth.signInWithPassword({ email, password }).catch((error: unknown) => {
    console.error("[auth.login] Supabase request failed", {
      ...authConfigState(),
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return null;
  });

  if (!result) loginError("service_unavailable", next);

  const { data, error } = result;
  if (error || !data.user) {
    console.warn("[auth.login] credentials rejected", {
      ...authConfigState(),
      errorCode: error?.code || "user-missing",
      status: error?.status || null,
    });
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

  if (!supabase) {
    console.error("[auth.reset] Supabase client unavailable", authConfigState());
    redirect("/login/forgot?error=unavailable");
  }

  const origin = deploymentOrigin();
  const result = await supabase.auth
    .resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/login/reset`,
    })
    .catch((error: unknown) => {
      console.error("[auth.reset] Supabase request failed", {
        ...authConfigState(),
        errorName: error instanceof Error ? error.name : "unknown",
      });
      return null;
    });

  if (!result) redirect("/login/forgot?error=service_unavailable");

  if (result.error) {
    console.warn("[auth.reset] request rejected", {
      ...authConfigState(),
      errorCode: result.error.code || "auth-error",
      status: result.error.status || null,
    });
  }

  redirect("/login/forgot?sent=1");
}

export async function updatePasswordAction(formData: FormData) {
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  if (password.length < 10) redirect("/login/reset?error=short");
  if (password !== confirm) redirect("/login/reset?error=mismatch");

  const supabase = await supabaseServer();
  if (!supabase) {
    console.error("[auth.password] Supabase client unavailable", authConfigState());
    redirect("/login/reset?error=unavailable");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    console.warn("[auth.password] update rejected", {
      ...authConfigState(),
      errorCode: error.code || "auth-error",
      status: error.status || null,
    });
    redirect("/login/reset?error=failed");
  }

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
