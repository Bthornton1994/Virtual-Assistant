import { describe, expect, it } from "vitest";
import {
  assertSingleWaitOwner,
  canDispatchIndependentWork,
  classifyScope,
  serializeConflict,
  validateItemRecord,
  type ItemRecord,
  type PublicAction,
  type WorkProposal,
} from "@/lib/cos-control-plane";

// Remaining fail-closed branches from #126. The original suite pins the
// #108/#111 snapshot. These cases hold the record, wait, dispatch, and
// serialization gates that snapshot does not exercise.

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

function action(overrides: Partial<PublicAction> & Pick<PublicAction, "id" | "kind">): PublicAction {
  return {
    repo: REPO,
    branch: "work",
    issueOrPr: "#1",
    actor: "writer",
    ...overrides,
  };
}

function errorsOf(input: unknown): readonly string[] {
  const parsed = validateItemRecord(input);
  return parsed.ok ? [] : parsed.errors;
}

describe("classifyScope never sweeps a vacant or single-item request", () => {
  it("keeps an empty queue, including an ongoing one, off the portfolio sweep", () => {
    const vacant = classifyScope({ items: [], ongoing: true });
    expect(vacant.scope).toBe("single");
    expect(vacant.portfolioSweep).toBe(false);
  });

  it("keeps one item off the sweep even when marked ongoing", () => {
    const one = classifyScope({
      items: [{ repo: REPO, issueOrPr: "#1" }],
      ongoing: true,
    });
    expect(one.scope).toBe("single");
    expect(one.portfolioSweep).toBe(false);
  });
});

describe("validateItemRecord fail-closed shape and wait pairing", () => {
  it("rejects a non-object, missing nullable keys, whitespace, and an uppercase SHA", () => {
    expect(errorsOf(null)).toEqual(["item record must be an object"]);
    expect(errorsOf([])).toEqual(["item record must be an object"]);

    const missingNullables = { ...record() } as Record<string, unknown>;
    delete missingNullables.worktree;
    delete missingNullables.gateOrBlocker;
    const missing = errorsOf(missingNullables);
    expect(missing).toContain("worktree is required (null when there is no worktree)");
    expect(missing).toContain("gateOrBlocker is required (null when there is no gate)");

    expect(errorsOf({ ...record(), repo: "   " })).toContain("repo is required");
    expect(errorsOf({ ...record(), worktree: "" })).toContain("worktree must be a path or null");
    expect(errorsOf({ ...record(), fullSha: SHA.toUpperCase() })).toContain(
      "fullSha must be a 40-character lowercase hex commit",
    );
    expect(errorsOf({ ...record(), phase: "done" })).toContain("phase is not a known phase");
  });

  it("rejects a none-wait that still names a run, SHA, or owner", () => {
    const withSha = errorsOf({
      ...record(),
      externalWait: { kind: "none", exactRunOrSha: SHA, owner: null },
    });
    const withOwner = errorsOf({
      ...record(),
      externalWait: { kind: "none", exactRunOrSha: null, owner: "watcher" },
    });
    expect(withSha).toContain("externalWait.exactRunOrSha must be null when there is no wait");
    expect(withOwner).toContain("externalWait.owner must be null when there is no wait");
  });

  it("rejects a real wait without a single owner or an exact run or SHA", () => {
    const missing = errorsOf({
      ...record(),
      externalWait: { kind: "ci", exactRunOrSha: "", owner: "" },
    });
    expect(missing).toContain("externalWait.exactRunOrSha is required for an external wait");
    expect(missing).toContain("externalWait.owner is required for an external wait");

    for (const owner of ["ann, bea", "ann; bea", "ann and bea"]) {
      expect(
        errorsOf({
          ...record(),
          externalWait: { kind: "review", exactRunOrSha: "run-1", owner },
        }),
      ).toContain("externalWait.owner must be a single owner");
    }
  });

  it("pairs qa_wait with an exact-SHA qa wait and owner_gate with a blocker", () => {
    expect(
      errorsOf({
        ...record(),
        phase: "qa_wait",
        externalWait: { kind: "none", exactRunOrSha: null, owner: null },
      }),
    ).toContain("qa_wait requires an external qa wait");

    expect(
      errorsOf({
        ...record(),
        phase: "qa_wait",
        externalWait: { kind: "ci", exactRunOrSha: "run-1", owner: "ci" },
      }),
    ).toContain("qa_wait requires an external qa wait");

    expect(errorsOf({ ...record(), phase: "owner_gate", gateOrBlocker: null })).toContain(
      "owner_gate requires a gateOrBlocker",
    );
    expect(errorsOf({ ...record(), phase: "owner_gate", gateOrBlocker: "   " })).toContain(
      "gateOrBlocker must be text or null",
    );

    expect(
      validateItemRecord({
        ...record(),
        phase: "qa_wait",
        externalWait: { kind: "qa", exactRunOrSha: SHA, owner: "qa" },
      }).ok,
    ).toBe(true);
    expect(validateItemRecord({ ...record(), phase: "owner_gate", gateOrBlocker: "KEEP_DRAFT" }).ok).toBe(true);
  });
});

describe("assertSingleWaitOwner keys the wait, not the item title", () => {
  it("surfaces invalid records and does not treat none-waits or other keys as duplicates", () => {
    const invalid = assertSingleWaitOwner([{ issueOrPr: "#bad" }]);
    expect(invalid.length).toBeGreaterThan(0);

    expect(
      assertSingleWaitOwner([
        record({ issueOrPr: "#a" }),
        record({ issueOrPr: "#b", branch: "other", fullSha: OTHER_SHA }),
      ]),
    ).toEqual([]);

    expect(
      assertSingleWaitOwner([
        record({
          issueOrPr: "#ci",
          phase: "blocked",
          externalWait: { kind: "ci", exactRunOrSha: "run-1", owner: "ci" },
        }),
        record({
          issueOrPr: "#qa",
          branch: "qa",
          phase: "qa_wait",
          externalWait: { kind: "qa", exactRunOrSha: SHA, owner: "qa" },
        }),
        record({
          repo: "other/repo",
          issueOrPr: "#foreign",
          phase: "qa_wait",
          externalWait: { kind: "qa", exactRunOrSha: SHA, owner: "other-qa" },
        }),
      ]),
    ).toEqual([]);
  });
});

describe("canDispatchIndependentWork fail-closed proposal and occupancy", () => {
  it("refuses a malformed proposal before reading the ledger", () => {
    expect(canDispatchIndependentWork([], proposal({ repo: " " })).allowed).toBe(false);
    expect(canDispatchIndependentWork([], proposal({ branch: "" })).allowed).toBe(false);
    expect(canDispatchIndependentWork([], proposal({ issueOrPr: "\t" })).allowed).toBe(false);
    expect(canDispatchIndependentWork([], proposal({ fullSha: "abc" })).allowed).toBe(false);
    expect(canDispatchIndependentWork([], proposal({ fullSha: SHA.toUpperCase() })).allowed).toBe(false);
    expect(
      canDispatchIndependentWork([], proposal({ kind: "not-a-kind" as WorkProposal["kind"] })).reason,
    ).toContain("proposal kind is not a known kind");
    expect(
      canDispatchIndependentWork([], proposal({ kind: "branch_write", ontoBranch: "main" })).reason,
    ).toContain("ontoBranch is only valid for a rebase");
  });

  it("blocks every write class on a qa-wait branch and still allows read-only analysis there", () => {
    const waiting = record({
      phase: "qa_wait",
      externalWait: { kind: "qa", exactRunOrSha: SHA, owner: "qa" },
    });

    for (const kind of ["branch_write", "rebase", "pr_mutation", "merge", "independent_implementation"] as const) {
      const decision = canDispatchIndependentWork([waiting], proposal({ branch: "work", kind, issueOrPr: "#1" }));
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain(SHA);
    }

    const analysis = canDispatchIndependentWork(
      [waiting],
      proposal({ branch: "work", kind: "read_only_analysis", issueOrPr: "#note" }),
    );
    expect(analysis.allowed).toBe(true);
  });

  it("lets a closed occupant free the branch and lets the same item keep its own seat", () => {
    const closed = record({ issueOrPr: "#old", phase: "closed" });
    const live = record({ issueOrPr: "#1", phase: "implementing" });

    expect(
      canDispatchIndependentWork([closed], proposal({ branch: "work", kind: "branch_write", issueOrPr: "#new" }))
        .allowed,
    ).toBe(true);

    expect(
      canDispatchIndependentWork([live], proposal({ branch: "work", kind: "branch_write", issueOrPr: "#1" })).allowed,
    ).toBe(true);

    expect(
      canDispatchIndependentWork([live], proposal({ branch: "work", kind: "branch_write", issueOrPr: "#other" }))
        .allowed,
    ).toBe(false);
  });
});

describe("serializeConflict lanes and gates", () => {
  it("defers an unknown public action and holds mutations behind owner_gate", () => {
    const unknown = serializeConflict([
      action({ id: "bad", kind: "not-a-kind" as PublicAction["kind"] }),
    ]);
    expect(unknown.admitted).toEqual([]);
    expect(unknown.deferred[0]?.reason).toContain("not a known public action");

    const held = record({
      phase: "owner_gate",
      gateOrBlocker: "KEEP_DRAFT",
      externalWait: { kind: "owner", exactRunOrSha: SHA, owner: "owner" },
    });
    const gated = serializeConflict(
      [
        action({ id: "read", kind: "read" }),
        action({ id: "merge", kind: "merge" }),
        action({ id: "other-repo", repo: "other/repo", branch: "work", issueOrPr: "#9", kind: "merge" }),
      ],
      [held],
    );
    expect(gated.admitted.map((entry) => entry.id)).toEqual(["read", "other-repo"]);
    expect(gated.deferred.map((entry) => entry.action.id)).toEqual(["merge"]);
    expect(gated.deferred[0]?.reason).toContain("owner_gate");
  });

  it("does not let a blocked item hold a lane, and keeps live-env off the branch lane", () => {
    const blocked = record({ phase: "blocked", gateOrBlocker: "waiting on input" });
    const result = serializeConflict(
      [
        action({ id: "write", kind: "branch_write" }),
        action({ id: "release", kind: "release", branch: null, issueOrPr: null }),
        action({
          id: "same-pr",
          kind: "pr_mutation",
          branch: "other",
          issueOrPr: "#1",
        }),
      ],
      [blocked],
    );
    expect(result.admitted.map((entry) => entry.id)).toEqual(["write", "release"]);
    expect(result.deferred.map((entry) => entry.action.id)).toEqual(["same-pr"]);
  });
});
