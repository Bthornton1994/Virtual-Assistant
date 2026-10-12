import { describe, expect, it } from "vitest";
import {
  canDispatchIndependentWork,
  serializeConflict,
  validateItemRecord,
  type ItemRecord,
  type PublicAction,
  type WorkProposal,
} from "@/lib/cos-control-plane";

// Remaining #126 branches that the snapshot suite and open #128 gates do not
// pin: unknown wait shape, missing required fields, a free-branch rebase,
// and same-PR serialization without a gate.

const SHA = "2acdccbe97b51a592174321f35807e2b4a558bef";
const OTHER_SHA = "23b983dc9d6f38cc5cb96fd6630c1937f58945c0";
const REPO = "Bthornton1994/Virtual-Assistant";

function record(overrides: Partial<ItemRecord> = {}): ItemRecord {
  return {
    repo: REPO,
    issueOrPr: "#1",
    ownerOrWorker: "owner",
    branch: "work",
    worktree: null,
    fullSha: SHA,
    phase: "implementing",
    externalWait: { kind: "none", exactRunOrSha: null, owner: null },
    gateOrBlocker: null,
    lastEvidence: "recorded",
    nextAction: "continue",
    ...overrides,
  };
}

function errorsOf(input: unknown): readonly string[] {
  const parsed = validateItemRecord(input);
  return parsed.ok ? [] : parsed.errors;
}

function proposal(overrides: Partial<WorkProposal> = {}): WorkProposal {
  return {
    repo: REPO,
    branch: "other",
    fullSha: null,
    kind: "independent_implementation",
    issueOrPr: "#2",
    ontoBranch: null,
    ...overrides,
  };
}

describe("validateItemRecord refuses an unknown wait and missing required fields", () => {
  it("rejects a missing wait object and an unknown wait kind", () => {
    expect(errorsOf({ ...record(), externalWait: null })).toContain("externalWait is required");
    expect(errorsOf({ ...record(), externalWait: [] })).toContain("externalWait is required");
    expect(
      errorsOf({
        ...record(),
        externalWait: { kind: "paused", exactRunOrSha: SHA, owner: "qa" },
      }),
    ).toContain("externalWait.kind is not a known wait");
  });

  it.each(["issueOrPr", "ownerOrWorker", "branch", "lastEvidence", "nextAction"] as const)(
    "rejects a blank %s",
    (field) => {
      expect(errorsOf({ ...record(), [field]: "  " })).toContain(`${field} is required`);
    },
  );

  it("accepts a review wait and a worktree path", () => {
    expect(
      validateItemRecord(
        record({
          worktree: "/tmp/work",
          phase: "blocked",
          externalWait: { kind: "review", exactRunOrSha: "run-1", owner: "reviewer" },
          gateOrBlocker: "waiting on review",
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("canDispatchIndependentWork allows a free branch and the same item's seat", () => {
  it("allows a rebase onto a branch that is not in qa_wait", () => {
    const ledger = [record({ branch: "work", phase: "implementing" })];
    const decision = canDispatchIndependentWork(
      ledger,
      proposal({
        branch: "other",
        kind: "rebase",
        issueOrPr: "#2",
        ontoBranch: "main",
        fullSha: OTHER_SHA,
      }),
    );
    expect(decision.allowed).toBe(true);
  });

  it("allows the first writer on an empty ledger", () => {
    expect(canDispatchIndependentWork([], proposal({ kind: "branch_write" })).allowed).toBe(true);
    expect(canDispatchIndependentWork([], proposal({ kind: "independent_implementation" })).reason).toContain(
      "No exact-SHA QA wait",
    );
  });
});

describe("serializeConflict keys the pull request even without a branch", () => {
  it("defers a second mutation on the same pull request across branches", () => {
    const first: PublicAction = {
      id: "write-a",
      repo: REPO,
      branch: "a",
      issueOrPr: "#9",
      kind: "branch_write",
      actor: "one",
    };
    const second: PublicAction = {
      id: "mutate-b",
      repo: REPO,
      branch: "b",
      issueOrPr: "#9",
      kind: "pr_mutation",
      actor: "two",
    };
    const otherRepo: PublicAction = {
      id: "foreign",
      repo: "other/repo",
      branch: "a",
      issueOrPr: "#9",
      kind: "merge",
      actor: "three",
    };
    const result = serializeConflict([first, second, otherRepo]);
    expect(result.admitted.map((action) => action.id)).toEqual(["write-a", "foreign"]);
    expect(result.deferred.map((entry) => entry.action.id)).toEqual(["mutate-b"]);
  });
});
