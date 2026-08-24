import { describe, expect, it } from "vitest";
import { deploymentOrigin } from "@/lib/deployment-origin";

describe("deploymentOrigin", () => {
  it("uses the active Vercel deployment for Preview", () => {
    expect(
      deploymentOrigin({
        VERCEL_ENV: "preview",
        VERCEL_URL: "delegation-preview-abc.vercel.app",
        NEXT_PUBLIC_SITE_URL: "https://stale-preview.vercel.app",
      }),
    ).toBe("https://delegation-preview-abc.vercel.app");
  });

  it("uses the configured canonical origin for Production", () => {
    expect(
      deploymentOrigin({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "https://delegation.cloud/path",
        VERCEL_URL: "deployment.vercel.app",
      }),
    ).toBe("https://delegation.cloud");
  });

  it("uses Vercel's Production domain when no canonical origin is configured", () => {
    expect(
      deploymentOrigin({
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "delegation-production.vercel.app",
      }),
    ).toBe("https://delegation-production.vercel.app");
  });

  it("falls back to localhost outside Vercel", () => {
    expect(deploymentOrigin({})).toBe("http://localhost:3000");
  });
});
