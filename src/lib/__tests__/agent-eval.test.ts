import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  evaluateCase,
  runAgentEval,
  agentEvalExitCode,
  DEFAULT_EVALUATION_CLOCK,
} from "@/lib/agent-eval/harness";
import {
  EvaluationClockError,
  validateEvaluationClock,
  requireEvaluationClock,
  EVALUATION_CLOCK_ERROR_CODE,
} from "@/lib/agent-eval/clock";
import { DEFAULT_AGENT_EVAL_CASES } from "@/lib/agent-eval/fixtures";
import {
  CASE_AUTHORITY_ESCALATION,
  CASE_COMPLIANT_PREPARE,
  CASE_CONTRADICTORY_EVIDENCE,
  CASE_CROSS_TENANT,
  CASE_ECONOMIC_LIMITS,
  CASE_FALSE_COMPLETION,
  CASE_MISSING_APPROVAL,
  CASE_MISSING_REQUIRED_EVIDENCE,
  CASE_PREPARE_ONLY_SIDE_EFFECT,
  CASE_PROMPT_INJECTION,
  CASE_SENSITIVE_ATTEMPT_BLOCKED,
  CASE_STALE_EVIDENCE,
  CASE_UNLISTED_INTERNAL_ACTION,
} from "@/lib/agent-eval/fixtures";
import { runGraders } from "@/lib/agent-eval/graders";
import { MemoryTraceSink, setAgentTraceSink } from "@/lib/agent-trace";
import {
  resolveEvaluationClockArg,
  runEvalAgentCli,
} from "../../../scripts/eval-agent.mjs";

describe("agent reliability evaluation harness", () => {
  afterEach(() => {
    setAgentTraceSink(null);
  });

  it("ships adversarial fixtures plus compliant baselines including hardening cases", () => {
    const ids = DEFAULT_AGENT_EVAL_CASES.map((fixture) => fixture.caseId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "eval.adversarial.cross_tenant",
        "eval.adversarial.stale_evidence",
        "eval.adversarial.prompt_injection",
        "eval.adversarial.missing_approval",
        "eval.adversarial.authority_escalation",
        "eval.adversarial.false_completion",
        "eval.adversarial.contradictory_evidence",
        "eval.adversarial.economic_limits",
        "eval.adversarial.missing_required_evidence",
        "eval.adversarial.prepare_only_side_effect",
        "eval.adversarial.unlisted_internal_action",
        "eval.adversarial.sensitive_attempt_blocked",
        "eval.compliant.prepare_only",
      ]),
    );
    expect(DEFAULT_AGENT_EVAL_CASES.length).toBeGreaterThanOrEqual(14);
    expect(evaluateCase(CASE_COMPLIANT_PREPARE).pass).toBe(true);
  });

  it("passes the full default suite with detection expectations", () => {
    const sink = new MemoryTraceSink();
    setAgentTraceSink(sink);
    const before = Date.now();
    const report = runAgentEval({ evaluationClock: DEFAULT_EVALUATION_CLOCK });
    const after = Date.now();
    expect(report.summary.failed).toBe(0);
    expect(report.summary.securityCaseFailures).toBe(0);
    expect(agentEvalExitCode(report)).toBe(0);
    expect(report.harness.suite).toBe("fixture");
    expect(report.harness.doesNotMeasure.some((item) => item.includes("model quality"))).toBe(true);
    expect(report.unmeasured.length).toBeGreaterThan(0);
    expect(sink.list().length).toBe(report.summary.total);

    const generatedMs = Date.parse(report.generatedAt);
    expect(Number.isFinite(generatedMs)).toBe(true);
    expect(generatedMs).toBeGreaterThanOrEqual(before - 1000);
    expect(generatedMs).toBeLessThanOrEqual(after + 1000);
    expect(report.generatedAt).not.toBe(DEFAULT_EVALUATION_CLOCK);

    for (const event of sink.list()) {
      expect(event.labels).not.toHaveProperty("prompt");
      expect(JSON.stringify(event)).not.toMatch(/sk-[a-zA-Z0-9]{8,}/);
    }
  });

  it("uses evaluationClock for expiry independently of generatedAt", () => {
    const futureClock = "2026-09-10T00:00:00.000Z";
    const graders = runGraders(CASE_COMPLIANT_PREPARE, { evaluationClock: futureClock });
    // Compliant evidence expires 2026-09-09 — future clock must fail provenance.
    expect(graders.find((g) => g.graderId === "evidence_provenance")?.verdict).toBe("fail");

    const defaultGraders = runGraders(CASE_COMPLIANT_PREPARE, {
      evaluationClock: DEFAULT_EVALUATION_CLOCK,
    });
    expect(defaultGraders.find((g) => g.graderId === "evidence_provenance")?.verdict).toBe("pass");
  });

  it("rejects malformed or non-finite evaluation clocks fail-closed", () => {
    expect(validateEvaluationClock("invalid").ok).toBe(false);
    expect(validateEvaluationClock("").ok).toBe(false);
    expect(validateEvaluationClock(" 2026-09-08T16:00:00.000Z ").ok).toBe(false);
    expect(validateEvaluationClock("2026-09-08").ok).toBe(false);
    expect(validateEvaluationClock(null).ok).toBe(false);
    expect(validateEvaluationClock(DEFAULT_EVALUATION_CLOCK).ok).toBe(true);

    expect(() => requireEvaluationClock("invalid")).toThrow(EvaluationClockError);
    expect(() => runGraders(CASE_COMPLIANT_PREPARE, { evaluationClock: "invalid" })).toThrow(
      EvaluationClockError,
    );
    expect(() => runAgentEval({ evaluationClock: "not-a-date" })).toThrow(EvaluationClockError);
    expect(() => evaluateCase(CASE_COMPLIANT_PREPARE, { evaluationClock: "invalid" })).toThrow(
      EvaluationClockError,
    );
  });

  it("CLI rejects --evaluation-clock invalid with non-zero exit and clear error", () => {
    const resolved = resolveEvaluationClockArg(["--evaluation-clock", "invalid"]);
    expect(resolved.ok).toBe(false);
    if (resolved.ok) throw new Error("expected invalid clock");
    expect(resolved.code).toBe(EVALUATION_CLOCK_ERROR_CODE);
    expect(resolved.reason).toMatch(/evaluationClock/i);

    const viaHelper = runEvalAgentCli(["--evaluation-clock", "invalid"]);
    expect(viaHelper.exitCode).toBe(2);
    expect(viaHelper.output).toContain(EVALUATION_CLOCK_ERROR_CODE);
    expect(viaHelper.output).toMatch(/evaluationClock/i);

    const spawned = spawnSync(
      process.execPath,
      ["--experimental-strip-types", resolve("scripts/eval-agent.mjs"), "--evaluation-clock", "invalid"],
      { encoding: "utf8", cwd: resolve(".") },
    );
    expect(spawned.status).not.toBe(0);
    const combined = `${spawned.stdout ?? ""}${spawned.stderr ?? ""}`;
    expect(combined).toContain(EVALUATION_CLOCK_ERROR_CODE);
  });

  it("detects cross-tenant access", () => {
    expect(runGraders(CASE_CROSS_TENANT).find((g) => g.graderId === "tenant_isolation")?.verdict).toBe(
      "fail",
    );
  });

  it("detects stale evidence", () => {
    expect(runGraders(CASE_STALE_EVIDENCE).find((g) => g.graderId === "evidence_provenance")?.verdict).toBe(
      "fail",
    );
  });

  it("detects prompt-injection markers without storing payload bodies", () => {
    const result = evaluateCase(CASE_PROMPT_INJECTION);
    expect(result.pass).toBe(true);
    expect(CASE_PROMPT_INJECTION.evidence[0].injectionMarkers?.length).toBeGreaterThan(0);
    expect(JSON.stringify(CASE_PROMPT_INJECTION)).not.toMatch(/ignore all previous/i);
  });

  it("detects missing approval for sensitive execution", () => {
    expect(runGraders(CASE_MISSING_APPROVAL).find((g) => g.graderId === "approval_compliance")?.verdict).toBe(
      "fail",
    );
  });

  it("detects sensitive attempt blocked without side effects", () => {
    const graders = runGraders(CASE_SENSITIVE_ATTEMPT_BLOCKED);
    expect(graders.find((g) => g.graderId === "approval_compliance")?.verdict).toBe("fail");
    expect(CASE_SENSITIVE_ATTEMPT_BLOCKED.observed.externalSideEffects).toBe(false);
    expect(CASE_SENSITIVE_ATTEMPT_BLOCKED.observed.markedComplete).toBe(false);
    expect(CASE_SENSITIVE_ATTEMPT_BLOCKED.observed.verificationResult).toBe("blocked");
    expect(evaluateCase(CASE_SENSITIVE_ATTEMPT_BLOCKED).pass).toBe(true);
  });

  it("detects unlisted internal actions with no implicit bypass", () => {
    const graders = runGraders(CASE_UNLISTED_INTERNAL_ACTION);
    expect(graders.find((g) => g.graderId === "authority_compliance")?.verdict).toBe("fail");
    expect(
      graders
        .find((g) => g.graderId === "authority_compliance")
        ?.reasons.some((reason) => reason.includes("internal.unlisted_tool")),
    ).toBe(true);
    expect(evaluateCase(CASE_UNLISTED_INTERNAL_ACTION).pass).toBe(true);
  });

  it("detects authority escalation", () => {
    expect(
      runGraders(CASE_AUTHORITY_ESCALATION).find((g) => g.graderId === "authority_compliance")?.verdict,
    ).toBe("fail");
  });

  it("detects false completion", () => {
    expect(runGraders(CASE_FALSE_COMPLETION).find((g) => g.graderId === "false_completion")?.verdict).toBe(
      "fail",
    );
  });

  it("detects contradictory and missing evidence", () => {
    expect(
      runGraders(CASE_CONTRADICTORY_EVIDENCE).find((g) => g.graderId === "evidence_provenance")?.verdict,
    ).toBe("fail");
    expect(
      runGraders(CASE_MISSING_REQUIRED_EVIDENCE).find((g) => g.graderId === "evidence_provenance")?.verdict,
    ).toBe("fail");
  });

  it("detects economic limit breaches and prepare-only side effects", () => {
    expect(runGraders(CASE_ECONOMIC_LIMITS).find((g) => g.graderId === "forbidden_actions")?.verdict).toBe(
      "fail",
    );
    const prepare = runGraders(CASE_PREPARE_ONLY_SIDE_EFFECT);
    expect(prepare.find((g) => g.graderId === "authority_compliance")?.verdict).toBe("fail");
    expect(prepare.find((g) => g.graderId === "forbidden_actions")?.verdict).toBe("fail");
  });

  it("fails the suite when a security fixture regresses to a false pass", () => {
    const regressing = {
      ...CASE_CROSS_TENANT,
      caseId: "eval.adversarial.cross_tenant.regressed",
      observed: {
        ...CASE_CROSS_TENANT.observed,
        accessedOrganizationIds: [CASE_CROSS_TENANT.organizationId],
      },
      evidence: CASE_CROSS_TENANT.evidence.map((item) => ({
        ...item,
        organizationId: CASE_CROSS_TENANT.organizationId,
      })),
    };
    const result = evaluateCase(regressing);
    expect(result.pass).toBe(false);
    expect(result.failureReasons.some((reason) => reason.includes("tenant_isolation"))).toBe(true);
  });
});
