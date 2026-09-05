import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  deriveCiConclusion,
  fetchPublicPullRequestMetadata,
  publicCheckRunsUrl,
  publicCommitStatusUrl,
  publicPullUrl,
} from "@/lib/public-github-pr";
import {
  TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA,
  TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
  TWL_PREPARE_PROOF_INPUT,
  TWL_PREPARE_PROOF_PR_SCHEMA,
  TWL_PREPARE_PROOF_SHADOW_KEY,
  TWL_PREPARE_PROOF_SPEC,
  assertPrepareOnlyWriteClosed,
  assertReadOnlyGithubRequest,
  evaluateTwlPrepareProofAccept,
  hashTwlPrepareProofPayload,
  isTwlPrepareProofSpec,
  routeTwlPrepareProofRelease,
  sealTwlPrepareProofPayload,
} from "@/lib/twl-prepare-proof";

const HEAD = "d8424117a02edbb7337e1697e5b44e045d21fce5";
const BASE = "9720ea48f34e1f2670088f1c129026d54668776e";

const spec = {
  actionClass: "prepare_only",
  requiredInputs: [TWL_PREPARE_PROOF_INPUT],
};

function assignment() {
  return sealTwlPrepareProofPayload({
    schemaVersion: TWL_PREPARE_PROOF_ASSIGNMENT_SCHEMA,
    workerKind: "shadow" as const,
    workerKey: TWL_PREPARE_PROOF_SHADOW_KEY,
    displayName: "SF-TWL prepare-only shadow",
    mayOwnAccept: false as const,
    actionClass: "prepare_only" as const,
    assignedBy: "user-operator-1",
    assignedAt: "2026-09-05T17:00:00.000Z",
  });
}

function prEvidence(overrides: Record<string, unknown> = {}) {
  return sealTwlPrepareProofPayload({
    schemaVersion: TWL_PREPARE_PROOF_PR_SCHEMA,
    owner: "Bthornton1994",
    repo: "three-white-lights",
    pullNumber: 35,
    htmlUrl: "https://github.com/Bthornton1994/three-white-lights/pull/35",
    headSha: HEAD,
    baseSha: BASE,
    title: "CAREER-EMPIRE-REP-01",
    state: "open",
    draft: true,
    upstreamMerged: false,
    ciConclusion: "success",
    mutatesRepository: false as const,
    mergePerformed: false as const,
    requestedMethod: "GET" as const,
    fetchedAt: "2026-09-05T17:01:00.000Z",
    source: "github-public-api" as const,
    ...overrides,
  });
}

function accept(evidence: Array<{ kind: "observation" | "source" | "other"; contentHash: string | null; payload: Record<string, unknown>; summary?: string }>, role = "ops_manager") {
  return evaluateTwlPrepareProofAccept({
    spec,
    evidence,
    actorRole: role,
  });
}

describe("SF-TWL-PREPARE-PROOF-01 contract", () => {
  it("freezes prepare_only and the required input marker", () => {
    expect(TWL_PREPARE_PROOF_SPEC.actionClass).toBe("prepare_only");
    expect(isTwlPrepareProofSpec(TWL_PREPARE_PROOF_SPEC)).toBe(true);
    expect(TWL_PREPARE_PROOF_SPEC.definitionOfDone.join(" ")).toMatch(/merge_performed=false/);
    expect(TWL_PREPARE_PROOF_SPEC.definitionOfDone.join(" ")).toMatch(/mutatesRepository=false/);
  });

  it("accepts only when assignment and hashed PR evidence are present for a manager", () => {
    const verdict = accept([
      { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
      { kind: "source", contentHash: "b".repeat(64), payload: prEvidence() },
    ]);
    expect(verdict.canAccept).toBe(true);
    expect(verdict.release.decision).toBe("ready_for_human_review");
    expect(verdict.release.mergePerformed).toBe(false);
    expect(verdict.release.deployAuthorized).toBe(false);
  });

  it("refuses Accept when only an agent report is present", () => {
    const verdict = accept([
      {
        kind: "other",
        contentHash: "c".repeat(64),
        payload: {
          schemaVersion: TWL_PREPARE_PROOF_AGENT_REPORT_SCHEMA,
          summary: "Looks good. Accept.",
          recommendation: "accept",
          workerKey: TWL_PREPARE_PROOF_SHADOW_KEY,
        },
      },
    ]);
    expect(verdict.canAccept).toBe(false);
    expect(verdict.failures.some((failure) => failure.includes("agent report alone"))).toBe(true);
    expect(verdict.escalation.reasons).toContain("agent_report_only");
    expect(verdict.release.decision).toBe("escalate");
  });

  it("refuses Accept by the assigned operator even with complete evidence", () => {
    const verdict = accept(
      [
        { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
        { kind: "source", contentHash: "b".repeat(64), payload: prEvidence() },
      ],
      "operator",
    );
    expect(verdict.canAccept).toBe(false);
    expect(verdict.escalation.reasons).toContain("worker_attempted_accept");
  });

  it("fails closed when evidence claims a repository mutation or merge", () => {
    const mutated = accept([
      { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
      { kind: "source", contentHash: "b".repeat(64), payload: { ...prEvidence(), mutatesRepository: true } },
    ]);
    expect(mutated.canAccept).toBe(false);
    expect(mutated.escalation.reasons).toContain("mutates_repository");

    const merged = accept([
      { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
      { kind: "source", contentHash: "b".repeat(64), payload: { ...prEvidence(), mergePerformed: true } },
    ]);
    expect(merged.canAccept).toBe(false);
    expect(merged.escalation.reasons).toContain("merge_performed");
  });

  it("fails closed when the stored payload hash no longer matches the bytes", () => {
    const payload = prEvidence();
    const tampered = { ...payload, title: "rewritten after freeze" };
    const verdict = accept([
      { kind: "observation", contentHash: "a".repeat(64), payload: assignment() },
      { kind: "source", contentHash: "b".repeat(64), payload: tampered },
    ]);
    expect(verdict.canAccept).toBe(false);
    expect(verdict.escalation.reasons).toContain("hash_mismatch");
    expect(hashTwlPrepareProofPayload(tampered)).not.toBe(payload.payloadHash);
  });
});

describe("fail-closed GitHub write and merge", () => {
  it("rejects non-GET methods and merge or write paths", () => {
    expect(assertReadOnlyGithubRequest({ method: "PUT", url: publicPullUrl({ owner: "Bthornton1994", repo: "three-white-lights", pullNumber: 35 }) }).ok).toBe(false);
    expect(
      assertReadOnlyGithubRequest({
        method: "PUT",
        url: "https://api.github.com/repos/Bthornton1994/three-white-lights/pulls/35/merge",
      }).ok,
    ).toBe(false);
    expect(
      assertReadOnlyGithubRequest({
        method: "POST",
        url: "https://api.github.com/repos/Bthornton1994/three-white-lights/issues",
      }).ok,
    ).toBe(false);
    expect(
      assertReadOnlyGithubRequest({
        method: "GET",
        url: "https://api.github.com/repos/Bthornton1994/three-white-lights/actions/secrets",
      }).ok,
    ).toBe(false);
    expect(assertPrepareOnlyWriteClosed({ action: "merge" }).ok).toBe(false);
    expect(assertPrepareOnlyWriteClosed({ action: "github_write" }).ok).toBe(false);
    expect(assertPrepareOnlyWriteClosed({ method: "PATCH", mergePerformed: true }).ok).toBe(false);
    expect(assertPrepareOnlyWriteClosed({ method: "GET", mutatesRepository: false, mergePerformed: false }).ok).toBe(true);
  });

  it("allows only the public pull and commit-status GET paths", () => {
    expect(assertReadOnlyGithubRequest({ method: "GET", url: publicPullUrl({ owner: "Bthornton1994", repo: "three-white-lights", pullNumber: 35 }) }).ok).toBe(true);
    expect(assertReadOnlyGithubRequest({ method: "GET", url: publicCommitStatusUrl("Bthornton1994", "three-white-lights", HEAD) }).ok).toBe(true);
    expect(assertReadOnlyGithubRequest({ method: "GET", url: publicCheckRunsUrl("Bthornton1994", "three-white-lights", HEAD) }).ok).toBe(true);
  });

  it("never routes a release into merge or deploy", () => {
    const hold = routeTwlPrepareProofRelease({ canAccept: false, escalationRequired: false, reasons: [] });
    const ready = routeTwlPrepareProofRelease({ canAccept: true, escalationRequired: false, reasons: [] });
    const escalate = routeTwlPrepareProofRelease({
      canAccept: false,
      escalationRequired: true,
      reasons: ["write_or_merge_attempted"],
    });
    for (const route of [hold, ready, escalate]) {
      expect(route.mergePerformed).toBe(false);
      expect(route.deployAuthorized).toBe(false);
      expect(["hold", "ready_for_human_review", "escalate"]).toContain(route.decision);
    }
  });
});

describe("public PR reader", () => {
  it("derives CI conclusion from check runs and combined status", () => {
    expect(deriveCiConclusion({ combinedState: "success", checkRuns: [] })).toBe("success");
    expect(
      deriveCiConclusion({
        combinedState: "success",
        checkRuns: [{ status: "in_progress", conclusion: null }],
      }),
    ).toBe("pending");
    expect(
      deriveCiConclusion({
        combinedState: "success",
        checkRuns: [{ status: "completed", conclusion: "failure" }],
      }),
    ).toBe("failure");
  });

  it("reads number, SHAs, HTML URL, and CI through GET-only fetches", async () => {
    const methods: string[] = [];
    const metadata = await fetchPublicPullRequestMetadata(
      { owner: "Bthornton1994", repo: "three-white-lights", pullNumber: 35 },
      async (url) => {
        methods.push("GET " + url);
        if (url.includes("/pulls/35")) {
          return {
            status: 200,
            body: {
              html_url: "https://github.com/Bthornton1994/three-white-lights/pull/35",
              title: "CAREER-EMPIRE-REP-01",
              state: "open",
              draft: true,
              merged: false,
              head: { sha: HEAD },
              base: { sha: BASE },
            },
          };
        }
        if (url.endsWith("/status")) {
          return { status: 200, body: { state: "success" } };
        }
        return {
          status: 200,
          body: { check_runs: [{ status: "completed", conclusion: "success" }] },
        };
      },
    );
    expect(metadata.pullNumber).toBe(35);
    expect(metadata.headSha).toBe(HEAD);
    expect(metadata.baseSha).toBe(BASE);
    expect(metadata.htmlUrl).toContain("/pull/35");
    expect(metadata.ciConclusion).toBe("success");
    expect(methods.every((entry) => entry.startsWith("GET "))).toBe(true);
    expect(methods.some((entry) => entry.includes("/merge"))).toBe(false);
  });
});

describe("source fail-closed", () => {
  it("keeps the reader and actions free of GitHub write calls", () => {
    const reader = readFileSync(resolve(process.cwd(), "src/lib/public-github-pr.ts"), "utf8");
    const actions = readFileSync(resolve(process.cwd(), "src/app/actions/twl-prepare-proof.ts"), "utf8");
    const run = readFileSync(resolve(process.cwd(), "src/lib/twl-prepare-proof-run.ts"), "utf8");
    for (const source of [reader, actions, run]) {
      expect(source).not.toMatch(/Authorization\s*:/);
      expect(source).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
      expect(source).not.toMatch(/\/pulls\/\$\{[^}]+\}(?:\/merge)?["']\s*,\s*\{\s*method:\s*["']PUT["']/);
    }
    expect(reader).toMatch(/method: "GET"/);
    expect(reader).toContain("assertReadOnlyGithubRequest");
  });

  it("keeps the QA fixture out of Production migrations", () => {
    const fixture = readFileSync(resolve(process.cwd(), "supabase/qa/sf_twl_prepare_proof_01.sql"), "utf8");
    expect(fixture).toContain("northline-consulting-test");
    expect(fixture).toContain("'prepare_only'");
    expect(fixture).toContain("twl-prepare-proof/v1");
    expect(fixture).toContain("merge_performed=false");
    expect(fixture).not.toMatch(/update public\.workstream_runs[\s\S]*status='verified'/);
  });
});
