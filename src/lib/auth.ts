import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor } from "@/lib/domain";
import { isClientRole, isOpsRole } from "@/lib/domain";
import { getStore } from "@/lib/store";
import { supabaseServer } from "@/lib/supabase/server";
import { SESSION_COOKIE } from "@/lib/auth-cookie";

export { SESSION_COOKIE };

export async function getSession(): Promise<Actor | null> {
  const store = getStore();
  const jar = await cookies();
  const demoId = jar.get(SESSION_COOKIE)?.value;
  if (demoId) {
    return store.actorFromUser(demoId);
  }

  const supabase = await supabaseServer();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const mapped = store.actorFromUser(data.user.id);
  if (mapped) return mapped;
  return {
    id: data.user.id,
    email: data.user.email ?? "",
    name: (data.user.user_metadata?.name as string) || data.user.email || "User",
    role: "client_member",
    organizationId: null,
    operatorId: null,
  };
}

export async function requireSession(): Promise<Actor> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireClient(): Promise<Actor> {
  const session = await requireSession();
  if (!isClientRole(session.role) && session.role !== "platform_admin") {
    redirect("/ops/dashboard");
  }
  return session;
}

export async function requireOps(): Promise<Actor> {
  const session = await requireSession();
  if (!isOpsRole(session.role)) {
    redirect("/app/dashboard");
  }
  return session;
}

export async function requireManager(): Promise<Actor> {
  const session = await requireOps();
  if (session.role === "operator") {
    redirect("/ops/queue");
  }
  return session;
}
