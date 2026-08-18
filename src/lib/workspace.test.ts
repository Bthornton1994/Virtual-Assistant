import { describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import { getWorkspace } from "@/lib/workspace";
import { seedData, MemoryStore } from "@/lib/store";

describe("workspace isolation", () => {
  it("serves MemoryStore only to demo actors", async () => {
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    expect(founder.source).toBe("demo");
    const request = await getWorkspace(founder).getRequest(founder, "req_conference");
    expect(request.title).toMatch(/conference/i);
  });

  it("never hands a MemoryStore to a production actor", () => {
    const actor = {
      id: "usr_real",
      email: "founder@example.com",
      name: "Real Founder",
      role: "client_admin" as const,
      organizationId: "org_real",
      operatorId: null,
      source: "supabase" as const,
    };
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const prevPub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    expect(() => getWorkspace(actor)).toThrow(DomainError);
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://qbvmtgaphvpwpwemplje.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    const ws = getWorkspace(actor);
    expect(ws.constructor.name).toBe("SupabaseWorkspaceRepository");
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevKey;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = prevPub;
  });
});
