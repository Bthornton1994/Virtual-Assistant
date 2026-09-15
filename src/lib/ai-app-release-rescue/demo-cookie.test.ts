import { describe, expect, it } from "vitest";
import { demoEngagementCookieSecure } from "@/lib/ai-app-release-rescue/demo-cookie";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("demo engagement cookie Secure flag", () => {
  it("is Secure on HTTPS, including Vercel", () => {
    expect(demoEngagementCookieSecure({ forwardedProto: "https" })).toBe(true);
    expect(demoEngagementCookieSecure({ forwardedProto: "https, http" })).toBe(true);
    expect(demoEngagementCookieSecure({ vercel: "1" })).toBe(true);
  });

  it("omits Secure only when the request is actually HTTP", () => {
    expect(demoEngagementCookieSecure({ forwardedProto: "http" })).toBe(false);
    expect(demoEngagementCookieSecure({ forwardedProto: "http", nodeEnv: "production" })).toBe(false);
  });

  it("fails closed to Secure in production when the protocol is unknown", () => {
    expect(demoEngagementCookieSecure({ nodeEnv: "production" })).toBe(true);
    expect(demoEngagementCookieSecure({ nodeEnv: "development" })).toBe(false);
  });

  it("does not hardcode secure:false on the demo cookie", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/actions/ai-app-release-rescue.ts"), "utf8");
    expect(source).not.toMatch(/secure:\s*false/);
    expect(source).toMatch(/demoEngagementCookieSecure/);
  });
});
