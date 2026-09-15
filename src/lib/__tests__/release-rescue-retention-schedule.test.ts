import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RETENTION_SWEEP_CRON,
  RETENTION_SWEEP_PATH,
  authorizeRetentionSweep,
} from "@/lib/release-rescue-retention-schedule";

// A secret long enough to be treated as one.
const SECRET = "zn4Q8xK2pR7vL0sT6wY3hB9mC1dF5gJ";

describe("retention sweep authorization", () => {
  it("authorizes the scheduler presenting the configured secret", () => {
    expect(authorizeRetentionSweep(`Bearer ${SECRET}`, SECRET)).toEqual({ authorized: true });
  });

  it("refuses everything when no secret is configured", () => {
    // An endpoint that becomes open because a deployment forgot a variable is
    // worse than one that stops working: nothing tells you.
    for (const configured of [undefined, "", "   "]) {
      const decision = authorizeRetentionSweep(`Bearer ${SECRET}`, configured);
      expect(decision.authorized, String(configured)).toBe(false);
      if (decision.authorized) continue;
      expect(decision.status).toBe(503);
    }
  });

  it("refuses a secret too short to be one", () => {
    const decision = authorizeRetentionSweep("Bearer changeme", "changeme");

    expect(decision.authorized).toBe(false);
    if (decision.authorized) return;
    expect(decision.status).toBe(503);
  });

  it("separates not-configured from not-authorized", () => {
    // Different facts deserve different statuses, or a misconfigured deployment
    // hides behind what looks like a routine auth failure.
    const unconfigured = authorizeRetentionSweep(`Bearer ${SECRET}`, undefined);
    const wrongSecret = authorizeRetentionSweep("Bearer not-the-secret-not-the-secret", SECRET);

    expect(unconfigured.authorized).toBe(false);
    expect(wrongSecret.authorized).toBe(false);
    if (unconfigured.authorized || wrongSecret.authorized) return;
    expect(unconfigured.status).toBe(503);
    expect(wrongSecret.status).toBe(401);
  });

  it("refuses a missing or malformed authorization header", () => {
    for (const header of [null, "", "Basic abc", SECRET, `bearer ${SECRET}`, "Bearer"]) {
      const decision = authorizeRetentionSweep(header, SECRET);
      expect(decision.authorized, String(header)).toBe(false);
      if (decision.authorized) continue;
      expect(decision.status).toBe(401);
    }
  });

  it("refuses a near-miss credential", () => {
    for (const provided of [
      SECRET.slice(0, -1),
      `${SECRET}x`,
      SECRET.toUpperCase(),
      SECRET.replace("z", "Z"),
      ` ${SECRET}`,
    ]) {
      const decision = authorizeRetentionSweep(`Bearer ${provided}`, SECRET);
      expect(decision.authorized, provided).toBe(false);
    }
  });

  it("does not throw on a length mismatch", () => {
    // timingSafeEqual throws on differing lengths; the guard must handle it
    // rather than turning an unauthorized call into a 500.
    expect(() => authorizeRetentionSweep("Bearer x", SECRET)).not.toThrow();
    expect(authorizeRetentionSweep("Bearer x", SECRET).authorized).toBe(false);
  });

  it("keeps the HTTP schedule and the database schedule in step", () => {
    expect(RETENTION_SWEEP_CRON).toBe("17 3 * * *");
    expect(RETENTION_SWEEP_PATH).toBe("/api/internal/release-rescue/retention-sweep");
  });

  it("is actually scheduled, not merely schedulable", () => {
    // The whole point of this pass: a retention control nothing invokes is not a
    // control. Both paths must be wired, and both must name the same schedule.
    const vercel = JSON.parse(readFileSync(resolve(process.cwd(), "vercel.json"), "utf8")) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    const cron = vercel.crons?.find((entry) => entry.path === RETENTION_SWEEP_PATH);

    expect(cron, "vercel.json should schedule the sweep").toBeDefined();
    expect(cron?.schedule).toBe(RETENTION_SWEEP_CRON);

    const migration = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260915183000_release_rescue_hardening_v1.sql"),
      "utf8",
    );
    expect(migration).toContain("cron.schedule(");
    expect(migration).toContain(RETENTION_SWEEP_CRON);
    expect(migration).toContain("release-rescue-retention-sweep");
  });

  it("exists as a route the scheduler can reach", () => {
    const route = readFileSync(
      resolve(process.cwd(), `src/app${RETENTION_SWEEP_PATH}/route.ts`),
      "utf8",
    );

    expect(route).toContain("export async function POST");
    expect(route).toContain("authorizeRetentionSweep");
    // The sweep must identify itself so its runs are attributable.
    expect(route).toContain("http_schedule");
  });
});
