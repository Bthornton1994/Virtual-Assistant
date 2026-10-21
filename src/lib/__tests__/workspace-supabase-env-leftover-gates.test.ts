import { afterEach, describe, expect, it } from "vitest";
import { DomainError } from "@/lib/domain";
import { MemoryStore, seedData } from "@/lib/store";
import { supabaseConfigured, supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { getWorkspace } from "@/lib/workspace";

const ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const productionActor = {
  id: "usr_real",
  email: "founder@example.com",
  name: "Real Founder",
  role: "client_admin" as const,
  organizationId: "org_real",
  operatorId: null,
  source: "supabase" as const,
};

afterEach(() => {
  restoreEnv();
});

describe("workspace leftover env-pairing gates", () => {
  it("does not hand MemoryStore to leftover production actors when only the URL is set", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://qbvmtgaphvpwpwemplje.supabase.co";
    expect(() => getWorkspace(productionActor)).toThrow(DomainError);
  });

  it("does not hand MemoryStore to leftover production actors when only a publishable key is set", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    expect(() => getWorkspace(productionActor)).toThrow(DomainError);
  });

  it("treats leftover empty-string URL or key as unconfigured", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    expect(() => getWorkspace(productionActor)).toThrow(DomainError);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://qbvmtgaphvpwpwemplje.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    expect(() => getWorkspace(productionActor)).toThrow(DomainError);
  });

  it("still serves MemoryStore to leftover demo actors when Supabase env is present", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://qbvmtgaphvpwpwemplje.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
    const store = new MemoryStore(seedData());
    const founder = store.actorFromUser("usr_founder")!;
    expect(founder.source).toBe("demo");
    expect(getWorkspace(founder).constructor.name).toBe("MemoryStore");
  });

  it("accepts leftover ANON pairing when the publishable key is missing", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://qbvmtgaphvpwpwemplje.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "sb_anon_test";
    expect(getWorkspace(productionActor).constructor.name).toBe("SupabaseWorkspaceRepository");
  });
});

describe("supabase env leftover pairing gates", () => {
  it("falls back to leftover ANON only when the publishable key is missing", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    expect(supabaseConfigured()).toBe(true);
    expect(supabasePublishableKey()).toBe("anon-key");

    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    expect(supabasePublishableKey()).toBe("publishable-key");
  });

  it("does not treat leftover empty strings as a configured project", () => {
    clearEnv();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "";
    expect(supabaseUrl()).toBe("");
    expect(supabasePublishableKey()).toBe("");
    expect(supabaseConfigured()).toBe(false);
  });
});
