import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { githubRefFromRemoteUrl } from "@/lib/release-rescue-internal/allowlist";
import { isCitablePath } from "@/lib/release-rescue-internal/checks";
import { hmacMatches, sealIntact, sealReport } from "@/lib/release-rescue-internal/store";
import { buildReleaseRescueReport } from "@/lib/release-rescue-report";
import { FAKE_AWS_KEY, tempDir } from "@/lib/__tests__/release-rescue-internal-fixtures";
import { FIXTURE_RUN_ID, makeReportInput } from "@/lib/__tests__/release-rescue-fixtures";

const nextMocks = vi.hoisted(() => ({
  headers: new Map<string, string>(),
  cookies: new Map<string, string>(),
}));

class NavigationSignal extends Error {
  constructor(
    readonly kind: "notFound" | "redirect",
    readonly url?: string,
  ) {
    super(kind === "notFound" ? "NEXT_NOT_FOUND" : `NEXT_REDIRECT:${url}`);
    this.name = "NavigationSignal";
  }
}

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => nextMocks.headers.get(name) ?? null,
  }),
  cookies: async () => ({
    get: (name: string) => {
      const value = nextMocks.cookies.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NavigationSignal("notFound");
  },
  redirect: (url: string) => {
    throw new NavigationSignal("redirect", url);
  },
}));

describe("githubRefFromRemoteUrl binds a checkout to an allowlisted GitHub repo", () => {
  it("normalizes the three supported GitHub remotes to owner/name", () => {
    expect(githubRefFromRemoteUrl("https://github.com/Org/Repo.git")).toBe("Org/Repo");
    expect(githubRefFromRemoteUrl("https://github.com/Org/Repo/")).toBe("Org/Repo");
    expect(githubRefFromRemoteUrl("git@github.com:Org/Repo.git")).toBe("Org/Repo");
    expect(githubRefFromRemoteUrl("ssh://git@github.com/Org/Repo.git")).toBe("Org/Repo");
    expect(githubRefFromRemoteUrl("  ssh://git@github.com/Org/Repo  ")).toBe("Org/Repo");
  });

  it("strips a credential prefix and never returns it", () => {
    const token = ["gh", "p_", "Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2"].join("");
    const ref = githubRefFromRemoteUrl(`https://${token}@github.com/org/repo.git`);

    expect(ref).toBe("org/repo");
    expect(ref).not.toContain(token);
    expect(ref).not.toContain("@");
  });

  it("refuses anything that is not a GitHub owner/name remote", () => {
    expect(githubRefFromRemoteUrl("https://gitlab.com/org/repo.git")).toBeNull();
    expect(githubRefFromRemoteUrl("https://bitbucket.org/org/repo.git")).toBeNull();
    expect(githubRefFromRemoteUrl("http://github.com/org/repo.git")).toBeNull();
    expect(githubRefFromRemoteUrl("https://github.enterprise.com/org/repo.git")).toBeNull();
    expect(githubRefFromRemoteUrl("https://github.com/org/repo.git?foo=1")).toBeNull();
    expect(githubRefFromRemoteUrl("https://github.com/org/repo.git#main")).toBeNull();
    expect(githubRefFromRemoteUrl("https://github.com/org/repo/extra")).toBeNull();
    expect(githubRefFromRemoteUrl("https://github.com/org/")).toBeNull();
    expect(githubRefFromRemoteUrl("git@github.com:org")).toBeNull();
    expect(githubRefFromRemoteUrl("")).toBeNull();
  });
});

describe("isCitablePath refuses a location the report must not name", () => {
  it("accepts an ordinary repository path", () => {
    expect(isCitablePath("src/app.ts")).toBe(true);
    expect(isCitablePath("src/app/api/orders/[id]/route.ts")).toBe(true);
  });

  it("rejects parent traversal, an absolute path, and a credential-shaped file name", () => {
    expect(isCitablePath("../etc/passwd")).toBe(false);
    expect(isCitablePath("/etc/passwd")).toBe(false);
    expect(isCitablePath(`src/${FAKE_AWS_KEY}.ts`)).toBe(false);
  });
});

describe("a stored report seal is bound to purpose, run, and the report bytes", () => {
  const previousDir = process.env.RELEASE_RESCUE_LOCAL_DIR;

  beforeEach(() => {
    process.env.RELEASE_RESCUE_LOCAL_DIR = tempDir("rr-seal-");
  });

  afterEach(() => {
    if (previousDir === undefined) delete process.env.RELEASE_RESCUE_LOCAL_DIR;
    else process.env.RELEASE_RESCUE_LOCAL_DIR = previousDir;
  });

  it("accepts a freshly sealed draft and refuses every one-field tamper", () => {
    const report = buildReleaseRescueReport(makeReportInput());
    const sealed = sealReport("draft", FIXTURE_RUN_ID, report, "subject");

    expect(sealIntact("draft", FIXTURE_RUN_ID, sealed)).toBe(true);
    expect(sealIntact("signed", FIXTURE_RUN_ID, sealed)).toBe(false);
    expect(sealIntact("draft", "11111111-1111-4111-8111-111111111111", sealed)).toBe(false);
    expect(sealIntact("draft", FIXTURE_RUN_ID, { ...sealed, seal: "ab".repeat(32) })).toBe(false);
    expect(sealIntact("draft", FIXTURE_RUN_ID, { ...sealed, reportHash: "cd".repeat(32) })).toBe(false);
  });

  it("treats a wrong-length hex as a miss, without throwing", () => {
    expect(hmacMatches("rr-draft", "message", "abcd")).toBe(false);
    expect(hmacMatches("rr-draft", "message", "not-hex")).toBe(false);
  });
});

describe("the internal request guard fail-closes outside local loopback", () => {
  const previousInternal = process.env.RELEASE_RESCUE_INTERNAL;
  const previousVercel = process.env.VERCEL;

  beforeEach(() => {
    nextMocks.headers.clear();
    nextMocks.cookies.clear();
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.VERCEL_URL;
    delete process.env.RELEASE_RESCUE_INTERNAL;
  });

  afterEach(() => {
    if (previousInternal === undefined) delete process.env.RELEASE_RESCUE_INTERNAL;
    else process.env.RELEASE_RESCUE_INTERNAL = previousInternal;
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
  });

  async function requireInternalRequest() {
    const guard = await import("@/lib/release-rescue-internal/request-guard");
    return guard.requireInternalRequest();
  }

  it("returns 404 when the mode is off, on a deployment, or off loopback", async () => {
    nextMocks.headers.set("host", "127.0.0.1:3020");
    await expect(requireInternalRequest()).rejects.toMatchObject({ kind: "notFound" });

    process.env.RELEASE_RESCUE_INTERNAL = "local";
    process.env.VERCEL = "1";
    await expect(requireInternalRequest()).rejects.toMatchObject({ kind: "notFound" });

    delete process.env.VERCEL;
    nextMocks.headers.set("host", "example.com");
    await expect(requireInternalRequest()).rejects.toMatchObject({ kind: "notFound" });
  });

  it("admits a loopback host only when local mode is on, and has no session without a cookie", async () => {
    process.env.RELEASE_RESCUE_INTERNAL = "local";
    nextMocks.headers.set("host", "127.0.0.1:3020");
    await expect(requireInternalRequest()).resolves.toBeUndefined();

    const { currentOperator } = await import("@/lib/release-rescue-internal/request-guard");
    await expect(currentOperator()).resolves.toBeNull();
  });
});
