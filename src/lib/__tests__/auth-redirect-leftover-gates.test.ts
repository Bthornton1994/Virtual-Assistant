import { describe, expect, it } from "vitest";
import { resolveAuthRedirect, sanitizeNext } from "@/lib/auth-redirect";

describe("auth-redirect leftover open-redirect gates", () => {
  it("refuses leftover protocol-relative, absolute, and signup next targets", () => {
    expect(sanitizeNext("//evil.example")).toBeNull();
    expect(sanitizeNext("https://evil.example/app")).toBeNull();
    expect(sanitizeNext("http://evil.example/app")).toBeNull();
    expect(sanitizeNext("/signup")).toBeNull();
    expect(sanitizeNext("/signup?next=/app")).toBeNull();
    expect(sanitizeNext("javascript:alert(1)")).toBeNull();
    expect(sanitizeNext("\\evil.example")).toBeNull();
    expect(sanitizeNext("%2F%2Fevil.example")).toBeNull();
    expect(sanitizeNext("/app/dashboard")).toBe("/app/dashboard");
  });

  it("does not bounce a signed-in user to a leftover open-redirect next param", () => {
    expect(
      resolveAuthRedirect({
        pathname: "/login",
        hasSupabaseUser: true,
        hasDemoSession: false,
        nextParam: "//evil.example",
      }),
    ).toEqual({ type: "redirect", pathname: "/app/dashboard" });

    expect(
      resolveAuthRedirect({
        pathname: "/login",
        hasSupabaseUser: true,
        hasDemoSession: false,
        nextParam: "https://evil.example/app",
      }),
    ).toEqual({ type: "redirect", pathname: "/app/dashboard" });

    expect(
      resolveAuthRedirect({
        pathname: "/login",
        hasSupabaseUser: true,
        hasDemoSession: false,
        nextParam: "/ops/queue",
      }),
    ).toEqual({ type: "redirect", pathname: "/ops/queue" });
  });

  it("protects leftover exact /app and /ops prefixes without treating lookalikes as gated", () => {
    expect(
      resolveAuthRedirect({ pathname: "/app", hasSupabaseUser: false, hasDemoSession: false }),
    ).toEqual({ type: "redirect", pathname: "/login", next: "/app" });
    expect(
      resolveAuthRedirect({ pathname: "/ops", hasSupabaseUser: false, hasDemoSession: false }),
    ).toEqual({ type: "redirect", pathname: "/login", next: "/ops" });
    expect(
      resolveAuthRedirect({ pathname: "/application", hasSupabaseUser: false, hasDemoSession: false }),
    ).toEqual({ type: "next" });
    expect(
      resolveAuthRedirect({ pathname: "/ops-metrics", hasSupabaseUser: false, hasDemoSession: false }),
    ).toEqual({ type: "next" });
  });
});
