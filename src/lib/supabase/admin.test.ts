import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it } from "vitest";
import {
  projectRefFromServiceRoleKey,
  serviceRoleMatchesProject,
  supabaseAdmin,
} from "@/lib/supabase/admin";

function serviceRoleJwt(ref: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ ref, role: "service_role" })).toString("base64url");
  return `${header}.${payload}.test-signature`;
}

describe("Supabase privileged credential pairing", () => {
  it("extracts the project ref from a legacy service-role JWT", () => {
    expect(projectRefFromServiceRoleKey(serviceRoleJwt("project-a"))).toBe("project-a");
  });

  it("accepts a service-role JWT only for its own project", () => {
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: serviceRoleJwt("project-a"),
      }),
    ).toBe(true);
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: serviceRoleJwt("project-b"),
      }),
    ).toBe(false);
  });

  it("requires an explicit project ref for opaque secret keys", () => {
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: "sb_secret_opaque",
      }),
    ).toBe(false);
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: "sb_secret_opaque",
        configuredProjectRef: "project-a",
      }),
    ).toBe(true);
  });

  it("rejects conflicting embedded and configured project refs", () => {
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: serviceRoleJwt("project-a"),
        configuredProjectRef: "project-b",
      }),
    ).toBe(false);
  });
});

describe("supabaseAdmin privileged client gate", () => {
  const ENV_KEYS = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_PROJECT_REF",
  ] as const;
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete (globalThis as { window?: unknown }).window;
  });

  it("returns null when the service-role JWT belongs to a different project", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-a.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleJwt("project-b");
    delete process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF;
    expect(supabaseAdmin()).toBeNull();
  });

  it("creates a client only when the URL and service-role JWT share a project ref", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-a.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleJwt("project-a");
    delete process.env.SUPABASE_SERVICE_ROLE_PROJECT_REF;
    const client = supabaseAdmin();
    expect(client).not.toBeNull();
    expect(typeof client?.from).toBe("function");
  });

  it("throws if imported privileged credentials would run in the browser", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project-a.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleJwt("project-a");
    (globalThis as { window?: unknown }).window = {};
    expect(() => supabaseAdmin()).toThrow(/must not run in the browser/);
  });
});
