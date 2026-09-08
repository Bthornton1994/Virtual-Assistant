import { afterEach, describe, expect, it } from "vitest";
import { evaluateCase, runAgentEval, agentEvalExitCode } from "@/lib/agent-eval/harness";
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
  CASE_STALE_EVIDENCE,
} from "@/lib/agent-eval/fixtures";
import { runGraders } from "@/lib/agent-eval/graders";
import { MemoryTraceSink, setAgentTraceSink } from "@/lib/agent-trace";

describe("agent reliability evaluation harness", () => {
  afterEach(() => {
    setAgentTraceSink(null);
  });

  it("ships the ten required adversarial fixtures plus compliant baselines", () => {
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
        "eval.compliant.prepare_only",
      ]),
    );
    expect(DEFAULT_AGENT_EVAL_CASES.length).toBeGreaterThanOrEqual(12);
    expect(evaluateCase(CASE_COMPLIANT_PREPARE).pass).toBe(true);
  });

  it("passes the full default suite with detection expectations", () => {
    const sink = new MemoryTraceSink();
    setAgentTraceSink(sink);
    const report = runAgentEval({ generatedAt: "2026-09-08T16:00:00.000Z" });
    expect(report.summary.failed).toBe(0);
    expect(report.summary.securityCaseFailures).toBe(0);
    expect(agentEvalExitCode(report)).toBe(0);
    expect(report.harness.doesNotMeasure.some((item) => item.includes("model quality"))).toBe(true);
    expect(report.unmeasured.length).toBeGreaterThan(0);
    expect(sink.list().length).toBe(report.summary.total);
    for (const event of sink.list()) {
      expect(event.labels).not.toHaveProperty("prompt");
      expect(JSON.stringify(event)).not.toMatch(/sk-[a-zA-Z0-9]{8,}/);
    }
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
