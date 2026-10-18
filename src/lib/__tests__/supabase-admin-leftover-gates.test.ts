import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { projectRefFromServiceRoleKey, serviceRoleMatchesProject } from "@/lib/supabase/admin";

function serviceRoleJwt(ref: unknown) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ ref, role: "service_role" })).toString("base64url");
  return `${header}.${payload}.test-signature`;
}

describe("supabase admin leftover privileged-credential gates", () => {
  it("refuses leftover host spellings that are not a supabase.co project URL", () => {
    const key = serviceRoleJwt("project-a");
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.com",
        key,
      }),
    ).toBe(false);
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co.evil.example",
        key,
      }),
    ).toBe(false);
    expect(
      serviceRoleMatchesProject({
        url: "https://evil.example/project-a.supabase.co",
        key,
      }),
    ).toBe(false);
    expect(
      serviceRoleMatchesProject({
        url: "not-a-url",
        key,
      }),
    ).toBe(false);
  });

  it("refuses leftover JWT payloads that do not embed a project ref", () => {
    expect(projectRefFromServiceRoleKey("not-a-jwt")).toBeNull();
    expect(projectRefFromServiceRoleKey("headeronly")).toBeNull();
    expect(projectRefFromServiceRoleKey(serviceRoleJwt(""))).toBeNull();
    expect(projectRefFromServiceRoleKey(serviceRoleJwt(12))).toBeNull();
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: serviceRoleJwt(""),
      }),
    ).toBe(false);
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: "header.%%%not-base64%%%.sig",
      }),
    ).toBe(false);
  });

  it("does not treat a leftover configured ref as a match when the URL project is different", () => {
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: "sb_secret_opaque",
        configuredProjectRef: " project-b ",
      }),
    ).toBe(false);
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: "sb_secret_opaque",
        configuredProjectRef: "project-a",
      }),
    ).toBe(true);
    expect(
      serviceRoleMatchesProject({
        url: "https://project-a.supabase.co",
        key: serviceRoleJwt("project-a"),
        configuredProjectRef: "   ",
      }),
    ).toBe(true);
  });
});
