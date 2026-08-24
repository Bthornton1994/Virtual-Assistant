import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  projectRefFromServiceRoleKey,
  serviceRoleMatchesProject,
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
