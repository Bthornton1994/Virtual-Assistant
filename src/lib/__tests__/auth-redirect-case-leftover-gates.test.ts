import { describe, expect, it } from "vitest";
import { resolveAuthRedirect, sanitizeNext } from "@/lib/auth-redirect";

describe("auth-redirect leftover case, prefix, and traversal gates", () => {
  it("refuses leftover /login and /signup prefixes, including traversal lookalikes", () => {
    expect(sanitizeNext("/login/../app")).toBeNull();
    expect(sanitizeNext("/signup/../ops")).toBeNull();
    expect(sanitizeNext("/login/")).toBeNull();
    expect(sanitizeNext("/loginfo")).toBeNull();
    expect(sanitizeNext("/signup2")).toBeNull();
    expect(sanitizeNext("")).toBeNull();
    expect(sanitizeNext("   /app")).toBeNull();
    expect(sanitizeNext("/app/dashboard")).toBe("/app/dashboard");
  });

  it("does not bounce a signed-in user to leftover login-prefix next targets", () => {
    expect(
      resolveAuthRedirect({
        pathname: "/login",
        hasSupabaseUser: true,
        hasDemoSession: false,
        nextParam: "/login/../app",
      }),
    ).toEqual({ type: "redirect", pathname: "/app/dashboard" });

    expect(
      resolveAuthRedirect({
        pathname: "/login",
        hasSupabaseUser: true,
        hasDemoSession: false,
        nextParam: "/signup/../ops",
      }),
    ).toEqual({ type: "redirect", pathname: "/app/dashboard" });
  });

  it("protects leftover exact /app and /ops without treating uppercase lookalikes as gated", () => {
    expect(
      resolveAuthRedirect({ pathname: "/app/dashboard", hasSupabaseUser: false, hasDemoSession: false }),
    ).toEqual({ type: "redirect", pathname: "/login", next: "/app/dashboard" });
    expect(
      resolveAuthRedirect({ pathname: "/ops/queue", hasSupabaseUser: false, hasDemoSession: false }),
    ).toEqual({ type: "redirect", pathname: "/login", next: "/ops/queue" });
    expect(
      resolveAuthRedirect({ pathname: "/APP/dashboard", hasSupabaseUser: false, hasDemoSession: false }),
    ).toEqual({ type: "next" });
    expect(
      resolveAuthRedirect({ pathname: "/OPS/queue", hasSupabaseUser: false, hasDemoSession: false }),
    ).toEqual({ type: "next" });
  });
});
