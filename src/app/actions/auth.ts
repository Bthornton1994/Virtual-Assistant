"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth-cookie";
import { isOpsRole } from "@/lib/domain";
import { getStore } from "@/lib/store";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 14,
  };
}

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "");
  const store = getStore();
  const actor = store.authenticate(email, password);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, actor.id, cookieOptions());
  if (next.startsWith("/")) redirect(next);
  redirect(isOpsRole(actor.role) ? "/ops/dashboard" : "/app/dashboard");
}

export async function signupAction(formData: FormData) {
  const store = getStore();
  const actor = store.signup({
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || "demo"),
    organization: String(formData.get("organization") || "").trim(),
    industry: String(formData.get("industry") || "").trim(),
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, actor.id, cookieOptions());
  redirect("/app/dashboard");
}

export async function logoutAction() {
  const store = getStore();
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  const actor = id ? store.actorFromUser(id) : null;
  if (actor) {
    store.data.audits.unshift({
      id: `au_${Date.now()}`,
      organizationId: actor.organizationId,
      actorId: actor.id,
      action: "auth.logout",
      entityType: "user",
      entityId: actor.id,
      metadata: {},
      createdAt: new Date().toISOString(),
    });
  }
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
  redirect("/");
}

export async function demoLoginAction(userId: string, next = "") {
  const store = getStore();
  const actor = store.actorFromUser(userId);
  if (!actor) throw new Error("Unknown demo account");
  const jar = await cookies();
  jar.set(SESSION_COOKIE, actor.id, cookieOptions());
  if (next.startsWith("/")) redirect(next);
  redirect(isOpsRole(actor.role) ? "/ops/dashboard" : "/app/dashboard");
}
