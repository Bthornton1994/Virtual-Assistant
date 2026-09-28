import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  allowlistSchema,
  findAllowlisted,
  loadAllowlist,
} from "@/lib/release-rescue-internal/allowlist";
import { CLI_INITIATOR, startInternalRun } from "@/lib/release-rescue-internal/run";
import { isRunId, listRuns, loadRun, localDir, newRunId, saveRun } from "@/lib/release-rescue-internal/store";
import type { RetentionPolicy } from "@/lib/release-rescue-intake";
import {
  FIXTURE_REPOSITORY,
  fixtureAllowlist,
  makeFixtureRepo,
  tempDir,
  writeAllowlist,
} from "@/lib/__tests__/release-rescue-internal-fixtures";

beforeEach(() => {
  process.env.RELEASE_RESCUE_LOCAL_DIR = tempDir("rr-internal-allowlist-runid-");
});

describe("the allowlist is a reviewed list, not a form field", () => {
  it("refuses extra keys, an empty list, a wrong schema version, and a repository named twice", () => {
    const valid = fixtureAllowlist();
    const entry = valid.repositories[0];

    expect(allowlistSchema.safeParse({ ...valid, extra: true }).success).toBe(false);
    expect(allowlistSchema.safeParse({ ...valid, repositories: [{ ...entry, extra: true }] }).success).toBe(false);
    expect(allowlistSchema.safeParse({ ...valid, repositories: [] }).success).toBe(false);
    expect(allowlistSchema.safeParse({ ...valid, schemaVersion: "release-rescue-internal-allowlist/v0" }).success).toBe(
      false,
    );
    expect(
      allowlistSchema.safeParse({
        ...valid,
        repositories: [entry, { ...entry, repositoryRef: entry.repositoryRef.toUpperCase() }],
      }).success,
    ).toBe(false);
  });

  it("matches an allowlisted repository case-insensitively after trimming, and no other name", () => {
    const allowlist = fixtureAllowlist();

    expect(findAllowlisted(allowlist, `  ${FIXTURE_REPOSITORY.toUpperCase()}  `)?.repositoryRef).toBe(
      FIXTURE_REPOSITORY,
    );
    expect(findAllowlisted(allowlist, "someone-else/other")).toBeNull();
    expect(findAllowlisted(allowlist, `${FIXTURE_REPOSITORY}/extra`)).toBeNull();
  });

  it("loadAllowlist fails closed on a file that is not the committed schema", () => {
    const path = join(tempDir("rr-internal-allowlist-file-"), "allowlist.json");
    writeAllowlist(path, fixtureAllowlist());
    expect(loadAllowlist(path).repositories[0].repositoryRef).toBe(FIXTURE_REPOSITORY);

    writeFileSync(path, JSON.stringify({ ...fixtureAllowlist(), extra: "unreviewed" }));
    expect(() => loadAllowlist(path)).toThrow();
  });
});

describe("a run does not start with an unknown retention policy", () => {
  it("refuses before reading or writing, and names the reason", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" });

    await expect(
      startInternalRun({
        initiatedBy: CLI_INITIATOR,
        repositoryRef: FIXTURE_REPOSITORY,
        commitSha: repo.commitSha,
        retentionPolicy: "forever" as RetentionPolicy,
        ownershipConfirmed: true,
        source: { kind: "checkout", path: repo.path },
        allowlist: fixtureAllowlist(),
      }),
    ).rejects.toMatchObject({
      name: "RunRefused",
      reason: "retention_policy_unknown",
      message: expect.stringMatching(/offered retention/),
    });
    expect(listRuns()).toEqual([]);
  });
});

describe("a run id is a lowercase UUID, and loadRun trusts no other name", () => {
  it("accepts a minted id and refuses path, case, and padding evasions", () => {
    const minted = newRunId();
    expect(isRunId(minted)).toBe(true);
    expect(isRunId(minted.toUpperCase())).toBe(false);
    expect(isRunId(` ${minted}`)).toBe(false);
    expect(isRunId(`${minted}.json`)).toBe(false);
    expect(isRunId("../operators")).toBe(false);
    expect(isRunId("")).toBe(false);
    expect(isRunId("not-a-run")).toBe(false);
    expect(loadRun("../operators")).toBeNull();
    expect(loadRun(minted.toUpperCase())).toBeNull();
  });

  it("returns null when the stored record names a different run or schema", async () => {
    const repo = makeFixtureRepo({ "a.ts": "a\n" });
    const record = await startInternalRun({
      initiatedBy: CLI_INITIATOR,
      repositoryRef: FIXTURE_REPOSITORY,
      commitSha: repo.commitSha,
      retentionPolicy: "minimum_7_day",
      ownershipConfirmed: true,
      source: { kind: "checkout", path: repo.path },
      allowlist: fixtureAllowlist(),
    });
    expect(loadRun(record.runId)?.runId).toBe(record.runId);

    const path = join(localDir(), "runs", `${record.runId}.json`);
    const stored = JSON.parse(readFileSync(path, "utf8")) as typeof record;
    writeFileSync(path, JSON.stringify({ ...stored, runId: newRunId() }));
    expect(loadRun(record.runId)).toBeNull();

    writeFileSync(path, JSON.stringify({ ...stored, schemaVersion: "release-rescue-internal-run/v0" }));
    expect(loadRun(record.runId)).toBeNull();

    expect(() => saveRun({ ...record, runId: "../operators" })).toThrow(/Not a run id/);
  });
});
