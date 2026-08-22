import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Actor, Role } from "@/lib/domain";
import { isClientRole, isOpsRole } from "@/lib/domain";
import { DEMO_SESSION_COOKIE, LEGACY_SESSION_COOKIE } from "@/lib/auth-cookie";
import { getStore } from "@/lib/store";
import { supabaseServer } from "@/lib/supabase/server";

export { DEMO_SESSION_COOKIE, LEGACY_SESSION_COOKIE };
export { SESSION_COOKIE } from "@/lib/auth-cookie";

export async function clearLegacySessionCookie() {
  const jar = await cookies();
  if (jar.get(LEGACY_SESSION_COOKIE)?.value) {
    jar.set(LEGACY_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  }
}

export async function getSession(): Promise<Actor | null> {
  await clearLegacySessionCookie();

  const supabase = await supabaseServer();
  if (supabase) {
    const { data, error } = await supabase.auth.getUser();
    if (!error && data.user) {
      return loadSupabaseActor({
        id: data.user.id,
        email: data.user.email ?? "",
        name: (data.user.user_metadata?.name as string) || data.user.email || "Member",
        supabase,
      });
    }
  }

  const jar = await cookies();
  const demoId = jar.get(DEMO_SESSION_COOKIE)?.value;
  if (!demoId) return null;
  const actor = getStore().actorFromUser(demoId);
  return actor ? { ...actor, source: "demo" } : null;
}

async function loadSupabaseActor(input: {
  id: string;
  email: string;
  name: string;
  supabase: NonNullable<Awaited<ReturnType<typeof supabaseServer>>>;
}): Promise<Actor> {
  const { data: operator } = await input.supabase
    .from("operators")
    .select("id, name, platform_role")
    .eq("user_id", input.id)
    .maybeSingle();

  if (operator) {
    return {
      id: input.id,
      email: input.email,
      name: operator.name || input.name,
      role: operator.platform_role as Role,
      organizationId: null,
      operatorId: operator.id,
      source: "supabase",
    };
  }

  const { data: memberships } = await input.supabase
    .from("organization_members")
    .select("id, organization_id, role, status")
    .eq("user_id", input.id);

  let membership = (memberships ?? []).find((row) => row.status === "active");
  const invited = (memberships ?? []).find((row) => row.status === "invited");
  if (!membership && invited) {
    const { error } = await input.supabase
      .from("organization_members")
      .update({ status: "active" })
      .eq("id", invited.id)
      .eq("user_id", input.id);
    if (!error) {
      membership = { ...invited, status: "active" };
      await input.supabase
        .from("invitations")
        .update({ status: "active", accepted_at: new Date().toISOString() })
        .eq("organization_id", invited.organization_id)
        .eq("email", input.email.toLowerCase());
    }
  }

  return {
    id: input.id,
    email: input.email,
    name: input.name,
    role: (membership?.role as Role) ?? "client_member",
    organizationId: membership?.organization_id ?? null,
    operatorId: null,
    source: "supabase",
  };
}

export async function requireSession(): Promise<Actor> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireClient(): Promise<Actor> {
  const session = await requireSession();
  if (session.source === "supabase" && !session.organizationId && !isOpsRole(session.role)) {
    redirect("/login?error=no_org");
  }
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
