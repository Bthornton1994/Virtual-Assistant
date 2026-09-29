import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertGatesClosed,
  assertSingleWaitOwner,
  canDispatchIndependentWork,
  classifyScope,
  serializeConflict,
  validateItemRecord,
  type ItemRecord,
  type PublicAction,
  type WorkProposal,
} from "@/lib/cos-control-plane";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const VA_108_SHA = "2acdccbe97b51a592174321f35807e2b4a558bef";
const VA_108_BRANCH = "cursor/missing-test-coverage-90ed";
const VA_111_SHA = "23b983dc9d6f38cc5cb96fd6630c1937f58945c0";
const VA_111_BRANCH = "cursor/missing-test-coverage-8e40";
const ML_163_SHA = "789662fea5fd25eed1d9350c2823a168c3c2ba42";
const MAIN_SHA = "fa0d9e8e35e9704bbe61dbcf5bb333f37d9b6412";
/** Not a live branch pin. The t1708u snapshot did not record the Media Lens branch. */
const ML_163_BRANCH_UNPINNED = "unpinned-in-t1708u-snapshot";

function item(overrides: Partial<ItemRecord> & Pick<ItemRecord, "repo" | "issueOrPr" | "branch" | "fullSha">): ItemRecord {
  return {
    ownerOrWorker: "owner",
    worktree: null,
    phase: "implementing",
    externalWait: { kind: "none", exactRunOrSha: null, owner: null },
    gateOrBlocker: null,
    lastEvidence: "snapshot recorded",
    nextAction: "continue authorized work",
    ...overrides,
  };
}

function va108QaWait(): ItemRecord {
  return item({
    repo: "Bthornton1994/Virtual-Assistant",
    issueOrPr: "#108",
    ownerOrWorker: "independent-qa",
    branch: VA_108_BRANCH,
    fullSha: VA_108_SHA,
    phase: "qa_wait",
    externalWait: { kind: "qa", exactRunOrSha: VA_108_SHA, owner: "independent-qa" },
    gateOrBlocker: "KEEP_DRAFT independent QA",
    lastEvidence: `IR running at ${VA_108_SHA}`,
    nextAction: "Resume only after exact-SHA CLEAR. Do not write this branch.",
  });
}

function proposal(overrides: Partial<WorkProposal> & Pick<WorkProposal, "branch" | "kind" | "issueOrPr">): WorkProposal {
  return {
    repo: "Bthornton1994/Virtual-Assistant",
    fullSha: null,
    ontoBranch: null,
    ...overrides,
  };
}

describe("classifyScope", () => {
  it("keeps a single pull request off the portfolio sweep", () => {
    const classification = classifyScope({
      items: [{ repo: "Bthornton1994/Virtual-Assistant", issueOrPr: "#108" }],
      ongoing: false,
    });
    expect(classification.scope).toBe("single");
    expect(classification.portfolioSweep).toBe(false);
    expect(classification.reason).toContain("No portfolio sweep");
  });

  it("records scoped owners, status, and next actions for a finite multi-repo queue", () => {
    const queue = [
      item({
        repo: "Bthornton1994/Virtual-Assistant",
        issueOrPr: "#111",
        ownerOrWorker: "read-only-analyst",
        branch: VA_111_BRANCH,
        fullSha: VA_111_SHA,
        phase: "intake",
        gateOrBlocker: "KEEP_DRAFT until its own CLEAR",
        lastEvidence: "docs/cos/VA-111-RO-READINESS.md",
        nextAction: "Read-only conflict analysis. Do not rebase onto #108.",
      }),
      item({
        repo: "Media-Lens",
        issueOrPr: "#163",
        ownerOrWorker: "ml-independent-qa",
        branch: ML_163_BRANCH_UNPINNED,
        fullSha: ML_163_SHA,
        phase: "owner_gate",
        externalWait: { kind: "owner", exactRunOrSha: ML_163_SHA, owner: "ml-independent-qa" },
        gateOrBlocker: "KEEP_DRAFT. Media Lens #118 flag stays off.",
        lastEvidence: `PASS at ${ML_163_SHA}. Flag remains off.`,
        nextAction: "Hold the draft. Do not open #118.",
      }),
    ];
    const classification = classifyScope({
      items: queue.map((record) => ({ repo: record.repo, issueOrPr: record.issueOrPr })),
      ongoing: false,
    });
    expect(classification.scope).toBe("batch");
    expect(classification.portfolioSweep).toBe(false);
    expect(assertSingleWaitOwner(queue)).toEqual([]);
    expect(queue.map((record) => ({
      repo: record.repo,
      issueOrPr: record.issueOrPr,
      ownerOrWorker: record.ownerOrWorker,
      phase: record.phase,
      nextAction: record.nextAction,
    }))).toEqual([
      {
        repo: "Bthornton1994/Virtual-Assistant",
        issueOrPr: "#111",
        ownerOrWorker: "read-only-analyst",
        phase: "intake",
        nextAction: "Read-only conflict analysis. Do not rebase onto #108.",
      },
      {
        repo: "Media-Lens",
        issueOrPr: "#163",
        ownerOrWorker: "ml-independent-qa",
        phase: "owner_gate",
        nextAction: "Hold the draft. Do not open #118.",
      },
    ]);
  });

  it("starts a portfolio sweep only for ongoing multi-item coordination", () => {
    const classification = classifyScope({
      items: [
        { repo: "Bthornton1994/Virtual-Assistant", issueOrPr: "#111" },
        { repo: "Media-Lens", issueOrPr: "#163" },
      ],
      ongoing: true,
    });
    expect(classification.scope).toBe("portfolio");
    expect(classification.portfolioSweep).toBe(true);
  });
});

describe("validateItemRecord", () => {
  it("accepts the #108 exact-SHA QA record", () => {
    expect(validateItemRecord(va108QaWait()).ok).toBe(true);
  });

  it("rejects a short SHA, a QA wait that names a different SHA, and a second watcher", () => {
    const short = validateItemRecord({ ...va108QaWait(), fullSha: "2acdccbe" });
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.errors).toContain("fullSha must be a 40-character lowercase hex commit");

    const mismatched = validateItemRecord({
      ...va108QaWait(),
      externalWait: { kind: "qa", exactRunOrSha: MAIN_SHA, owner: "independent-qa" },
    });
    expect(mismatched.ok).toBe(false);

    const duplicate = assertSingleWaitOwner([
      va108QaWait(),
      item({
        ...va108QaWait(),
        issueOrPr: "#108-shadow",
        externalWait: { kind: "qa", exactRunOrSha: VA_108_SHA, owner: "second-watcher" },
      }),
    ]);
    expect(duplicate.some((error) => error.startsWith("duplicate watcher"))).toBe(true);
  });
});

describe("canDispatchIndependentWork", () => {
  const ledger = [va108QaWait()];

  it("dispatches independent work while exact-SHA QA waits on another branch", () => {
    const decision = canDispatchIndependentWork(
      ledger,
      proposal({
        branch: "cursor/cos-control-plane-1316",
        kind: "independent_implementation",
        issueOrPr: "t1708u",
        fullSha: MAIN_SHA,
      }),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toContain(VA_108_SHA);
  });

  it("refuses #108 branch writes and a rebase onto that branch, and allows #111 read-only analysis", () => {
    const write = canDispatchIndependentWork(
      ledger,
      proposal({ branch: VA_108_BRANCH, kind: "branch_write", issueOrPr: "#108", fullSha: VA_108_SHA }),
    );
    expect(write.allowed).toBe(false);
    expect(write.reason).toContain(VA_108_SHA);
    expect(write.reason).toContain(VA_108_BRANCH);

    const rebase = canDispatchIndependentWork(
      ledger,
      proposal({
        branch: VA_111_BRANCH,
        kind: "rebase",
        issueOrPr: "#111",
        fullSha: VA_111_SHA,
        ontoBranch: VA_108_BRANCH,
      }),
    );
    expect(rebase.allowed).toBe(false);
    expect(rebase.reason).toContain("does not authorize a rebase");

    const analysis = canDispatchIndependentWork(
      ledger,
      proposal({
        branch: VA_111_BRANCH,
        kind: "read_only_analysis",
        issueOrPr: "#111",
        fullSha: VA_111_SHA,
      }),
    );
    expect(analysis.allowed).toBe(true);

    const stillBlocked = canDispatchIndependentWork(
      ledger,
      proposal({ branch: VA_108_BRANCH, kind: "branch_write", issueOrPr: "#108", fullSha: VA_108_SHA }),
    );
    expect(stillBlocked.allowed).toBe(false);
  });

  it("allows #111 read-only analysis without giving that branch a second writer", () => {
    const withWriter: ItemRecord[] = [
      va108QaWait(),
      item({
        repo: "Bthornton1994/Virtual-Assistant",
        issueOrPr: "#111",
        ownerOrWorker: "read-only-analyst",
        branch: VA_111_BRANCH,
        fullSha: VA_111_SHA,
        phase: "intake",
        nextAction: "Read-only conflict analysis.",
      }),
    ];
    const analysis = canDispatchIndependentWork(
      withWriter,
      proposal({ branch: VA_111_BRANCH, kind: "read_only_analysis", issueOrPr: "#111-note", fullSha: VA_111_SHA }),
    );
    const overlap = canDispatchIndependentWork(
      withWriter,
      proposal({ branch: VA_111_BRANCH, kind: "branch_write", issueOrPr: "#111-writer", fullSha: VA_111_SHA }),
    );
    expect(analysis.allowed).toBe(true);
    expect(overlap.allowed).toBe(false);
    expect(overlap.reason).toContain("One writer per branch");
  });
});

describe("serializeConflict", () => {
  it("serializes same-branch public actions and keeps the #108 QA gate", () => {
    const other = "cursor/cos-control-plane-1316";
    const actions: PublicAction[] = [
      {
        id: "read-111",
        repo: "Bthornton1994/Virtual-Assistant",
        branch: VA_111_BRANCH,
        issueOrPr: "#111",
        kind: "read",
        actor: "analyst",
      },
      {
        id: "merge-108",
        repo: "Bthornton1994/Virtual-Assistant",
        branch: VA_108_BRANCH,
        issueOrPr: "#108",
        kind: "merge",
        actor: "writer",
      },
      {
        id: "write-new",
        repo: "Bthornton1994/Virtual-Assistant",
        branch: other,
        issueOrPr: "t1708u",
        kind: "branch_write",
        actor: "implementer",
      },
      {
        id: "write-new-again",
        repo: "Bthornton1994/Virtual-Assistant",
        branch: other,
        issueOrPr: "t1708u",
        kind: "pr_mutation",
        actor: "second-writer",
      },
      {
        id: "deploy",
        repo: "example/shared-env",
        branch: null,
        issueOrPr: null,
        kind: "deploy",
        actor: "release",
      },
      {
        id: "shared-env",
        repo: "example/shared-env",
        branch: null,
        issueOrPr: null,
        kind: "shared_env",
        actor: "release",
      },
    ];
    const result = serializeConflict(actions, [va108QaWait()]);
    expect(result.admitted.map((action) => action.id)).toEqual(["read-111", "write-new", "deploy"]);
    expect(result.deferred.map((entry) => entry.action.id)).toEqual([
      "merge-108",
      "write-new-again",
      "shared-env",
    ]);
    expect(result.deferred[0]?.reason).toContain(VA_108_SHA);
  });
});

describe("assertGatesClosed", () => {
  it("keeps #118 and Markout C2, C3, and C5 closed", () => {
    const untouched = assertGatesClosed([]);
    expect(untouched.ok).toBe(true);
    expect(untouched.closed).toEqual(["ml-118", "markout-c2", "markout-c3", "markout-c5"]);

    const passDoesNotOpenFlag = assertGatesClosed([{ id: "ml-163", status: "open" }]);
    expect(passDoesNotOpenFlag.ok).toBe(true);
    expect(passDoesNotOpenFlag.closed).toContain("ml-118");

    for (const id of ["ml-118", "markout-c2", "markout-c3", "markout-c5"]) {
      const attempt = assertGatesClosed([{ id, status: "open" }]);
      expect(attempt.ok).toBe(false);
      expect(attempt.violations.length).toBeGreaterThan(0);
    }
  });
});

describe("t1708u readiness fixture", () => {
  it("pins the #111 read-only note and the identical skill pair", () => {
    const note = readFileSync(path.join(repoRoot, "docs/cos/VA-111-RO-READINESS.md"), "utf8");
    expect(note).toContain(VA_108_SHA);
    expect(note).toContain(VA_111_SHA);
    expect(note).toContain(MAIN_SHA);
    expect(note).toContain(VA_108_BRANCH);
    expect(note).toContain(VA_111_BRANCH);
    expect(note).toContain("Read-only");
    expect(note).toContain("rebase");

    const canonical = readFileSync(
      path.join(repoRoot, ".agents/skills/cos-portfolio-control/SKILL.md"),
      "utf8",
    );
    const mirror = readFileSync(
      path.join(repoRoot, ".claude/skills/cos-portfolio-control/SKILL.md"),
      "utf8",
    );
    expect(mirror).toBe(canonical);
    expect(canonical).toContain("name: cos-portfolio-control");
    expect(canonical).toContain("No portfolio sweep");
  });
});
