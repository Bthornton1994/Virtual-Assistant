import { describe, expect, it } from "vitest";
import { deploymentOrigin } from "@/lib/deployment-origin";

describe("deployment origin leftover preview and candidate gates", () => {
  it("does not fall a Preview auth origin back onto a stale canonical site URL", () => {
    expect(
      deploymentOrigin({
        VERCEL_ENV: "preview",
        VERCEL_URL: "",
        NEXT_PUBLIC_SITE_URL: "https://stale-preview.vercel.app",
        VERCEL_BRANCH_URL: "branch-xyz.vercel.app",
      }),
    ).toBe("https://branch-xyz.vercel.app");

    expect(
      deploymentOrigin({
        VERCEL_ENV: "preview",
        VERCEL_URL: "   ",
        VERCEL_BRANCH_URL: "",
        NEXT_PUBLIC_SITE_URL: "https://stale-preview.vercel.app",
        NEXT_PUBLIC_VERCEL_URL: "preview-public.vercel.app",
      }),
    ).toBe("https://preview-public.vercel.app");

    expect(
      deploymentOrigin({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SITE_URL: "https://stale-preview.vercel.app",
      }),
    ).toBe("http://localhost:3000");
  });

  it("uses the leftover Production app URL and skips invalid origin candidates", () => {
    expect(
      deploymentOrigin({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_APP_URL: "https://app.delegation.cloud/path",
      }),
    ).toBe("https://app.delegation.cloud");

    expect(
      deploymentOrigin({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SITE_URL: "javascript:alert(1)",
        NEXT_PUBLIC_APP_URL: "://not-a-host",
        VERCEL_PROJECT_PRODUCTION_URL: "   ",
        VERCEL_URL: "http://delegation.example:8443/login",
      }),
    ).toBe("http://delegation.example:8443");
  });
});
