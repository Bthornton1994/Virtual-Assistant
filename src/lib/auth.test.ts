import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_SESSION_COOKIE, LEGACY_SESSION_COOKIE } from "@/lib/auth-cookie";
import { resetStore, seedData } from "@/lib/store";

const cookieJar = new Map<string, string>();
const cookieSet = vi.fn((name: string, value: string) => {
  if (!value) cookieJar.delete(name);
  else cookieJar.set(name, value);
});

const supabaseServer = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.get(name);
      return value === undefined ? undefined : { value };
    },
    set: cookieSet,
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirect(url),
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: () => supabaseServer(),
}));

import { clearLegacySessionCookie, getSession, requireClient, requireManager, requireOps } from "@/lib/auth";

function supabaseClient(handlers: {
  getUser: { id: string; email: string; name?: string } | null;
  operators?: { id: string; name: string; platform_role: string } | null;
  memberships?: Array<{ id: string; organization_id: string; role: string; status: string }>;
  updateError?: Error | null;
}) {
  const membershipUpdates: Array<Record<string, unknown>> = [];
  const invitationUpdates: Array<Record<string, unknown>> = [];

  return {
    membershipUpdates,
    invitationUpdates,
    auth: {
      getUser: async () =>
        handlers.getUser
          ? { data: { user: { id: handlers.getUser.id, email: handlers.getUser.email, user_metadata: { name: handlers.getUser.name } } }, error: null }
          : { data: { user: null }, error: null },
    },
    from(table: string) {
      const state = { updating: false, payload: null as Record<string, unknown> | null };
      const builder = {
        select() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          state.updating = true;
          state.payload = payload;
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => {
          if (table === "operators") {
            return { data: handlers.operators ?? null, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (value: { data: unknown; error: unknown }) => unknown) {
          if (table === "organization_members") {
            if (state.updating) {
              membershipUpdates.push(state.payload ?? {});
              return Promise.resolve({ data: null, error: handlers.updateError ?? null }).then(resolve);
            }
            return Promise.resolve({ data: handlers.memberships ?? [], error: null }).then(resolve);
          }
          if (table === "invitations") {
            invitationUpdates.push(state.payload ?? {});
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };
}

describe("session resolution and role gates", () => {
  beforeEach(() => {
    cookieJar.clear();
    cookieSet.mockClear();
    redirect.mockClear();
    supabaseServer.mockReset();
    supabaseServer.mockResolvedValue(null);
    resetStore(seedData());
  });

  it("clears a legacy session cookie without trusting it as identity", async () => {
    cookieJar.set(LEGACY_SESSION_COOKIE, "usr_founder");
    await clearLegacySessionCookie();
    expect(cookieSet).toHaveBeenCalledWith(LEGACY_SESSION_COOKIE, "", { path: "/", maxAge: 0 });
    expect(await getSession()).toBeNull();
  });

  it("loads a demo actor from the isolated demo cookie", async () => {
    cookieJar.set(DEMO_SESSION_COOKIE, "usr_founder");
    const session = await getSession();
    expect(session).toMatchObject({
      id: "usr_founder",
      role: "client_admin",
      organizationId: "org_northline",
      source: "demo",
    });
  });

  it("maps an operators row to a staff actor with no organization", async () => {
    supabaseServer.mockResolvedValue(
      supabaseClient({
        getUser: { id: "usr_op_live", email: "op@delegation.cloud", name: "Priya" },
        operators: { id: "op_priya", name: "Priya Rao", platform_role: "ops_manager" },
      }),
    );
    const session = await getSession();
    expect(session).toEqual({
      id: "usr_op_live",
      email: "op@delegation.cloud",
      name: "Priya Rao",
      role: "ops_manager",
      organizationId: null,
      operatorId: "op_priya",
      source: "supabase",
    });
  });

  it("activates an invited membership and records invitation acceptance", async () => {
    const client = supabaseClient({
      getUser: { id: "usr_invitee", email: "Ada@Newco.example", name: "Ada" },
      operators: null,
      memberships: [
        { id: "mem_invite", organization_id: "org_newco", role: "client_admin", status: "invited" },
      ],
    });
    supabaseServer.mockResolvedValue(client);

    const session = await getSession();
    expect(session).toMatchObject({
      id: "usr_invitee",
      email: "Ada@Newco.example",
      role: "client_admin",
      organizationId: "org_newco",
      operatorId: null,
      source: "supabase",
    });
    expect(client.membershipUpdates).toEqual([{ status: "active" }]);
    expect(client.invitationUpdates[0]).toMatchObject({ status: "active" });
    expect(typeof client.invitationUpdates[0]?.accepted_at).toBe("string");
  });

  it("does not activate an invitation when the membership update fails", async () => {
    const client = supabaseClient({
      getUser: { id: "usr_invitee", email: "ada@newco.example", name: "Ada" },
      operators: null,
      memberships: [
        { id: "mem_invite", organization_id: "org_newco", role: "client_admin", status: "invited" },
      ],
      updateError: new Error("write denied"),
    });
    supabaseServer.mockResolvedValue(client);

    const session = await getSession();
    expect(session).toMatchObject({
      role: "client_member",
      organizationId: null,
      source: "supabase",
    });
    expect(client.invitationUpdates).toEqual([]);
  });

  it("sends a production client without an org back to login", async () => {
    supabaseServer.mockResolvedValue(
      supabaseClient({
        getUser: { id: "usr_orphan", email: "orphan@example.com" },
        operators: null,
        memberships: [],
      }),
    );
    await expect(requireClient()).rejects.toThrow("REDIRECT:/login?error=no_org");
  });

  it("keeps operators out of the client workspace", async () => {
    cookieJar.set(DEMO_SESSION_COOKIE, "usr_op");
    await expect(requireClient()).rejects.toThrow("REDIRECT:/ops/dashboard");
  });

  it("keeps clients out of ops and operators out of manager surfaces", async () => {
    cookieJar.set(DEMO_SESSION_COOKIE, "usr_founder");
    await expect(requireOps()).rejects.toThrow("REDIRECT:/app/dashboard");

    cookieJar.set(DEMO_SESSION_COOKIE, "usr_op");
    await expect(requireManager()).rejects.toThrow("REDIRECT:/ops/queue");
  });
});
