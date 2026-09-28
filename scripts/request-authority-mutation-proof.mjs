#!/usr/bin/env node
/**
 * Proof that each request-authority gate is held by a test that fails without it.
 *
 * Each entry below removes ONE gate, by an exact textual replacement, and runs
 * the request-authority suites. A gate is HELD when at least one test that
 * passed before the change fails after it. Scoring is the difference between
 * the failing-test sets, read from vitest's JSON report, never an exit code or
 * a count. `CONTROL` changes only a comment and must fail nothing.
 *
 * What this does not prove: that a gate is sufficient, or that the tests say
 * why it exists. It proves only that removing the gate is noticed.
 *
 * It edits the files it names on disk while it runs, and restores them at the
 * end, on an interrupt, and on an uncaught error. It refuses to start if any of
 * those files has uncommitted changes, so a restore can never discard work.
 *
 *   npm run proof:request-authority
 *   npm run proof:request-authority -- --only M-SB-START-SENSITIVE,M-FLOOR-OBJECTIVE
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const AUTHORITY = "src/lib/ai-authority.ts";
const MEMORY = "src/lib/store.ts";
const SUPABASE = "src/lib/data/supabase-workspace.ts";

const SUITES = ["src/lib/__tests__/request-authority.test.ts", "src/lib/__tests__/request-authority-gates.test.ts"];

const MUTANTS = [
  // RR119-P1-A: every delivery check, in both stores, on both paths to delivered.
  {
    id: "M-MEM-DELIVER-QA",
    guard: "in-memory delivery requires a current QA pass",
    file: MEMORY,
    from: '    if (!this.hasCurrentPassedQa(req)) {\n      throw new DomainError("QA must pass before delivery");\n    }\n',
    to: "",
  },
  {
    id: "M-MEM-DELIVER-PLAN",
    guard: "in-memory delivery requires the plan approved at the current class",
    file: MEMORY,
    from: "    if (this.planApprovalOutstanding(req)) {\n      throw new DomainError(\"The execution plan must be approved at the request's current authority before delivery\");\n    }\n",
    to: "",
  },
  {
    id: "M-MEM-DELIVER-OUTBOUND",
    guard: "in-memory delivery of outbound work requires a covering outbound approval",
    file: MEMORY,
    from: '    if (needsOutbound && !this.hasCoveringApproval(req, "external_email")) {\n      throw new DomainError("Outbound action requires customer approval before delivery");\n    }\n',
    to: "",
  },
  {
    id: "M-MEM-DELIVER-SENSITIVE",
    guard: "in-memory delivery of sensitive work requires a covering sensitive approval",
    file: MEMORY,
    from: '    if (req.approvalLevel === "sensitive_execution" && !this.hasCoveringApproval(req, "sensitive_action")) {\n      throw new DomainError("Sensitive action requires customer approval before delivery");\n    }\n',
    to: "",
  },
  {
    id: "M-MEM-DELIVER-VIA-PACKAGE",
    guard: "in-memory deliverRequest runs the delivery checks",
    file: MEMORY,
    from: "    this.assertDeliverable(req);\n    const needsOutbound",
    to: "    const needsOutbound",
  },
  {
    id: "M-MEM-DELIVER-VIA-TRANSITION",
    guard: "in-memory transitionRequest to delivered runs the delivery checks",
    file: MEMORY,
    from: "      this.assertDeliverable(req);\n    }\n",
    to: "    }\n",
  },
  {
    id: "M-SB-DELIVER-QA",
    guard: "Supabase delivery requires a current QA pass",
    file: SUPABASE,
    from: '    if (!(await this.hasCurrentPassedQa(db, req))) throw new DomainError("QA must pass before delivery");\n',
    to: "",
  },
  {
    id: "M-SB-DELIVER-PLAN",
    guard: "Supabase delivery requires the plan approved at the current class",
    file: SUPABASE,
    from: "    if (await this.planApprovalOutstanding(db, req)) {\n      throw new DomainError(\"The execution plan must be approved at the request's current authority before delivery\");\n    }\n",
    to: "",
  },
  {
    id: "M-SB-DELIVER-OUTBOUND",
    guard: "Supabase delivery of outbound work requires a covering outbound approval",
    file: SUPABASE,
    from: '      throw new DomainError("Outbound action requires customer approval before delivery");\n',
    to: "",
  },
  {
    id: "M-SB-DELIVER-SENSITIVE",
    guard: "Supabase delivery of sensitive work requires a covering sensitive approval",
    file: SUPABASE,
    from: '      throw new DomainError("Sensitive action requires customer approval before delivery");\n',
    to: "",
  },
  {
    id: "M-SB-DELIVER-VIA-PACKAGE",
    guard: "Supabase deliverRequest runs the delivery checks",
    file: SUPABASE,
    from: "    await this.assertDeliverable(db, req);\n    if (existing) {",
    to: "    if (existing) {",
  },
  {
    id: "M-SB-DELIVER-VIA-TRANSITION",
    guard: "Supabase transitionRequest to delivered runs the delivery checks",
    file: SUPABASE,
    from: "      await this.assertDeliverable(db, req);\n    }\n",
    to: "    }\n",
  },

  // RR119-P1-B: the sensitive start gate and the class check behind it.
  {
    id: "M-SB-START-SENSITIVE",
    guard: "Supabase sensitive work cannot enter in_progress without a covering sensitive approval",
    file: SUPABASE,
    from: '    if (to === "in_progress" && blocksWithoutApproval(req.approvalLevel)) {\n      if (!(await this.hasCoveringApproval(db, req, "sensitive_action"))) {',
    to: '    if (false) {\n      if (!(await this.hasCoveringApproval(db, req, "sensitive_action"))) {',
  },
  {
    id: "M-SB-COVERS",
    guard: "Supabase: an approved approval counts only at the class it covers",
    file: SUPABASE,
    from: ".some((a) => approvalCovers({ kind, actionClass: a.action_class as ActionClass }, req));",
    to: ".length > 0;",
  },
  {
    id: "M-MEM-START-SENSITIVE",
    guard: "in-memory sensitive work cannot enter in_progress without a covering sensitive approval",
    file: MEMORY,
    from: '    if (to === "in_progress" && blocksWithoutApproval(req.approvalLevel)) {\n      if (!this.hasCoveringApproval(req, "sensitive_action")) {',
    to: '    if (false) {\n      if (!this.hasCoveringApproval(req, "sensitive_action")) {',
  },
  {
    id: "M-MEM-COVERS",
    guard: "in-memory: an approved approval counts only at the class it covers",
    file: MEMORY,
    from: 'a.kind === kind && a.status === "approved" && approvalCovers(a, req),',
    to: 'a.kind === kind && a.status === "approved",',
  },
  {
    id: "M-COVERS-CLASS",
    guard: "approvalCovers compares the approval's class with the class it must cover",
    file: AUTHORITY,
    from: "  return given >= 0 && given >= needed;",
    to: "  return given >= 0;",
  },
  {
    id: "M-COVERS-OUTBOUND-CAP",
    guard: "an outbound approval needs to cover the request only up to external_execution",
    file: AUTHORITY,
    from: '      ? Math.min(rank(ACTION_CLASSES, request.approvalLevel), rank(ACTION_CLASSES, "external_execution"))',
    to: "      ? rank(ACTION_CLASSES, request.approvalLevel)",
  },

  // RR119-P1-C: the deterministic floor reads the objective and the deliverable.
  {
    id: "M-FLOOR-OBJECTIVE",
    guard: "the floor reads the objective",
    file: AUTHORITY,
    from: "[input.title, input.objective, input.description, input.deliverable]",
    to: "[input.title, input.description, input.deliverable]",
  },
  {
    id: "M-FLOOR-DELIVERABLE",
    guard: "the floor reads the deliverable",
    file: AUTHORITY,
    from: "[input.title, input.objective, input.description, input.deliverable]",
    to: "[input.title, input.objective, input.description]",
  },
  {
    id: "M-MEM-CREATE-FIELDS",
    guard: "in-memory createRequest classifies the objective and deliverable",
    file: MEMORY,
    from: "const authority = resolveRequestRisk(input, risk);",
    to: 'const authority = resolveRequestRisk({ ...input, objective: "", deliverable: "" }, risk);',
  },
  {
    id: "M-SB-CREATE-FIELDS",
    guard: "Supabase createRequest classifies the objective and deliverable",
    file: SUPABASE,
    from: "const authority = resolveRequestRisk(input, risk);",
    to: 'const authority = resolveRequestRisk({ ...input, objective: "", deliverable: "" }, risk);',
  },
  {
    id: "M-SB-SCOPE-OBJECTIVE",
    guard: "a Supabase scope edit classifies the edited objective",
    file: SUPABASE,
    from: '      objective: text("objective"),\n',
    to: "",
  },
  {
    id: "M-SB-SCOPE-DELIVERABLE",
    guard: "a Supabase scope edit classifies the edited deliverable",
    file: SUPABASE,
    from: '      deliverable: text("deliverable"),\n',
    to: "",
  },

  // P2: each conditional-write predicate on its own.
  {
    id: "M-SB-CW-STATUS",
    guard: "a request write fails if the status changed since the gates ran",
    file: SUPABASE,
    from: '      .eq("status", req.status)\n      .eq("approval_level", req.approvalLevel)\n',
    to: '      .eq("approval_level", req.approvalLevel)\n',
  },
  {
    id: "M-SB-CW-CLASS",
    guard: "a request write fails if the action class changed since the gates ran",
    file: SUPABASE,
    from: '      .eq("status", req.status)\n      .eq("approval_level", req.approvalLevel)\n',
    to: '      .eq("status", req.status)\n',
  },
  {
    id: "M-SB-CW-NO-ROW",
    guard: "a request write that matched no row is an error, not a success",
    file: SUPABASE,
    from: '    if (!data) throw new DomainError("The request changed while this action ran; reload and try again");\n',
    to: "",
  },
  {
    id: "M-SB-DECIDE-PENDING",
    guard: "an approval write fails if the approval was decided since it was read",
    file: SUPABASE,
    from: '      .eq("status", "pending")\n      .eq("action_class", approval.action_class)\n',
    to: '      .eq("action_class", approval.action_class)\n',
  },
  {
    id: "M-SB-DECIDE-CLASS",
    guard: "an approval write fails if the approval's class changed since it was read",
    file: SUPABASE,
    from: '      .eq("status", "pending")\n      .eq("action_class", approval.action_class)\n',
    to: '      .eq("status", "pending")\n',
  },
  {
    id: "M-SB-DECIDE-NO-ROW",
    guard: "an approval write that matched no row is an error, not a success",
    file: SUPABASE,
    from: '    if (!data) throw new DomainError("Approval changed before it was decided; reload and decide again");\n',
    to: "",
  },

  // P2: QA currency.
  {
    id: "M-QA-CURRENCY",
    guard: "a QA pass counts only if recorded no earlier than the covering plan decision",
    file: AUTHORITY,
    from: "  return !planDecidedAt || review.createdAt >= planDecidedAt;",
    to: "  return true;",
  },
  {
    id: "M-MEM-QA-COVERING",
    guard: "in-memory QA currency is anchored on a covering plan decision only",
    file: MEMORY,
    from: 'a.status === "approved" && approvalCovers(a, req) && a.decidedAt)',
    to: 'a.status === "approved" && a.decidedAt)',
  },
  {
    id: "M-SB-QA-COVERING",
    guard: "Supabase QA currency is anchored on a covering plan decision only",
    file: SUPABASE,
    from: '.filter((a) => a.decided_at && approvalCovers({ kind: "execution_plan", actionClass: a.action_class as ActionClass }, req))',
    to: ".filter((a) => a.decided_at)",
  },
  {
    id: "M-MEM-QA-EARLIEST",
    guard: "in-memory: re-approving the plan at the same class does not void QA",
    file: MEMORY,
    from: "    const planDecidedAt = decided[0] ?? null;\n    return this.data.qaReviews",
    to: "    const planDecidedAt = decided.at(-1) ?? null;\n    return this.data.qaReviews",
  },
  {
    id: "M-SB-QA-EARLIEST",
    guard: "Supabase: re-approving the plan at the same class does not void QA",
    file: SUPABASE,
    from: "    const planDecidedAt = decided[0] ?? null;\n",
    to: "    const planDecidedAt = decided.at(-1) ?? null;\n",
  },
  {
    id: "M-MEM-QA-ON-DECISION",
    guard: "in-memory: an action approval moves work to ready_to_deliver only on a current QA pass",
    file: MEMORY,
    from: '} else if (req.status === "awaiting_action_approval" && this.hasCurrentPassedQa(req)) {',
    to: '} else if (req.status === "awaiting_action_approval" && this.data.qaReviews.some((q) => q.requestId === req.id && q.passed)) {',
  },
  {
    id: "M-SB-QA-ON-DECISION",
    guard: "Supabase: an action approval moves work to ready_to_deliver only on a current QA pass",
    file: SUPABASE,
    from: '      if (await this.hasCurrentPassedQa(db, req)) next = "ready_to_deliver";',
    to: '      if ((await db.from("qa_reviews").select("id").eq("request_id", req.id).eq("passed", true)).data?.length) next = "ready_to_deliver";',
  },

  // P2: the double-decision guard.
  {
    id: "M-MEM-DOUBLE-DECISION",
    guard: "in-memory: a decided approval cannot be decided again",
    file: MEMORY,
    from: '    if (approval.status !== "pending") throw new DomainError("Approval already decided");\n',
    to: "",
  },
  {
    id: "M-SB-DOUBLE-DECISION",
    guard: "Supabase: a decided approval cannot be decided again",
    file: SUPABASE,
    from: '    if (approval.status !== "pending") throw new DomainError("Approval already decided");\n',
    to: "",
  },

  // P2: approval kinds a model adds.
  {
    id: "M-MODEL-KINDS",
    guard: "a known approval kind a model adds is required",
    file: AUTHORITY,
    from: "const added = stringList(proposed.kinds).filter(",
    to: "const added = stringList(undefined).filter(",
  },
  {
    id: "M-MEM-MODEL-KINDS",
    guard: "in-memory createRequest requests the approval kinds a model adds",
    file: MEMORY,
    from: "const approvalNeeds = resolveApprovalRequirements(approvalInput, approvalRaw);",
    to: "const approvalNeeds = resolveApprovalRequirements(approvalInput, null);",
  },
  {
    id: "M-SB-MODEL-KINDS",
    guard: "Supabase createRequest requests the approval kinds a model adds",
    file: SUPABASE,
    from: "const approvalNeeds = resolveApprovalRequirements(approvalInput, approvalRaw);",
    to: "const approvalNeeds = resolveApprovalRequirements(approvalInput, null);",
  },

  // P2 fail-open fixes: a failed approvals or QA read refuses the gate.
  {
    id: "M-SB-FO-PLAN-READ",
    guard: "Supabase: a failed plan-approval read does not pass the plan gate",
    file: SUPABASE,
    from: '    // A failed read is not "no plan approvals": that would pass the gate.\n    if (error) dbFail(error);\n',
    to: "",
  },
  {
    id: "M-SB-FO-QA-PLAN-READ",
    guard: "Supabase: a failed plan-decision read does not make every QA pass current",
    file: SUPABASE,
    from: '    // A failed read is not "no plan decision": that would make every QA pass current.\n    if (plansError) dbFail(plansError);\n',
    to: "",
  },
  {
    id: "M-SB-FO-QA-REVIEWS-READ",
    guard: "Supabase: a failed QA read is reported as a failed read",
    file: SUPABASE,
    from: "    if (reviewsError) dbFail(reviewsError);\n",
    to: "",
  },
  {
    id: "M-SB-FO-COVERING-READ",
    guard: "Supabase: a failed approval read is reported, and requests no approval",
    file: SUPABASE,
    from: "      .eq(\"status\", \"approved\");\n    if (error) dbFail(error);\n    return (data ?? []).some(",
    to: "      .eq(\"status\", \"approved\");\n    return (data ?? []).some(",
  },

  // Gates the PR added and earlier rounds tested; kept here so a later change is measured too.
  {
    id: "M-MEM-QUEUE-GATE",
    guard: "in-memory: the queue is held until the plan is approved at the current class",
    file: MEMORY,
    from: '      if (held) throw new DomainError("Execution plan must be approved before the request enters the queue");\n',
    to: "",
  },
  {
    id: "M-SB-QUEUE-GATE",
    guard: "Supabase: the queue is held until the plan is approved at the current class",
    file: SUPABASE,
    from: '      if (held) throw new DomainError("Execution plan must be approved before the request enters the queue");\n',
    to: "",
  },
  {
    id: "M-MEM-START-PLAN",
    guard: "in-memory: work cannot start while the plan approval is outstanding",
    file: MEMORY,
    from: '    if (to === "in_progress" && this.planApprovalOutstanding(req)) {',
    to: "    if (false) {",
  },
  {
    id: "M-SB-START-PLAN",
    guard: "Supabase: work cannot start while the plan approval is outstanding",
    file: SUPABASE,
    from: '    if (to === "in_progress" && (await this.planApprovalOutstanding(db, req))) {',
    to: "    if (false) {",
  },
  {
    id: "M-MEM-DECIDE-STALE",
    guard: "in-memory: deciding an approval that no longer covers the request moves nothing",
    file: MEMORY,
    from: "      if (!approvalCovers(approval, req)) {",
    to: "      if (false) {",
  },
  {
    id: "M-SB-DECIDE-STALE",
    guard: "Supabase: deciding an approval that no longer covers the request moves nothing",
    file: SUPABASE,
    from: "    if (!approvalCovers({ kind: approval.kind as ApprovalKind, actionClass: approval.action_class as ActionClass }, req)) {",
    to: "    if (false) {",
  },
  {
    id: "M-MEM-DECIDE-PLAN-HOLD",
    guard: "in-memory: an action approval does not move a request past its outstanding plan approval",
    file: MEMORY,
    from: '      } else if (planOutstanding || req.status === "awaiting_plan_approval") {',
    to: "      } else if (false) {",
  },
  {
    id: "M-SB-DECIDE-PLAN-HOLD",
    guard: "Supabase: an action approval does not move a request past its outstanding plan approval",
    file: SUPABASE,
    from: '    } else if (planOutstanding || req.status === "awaiting_plan_approval") {',
    to: "    } else if (false) {",
  },
  {
    id: "M-MEM-DECIDE-RESUME-SENSITIVE",
    guard: "in-memory: an action approval does not resume sensitive work without a sensitive approval",
    file: MEMORY,
    from: "        if (!sensitiveHeld) req.status = resume;",
    to: "        req.status = resume;",
  },
  {
    id: "M-SB-DECIDE-RESUME-SENSITIVE",
    guard: "Supabase: an action approval does not resume sensitive work without a sensitive approval",
    file: SUPABASE,
    from: "        if (!sensitiveHeld) next = resume;",
    to: "        next = resume;",
  },
  {
    id: "M-MEM-STAMP-CLASS",
    guard: "in-memory: a requested approval is stamped no lower than the request's class",
    file: MEMORY,
    from: "      actionClass: approvalClassFor(actionClass, req),",
    to: "      actionClass,",
  },
  {
    id: "M-SB-STAMP-CLASS",
    guard: "Supabase: a requested approval is stamped no lower than the request's class",
    file: SUPABASE,
    from: "      actionClass: approvalClassFor(actionClass, req),",
    to: "      actionClass,",
  },
  {
    id: "CONTROL",
    guard: "a comment-only change fails nothing",
    file: AUTHORITY,
    from: "// Request authority (action class, risk level, approval requirements, and",
    to: "// Request authority (action class, risk level, approval requirements, and (control)",
    control: true,
  },
];

// `--only M-A,M-B` runs just those mutants and the control.
const onlyArg = process.argv.indexOf("--only");
const ONLY = onlyArg >= 0 ? new Set((process.argv[onlyArg + 1] ?? "").split(",").filter(Boolean)) : null;
if (ONLY) {
  const unknown = [...ONLY].filter((id) => !MUTANTS.some((mutant) => mutant.id === id));
  if (unknown.length > 0 || ONLY.size === 0) {
    console.error(`Unknown or missing mutant ids for --only: ${unknown.join(", ") || "(none given)"}`);
    process.exit(1);
  }
  for (let index = MUTANTS.length - 1; index >= 0; index -= 1) {
    if (!MUTANTS[index].control && !ONLY.has(MUTANTS[index].id)) MUTANTS.splice(index, 1);
  }
}

const FILES = [...new Set(MUTANTS.map((mutant) => mutant.file))];

const dirty = spawnSync("git", ["status", "--porcelain", "--", ...FILES], { encoding: "utf8" }).stdout.trim();
if (dirty) {
  console.error(`Refusing to start: these files have uncommitted changes, and a restore would discard them:\n${dirty}`);
  process.exit(1);
}

const originals = new Map(FILES.map((file) => [file, readFileSync(file, "utf8")]));
const restore = () => {
  for (const [file, text] of originals) writeFileSync(file, text);
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    restore();
    console.error(`\ninterrupted by ${signal}; ${FILES.join(", ")} restored`);
    process.exit(130);
  });
}
process.on("uncaughtException", (error) => {
  restore();
  console.error(`\nuncaught: ${error instanceof Error ? error.message : String(error)}; files restored`);
  process.exit(1);
});

const scratch = mkdtempSync(join(tmpdir(), "request-authority-mutation-"));

/** The full names of the tests that failed, or null when the report is missing. */
function failingTests() {
  return new Promise((done) => {
    const report = join(scratch, `report-${Math.random().toString(36).slice(2)}.json`);
    const child = spawn("npx", ["vitest", "run", ...SUITES, "--reporter=json", `--outputFile=${report}`], {
      stdio: "ignore",
      env: process.env,
    });
    child.on("close", () => {
      try {
        const parsed = JSON.parse(readFileSync(report, "utf8"));
        const failed = new Set();
        for (const file of parsed.testResults) {
          // A file that threw at import ran no assertions; count it as failed.
          if (file.status === "failed" && file.assertionResults.length === 0) failed.add(`${file.name}: failed to load`);
          for (const test of file.assertionResults) if (test.status === "failed") failed.add(test.fullName);
        }
        done(failed);
      } catch {
        done(null);
      }
    });
  });
}

const results = [];
try {
  const baseline = await failingTests();
  if (baseline === null) throw new Error(`no report from ${SUITES.join(", ")}`);
  console.log(`baseline: ${baseline.size} failing`);
  for (const mutant of MUTANTS) {
    const text = originals.get(mutant.file);
    const count = text.split(mutant.from).length - 1;
    if (count !== 1) {
      results.push({ ...mutant, verdict: "NOT APPLIED", detail: `the text to replace occurs ${count} times` });
      console.log(`${"NOT APPLIED".padEnd(14)} ${mutant.id}: the text to replace occurs ${count} times`);
      continue;
    }
    writeFileSync(mutant.file, text.replace(mutant.from, mutant.to));
    try {
      const failed = await failingTests();
      if (failed === null) {
        results.push({ ...mutant, verdict: "NO REPORT", detail: "vitest wrote no report" });
      } else {
        const newly = [...failed].filter((name) => !baseline.has(name));
        const verdict = mutant.control ? (newly.length === 0 ? "CONTROL OK" : "CONTROL FAILED") : newly.length > 0 ? "HELD" : "SURVIVED";
        results.push({ ...mutant, verdict, detail: newly.length ? `${newly.length} failed, e.g. ${newly[0]}` : "no test failed" });
      }
    } finally {
      writeFileSync(mutant.file, text);
    }
    const last = results[results.length - 1];
    console.log(`${last.verdict.padEnd(14)} ${mutant.id}: ${last.detail}`);
  }
} finally {
  restore();
  rmSync(scratch, { recursive: true, force: true });
}

const held = results.filter((result) => result.verdict === "HELD").length;
const mutants = results.filter((result) => !result.control).length;
const controlOk = results.some((result) => result.verdict === "CONTROL OK");
const missed = results.filter((result) => !result.control && result.verdict !== "HELD").map((result) => `${result.id} (${result.verdict})`);
console.log(`\n${held} of ${mutants} gates held; control ${controlOk ? "changed nothing" : "FAILED"}.`);
if (missed.length) console.log(`Not held: ${missed.join(", ")}`);
process.exit(held === mutants && controlOk ? 0 : 1);
