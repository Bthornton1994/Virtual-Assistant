import { describe, expect, it } from "vitest";
import { resolveAuthRedirect, sanitizeNext } from "@/lib/auth-redirect";

describe("auth redirect loop protection", () => {
  it("sends a clean visitor on /app to /login", () => {
    expect(
      resolveAuthRedirect({ pathname: "/app/dashboard", hasSupabaseUser: false, hasDemoSession: false }),
    ).toEqual({ type: "redirect", pathname: "/login", next: "/app/dashboard" });
  });

  it("lets a valid Supabase user into /app", () => {
    expect(
      resolveAuthRedirect({ pathname: "/app/dashboard", hasSupabaseUser: true, hasDemoSession: false }),
    ).toEqual({ type: "next" });
  });

  it("lets an isolated demo session into /app", () => {
    expect(
      resolveAuthRedirect({ pathname: "/ops/queue", hasSupabaseUser: false, hasDemoSession: true }),
    ).toEqual({ type: "next" });
  });

  it("does not treat a demo cookie as a production login", () => {
    expect(
      resolveAuthRedirect({ pathname: "/login", hasSupabaseUser: false, hasDemoSession: true }),
    ).toEqual({ type: "next" });
  });

  it("sends a valid production user away from /login", () => {
    expect(
      resolveAuthRedirect({ pathname: "/login", hasSupabaseUser: true, hasDemoSession: false }),
    ).toEqual({ type: "redirect", pathname: "/app/dashboard" });
  });

  it("never uses /login as a next target", () => {
    expect(sanitizeNext("/login")).toBeNull();
    expect(sanitizeNext("/login?next=/app")).toBeNull();
    expect(
      resolveAuthRedirect({
        pathname: "/login",
        hasSupabaseUser: true,
        hasDemoSession: false,
        nextParam: "/login",
      }),
    ).toEqual({ type: "redirect", pathname: "/app/dashboard" });
  });

  it("ignores a stale legacy cookie because it is not an input to the decision", () => {
    const withLegacy = resolveAuthRedirect({
      pathname: "/login",
      hasSupabaseUser: false,
      hasDemoSession: false,
    });
    expect(withLegacy).toEqual({ type: "next" });
  });

  it("leaves public routes alone", () => {
    for (const pathname of ["/", "/book", "/demo", "/pricing", "/how-it-works", "/security"]) {
      expect(resolveAuthRedirect({ pathname, hasSupabaseUser: false, hasDemoSession: false })).toEqual({
        type: "next",
      });
    }
  });
});
