import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashReleaseRescueReviewSubject } from "@/lib/release-rescue-report";
import { internalModeDecision, isLoopbackRequest } from "@/lib/release-rescue-internal/mode";
import {
  OPERATOR_SCHEMA_VERSION,
  SESSION_COOKIE,
  addOperator,
  authenticateOperator,
  displayNameProblem,
  issueSession,
  loadOperators,
  operatorFromSession,
  verifyPassphrase,
} from "@/lib/release-rescue-internal/local-identity";
import { deliveryForRun, recordDelivery, signRunAsLocalOperator } from "@/lib/release-rescue-internal/review";
import { initiatorFromOperator, startInternalRun } from "@/lib/release-rescue-internal/run";
import {
  checkoutFor,
  hmacHex,
  listRuns,
  loadRun,
  localDir,
  localSecret,
  saveCheckout,
} from "@/lib/release-rescue-internal/store";
import { fixtureAllowlist, makeFixtureRepo, tempDir } from "@/lib/__tests__/release-rescue-internal-fixtures";

// Remaining fail-closed identity, session, secret, and export-retention gates
// from the merged internal workflow. A forged session, a tampered registry, a
// weak local key, or an export typo must not authenticate, sign, or purge.

const PASSPHRASE = "a long local test passphrase";
const REASON = "reviewed_findings_and_verdict_match_the_recorded_observations";
const LOCKOUT_MS = 60_000;

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

beforeEach(() => {
  process.env.RELEASE_RESCUE_LOCAL_DIR = tempDir("rr-internal-identity-");
});

async function draftRun() {
  const operator = addOperator(`Reviewer ${Math.random().toString(36).slice(2, 8)}`, PASSPHRASE);
  const repo = makeFixtureRepo({ "src/a.ts": "export const a = 1;\n" });
  const record = await startInternalRun({
    initiatedBy: initiatorFromOperator(operator),
    repositoryRef: fixtureAllowlist().repositories[0].repositoryRef,
    commitSha: repo.commitSha,
    retentionPolicy: "minimum_7_day",
    ownershipConfirmed: true,
    source: { kind: "checkout", path: repo.path },
    allowlist: fixtureAllowlist(),
  });
  return { operator, record };
}

describe("a display name is refused before it can appear on a signature", () => {
  it.each([
    ["A", "A display name must be 2 to 120 characters."],
    ["x".repeat(121), "A display name must be 2 to 120 characters."],
    ["  ", "A display name must be 2 to 120 characters."],
    ["Name<script>", "A display name may not contain control characters or angle brackets."],
    ["Name\nNext", "A display name may not contain control characters or angle brackets."],
  ])("refuses %j and writes nothing", (name, message) => {
    expect(displayNameProblem(name)).toBe(message);
    expect(() => addOperator(name, PASSPHRASE)).toThrow(message);
    expect(loadOperators()).toEqual([]);
  });

  it("refuses a second operator with the same name in a different case", () => {
    addOperator("Dana Okafor", PASSPHRASE);
    expect(() => addOperator("dana okafor", PASSPHRASE)).toThrow("An operator with that display name already exists.");
    expect(loadOperators()).toHaveLength(1);
  });
});

describe("the operator registry fail-closes on extra keys or a wrong schema", () => {
  it("throws rather than load a registry or operator that carries an extra field", () => {
    const operator = addOperator("Registry Case", PASSPHRASE);
    const path = join(localDir(), "operators.json");
    writeFileSync(
      path,
      `${JSON.stringify({
        schemaVersion: OPERATOR_SCHEMA_VERSION,
        operators: [{ ...operator, extra: "planted" }],
      })}\n`,
    );
    expect(() => loadOperators()).toThrow();

    writeFileSync(
      path,
      `${JSON.stringify({
        schemaVersion: OPERATOR_SCHEMA_VERSION,
        operators: [operator],
        extra: true,
      })}\n`,
    );
    expect(() => loadOperators()).toThrow();

    writeFileSync(
      path,
      `${JSON.stringify({ schemaVersion: "release-rescue-internal-operators/v0", operators: [operator] })}\n`,
    );
    expect(() => loadOperators()).toThrow();
  });
});

describe("passphrase verification and lockout do not leak names or stay locked forever", () => {
  it("treats a malformed stored hash as a miss", () => {
    expect(verifyPassphrase(PASSPHRASE, "not-a-hash")).toBe(false);
    expect(verifyPassphrase(PASSPHRASE, "scrypt$1$2")).toBe(false);
    expect(verifyPassphrase(PASSPHRASE, "bcrypt$32768$8$1$00$00")).toBe(false);
  });

  it("authenticates a display name case-insensitively, then unlocks after the documented window", () => {
    addOperator("Dana Okafor", PASSPHRASE);
    expect(authenticateOperator("dana okafor", PASSPHRASE).ok).toBe(true);

    const started = 1_700_000_000_000;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(authenticateOperator("Dana Okafor", "wrong passphrase here", started)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    expect(authenticateOperator("Dana Okafor", PASSPHRASE, started + LOCKOUT_MS - 1)).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(authenticateOperator("Dana Okafor", PASSPHRASE, started + LOCKOUT_MS).ok).toBe(true);
  });
});

describe("a session token is refused unless it is exactly the signed payload", () => {
  it("refuses an extra payload key, a second dot, a future issue beyond the skew window, and a draft-purpose HMAC", () => {
    const operator = addOperator("Session Schema", PASSPHRASE);
    const now = Date.now();
    const token = issueSession(operator.operatorId, now);
    const [payload] = token.split(".");

    const extra = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
        role: "ops_manager",
      }),
    ).toString("base64url");
    expect(operatorFromSession(`${extra}.${hmacHex("rr-session", extra)}`, now)).toBeNull();

    expect(operatorFromSession(`${token}.extra`, now)).toBeNull();
    expect(operatorFromSession(token, now - 61_000)).toBeNull();
    expect(operatorFromSession(token, now - 30_000)?.operatorId).toBe(operator.operatorId);
    expect(operatorFromSession(`${payload}.${hmacHex("rr-draft", payload)}`, now)).toBeNull();
  });
});

describe("the local secret and checkout map fail closed", () => {
  it("refuses a secret key that is not 32 bytes", () => {
    mkdirSync(localDir(), { recursive: true, mode: 0o700 });
    writeFileSync(join(localDir(), "secret.key"), "aa".repeat(16), { mode: 0o600 });
    expect(() => localSecret()).toThrow("The local secret key is malformed.");
  });

  it("looks up a checkout by GitHub's case-insensitive owner/name", () => {
    saveCheckout("Org/Repo", "/tmp/rr-clone");
    expect(checkoutFor("org/repo")).toBe("/tmp/rr-clone");
    expect(checkoutFor("ORG/REPO")).toBe("/tmp/rr-clone");
    expect(checkoutFor("other/repo")).toBeNull();
  });

  it("skips planted run files that are not a matching v1 record", () => {
    const runs = join(localDir(), "runs");
    mkdirSync(runs, { recursive: true, mode: 0o700 });
    writeFileSync(join(runs, "notes.json"), "{}\n");
    writeFileSync(join(runs, "readme.txt"), "not a run\n");
    const plantedId = "11111111-1111-4111-8111-111111111111";
    writeFileSync(
      join(runs, `${plantedId}.json`),
      `${JSON.stringify({ schemaVersion: "other/v1", runId: plantedId })}\n`,
    );
    expect(listRuns()).toEqual([]);
  });
});

describe("internal mode refuses each Vercel signal on its own, and accepts mapped loopback", () => {
  it("is off when VERCEL_ENV or VERCEL_URL is set even if the switch is on", () => {
    expect(internalModeDecision({ RELEASE_RESCUE_INTERNAL: "local", VERCEL_ENV: "preview" })).toEqual({
      enabled: false,
      reason: "deployment_environment",
    });
    expect(internalModeDecision({ RELEASE_RESCUE_INTERNAL: "local", VERCEL_URL: "app.vercel.app" })).toEqual({
      enabled: false,
      reason: "deployment_environment",
    });
  });

  it("accepts a host without a port and an IPv4-mapped loopback forwarded address", () => {
    const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
    expect(isLoopbackRequest(headers({ host: "127.0.0.1" }))).toBe(true);
    expect(
      isLoopbackRequest(headers({ host: "127.0.0.1:3020", "x-forwarded-for": "::ffff:127.0.0.1" })),
    ).toBe(true);
  });
});

describe("requireOperator redirects until a valid local session cookie is present", () => {
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

  it("redirects without a cookie or with the product demo cookie, and admits the named operator", async () => {
    process.env.RELEASE_RESCUE_INTERNAL = "local";
    nextMocks.headers.set("host", "127.0.0.1:3020");
    const { requireOperator } = await import("@/lib/release-rescue-internal/request-guard");

    await expect(requireOperator()).rejects.toMatchObject({
      kind: "redirect",
      url: "/internal/release-rescue/login",
    });

    nextMocks.cookies.set(SESSION_COOKIE, "dc_demo_session=usr_admin");
    await expect(requireOperator()).rejects.toMatchObject({
      kind: "redirect",
      url: "/internal/release-rescue/login",
    });

    const operator = addOperator("Guard Case", PASSPHRASE);
    nextMocks.cookies.set(SESSION_COOKIE, issueSession(operator.operatorId));
    await expect(requireOperator()).resolves.toEqual(
      expect.objectContaining({ operatorId: operator.operatorId, displayName: "Guard Case" }),
    );
  });
});

describe("export retention does not move on a typo, a second export, or an unsigned draft", () => {
  it("does not sweep when the export id is not a run id", async () => {
    const { record } = await draftRun();
    const far = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

    expect(deliveryForRun("not-a-run-id", far)).toEqual({
      status: "withheld",
      blockers: ["No such run."],
    });
    expect(loadRun(record.runId)?.status).toBe("awaiting_review");

    expect(deliveryForRun(record.runId, far).status).toBe("withheld");
    expect(loadRun(record.runId)?.status).toBe("purged");
  });

  it("records the first successful delivery only, and ignores an unsigned or missing run", async () => {
    const { operator, record } = await draftRun();
    recordDelivery(record.runId, new Date("2026-01-01T00:00:00.000Z"));
    expect(loadRun(record.runId)?.deliveredAt).toBeNull();

    const shown = hashReleaseRescueReviewSubject(record.draft!.report);
    expect(signRunAsLocalOperator(operator, record.runId, { reasonCode: REASON, approvedContentHash: shown }).ok).toBe(
      true,
    );
    const first = new Date("2026-03-01T00:00:00.000Z");
    const second = new Date("2026-03-08T00:00:00.000Z");
    recordDelivery(record.runId, first);
    recordDelivery(record.runId, second);
    expect(loadRun(record.runId)?.deliveredAt).toBe(first.toISOString());

    expect(() => recordDelivery("11111111-1111-4111-8111-111111111111")).not.toThrow();
  });
});
