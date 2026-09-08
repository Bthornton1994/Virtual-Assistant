import { describe, expect, it } from "vitest";
import {
  AGENT_RELIABILITY_POLICY_VERSION,
  evaluateAgentReliabilityCase,
  reportExitCode,
  runAgentReliabilityEval,
  validateAgentReliabilityEvalCase,
} from "@/lib/agent-reliability-eval";
import {
  AGENT_RELIABILITY_FIXTURES,
  FIXTURE_AUTHORITY_ESCALATION,
  FIXTURE_CONTRADICTORY_EVIDENCE,
  FIXTURE_CROSS_TENANT,
  FIXTURE_ECONOMIC_OVERAGE,
  FIXTURE_FALSE_COMPLETION,
  FIXTURE_MISSING_REQUIRED_EVIDENCE,
  FIXTURE_MISSING_SENSITIVE_APPROVAL,
  FIXTURE_POSITIVE_PREPARE_ONLY,
  FIXTURE_PREPARE_ONLY_EXTERNAL,
  FIXTURE_PROMPT_INJECTION,
  FIXTURE_STALE_EVIDENCE,
  getAgentReliabilityFixtures,
} from "@/lib/agent-reliability-fixtures";
import { createInMemoryTraceSink } from "@/lib/agent-reliability-trace";

describe("agent reliability evaluation harness", () => {
  it("validates the positive control fixture", () => {
    const validated = validateAgentReliabilityEvalCase(FIXTURE_POSITIVE_PREPARE_ONLY);
    expect(validated.ok).toBe(true);
  });

  it("passes the authorized prepare-only positive control", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_POSITIVE_PREPARE_ONLY);
    expect(result.pass).toBe(true);
    expect(result.observedVerificationResult).toBe("pass");
    expect(result.graderResults.every((grader) => grader.pass)).toBe(true);
    expect(result.policyVersion).toBe(AGENT_RELIABILITY_POLICY_VERSION);
    expect(result.fixtureHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("detects cross-tenant access", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_CROSS_TENANT);
    expect(result.pass).toBe(true);
    expect(result.observedVerificationResult).toBe("fail");
    const tenant = result.graderResults.find((grader) => grader.graderId === "tenant_isolation");
    expect(tenant?.pass).toBe(false);
    expect(tenant?.reasons.some((reason) => /cross-tenant|belongs to organization/i.test(reason))).toBe(true);
  });

  it("detects stale evidence", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_STALE_EVIDENCE);
    expect(result.pass).toBe(true);
    expect(result.graderResults.find((grader) => grader.graderId === "evidence_provenance")?.pass).toBe(false);
  });

  it("treats prompt-injection evidence as tainted", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_PROMPT_INJECTION);
    expect(result.pass).toBe(true);
    const evidence = result.graderResults.find((grader) => grader.graderId === "evidence_provenance");
    expect(evidence?.pass).toBe(false);
    expect(evidence?.reasons.some((reason) => /prompt-injection/i.test(reason))).toBe(true);
  });

  it("blocks sensitive execution without approval", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_MISSING_SENSITIVE_APPROVAL);
    expect(result.pass).toBe(true);
    expect(result.graderResults.find((grader) => grader.graderId === "approval_compliance")?.pass).toBe(false);
  });

  it("detects authority escalation", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_AUTHORITY_ESCALATION);
    expect(result.pass).toBe(true);
    expect(result.graderResults.find((grader) => grader.graderId === "authority_compliance")?.pass).toBe(false);
    expect(result.graderResults.find((grader) => grader.graderId === "forbidden_unauthorized_actions")?.pass).toBe(
      false,
    );
  });

  it("detects false completion", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_FALSE_COMPLETION);
    expect(result.pass).toBe(true);
    expect(result.graderResults.find((grader) => grader.graderId === "false_completion")?.pass).toBe(false);
    expect(result.graderResults.find((grader) => grader.graderId === "acceptance_criteria")?.pass).toBe(false);
  });

  it("detects contradictory evidence", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_CONTRADICTORY_EVIDENCE);
    expect(result.pass).toBe(true);
    expect(result.graderResults.find((grader) => grader.graderId === "evidence_provenance")?.pass).toBe(false);
  });

  it("detects economic envelope overage", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_ECONOMIC_OVERAGE);
    expect(result.pass).toBe(true);
    const forbidden = result.graderResults.find((grader) => grader.graderId === "forbidden_unauthorized_actions");
    expect(forbidden?.pass).toBe(false);
    expect(forbidden?.reasons.some((reason) => /Economic\/resource limit exceeded/i.test(reason))).toBe(true);
  });

  it("detects missing required evidence", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_MISSING_REQUIRED_EVIDENCE);
    expect(result.pass).toBe(true);
    expect(result.graderResults.find((grader) => grader.graderId === "evidence_provenance")?.pass).toBe(false);
  });

  it("detects prepare-only external side effects", () => {
    const result = evaluateAgentReliabilityCase(FIXTURE_PREPARE_ONLY_EXTERNAL);
    expect(result.pass).toBe(true);
    expect(result.graderResults.find((grader) => grader.graderId === "forbidden_unauthorized_actions")?.pass).toBe(
      false,
    );
  });

  it("fails the case when an expected adversarial grader silently starts passing", () => {
    const mutated = {
      ...FIXTURE_CROSS_TENANT,
      expectedFailedGraders: ["tenant_isolation"] as const,
      request: {
        ...FIXTURE_CROSS_TENANT.request,
        actor: {
          id: "actor-fixed",
          role: "client_member" as const,
          organizationId: FIXTURE_CROSS_TENANT.request.organizationId,
        },
      },
      evidence: FIXTURE_POSITIVE_PREPARE_ONLY.evidence,
      // Still declare expectedVerificationResult fail, but all graders may pass → case fails.
      expectedVerificationResult: "fail" as const,
    };
    const result = evaluateAgentReliabilityCase(mutated);
    expect(result.observedVerificationResult).toBe("pass");
    expect(result.pass).toBe(false);
  });

  it("runs the full fixture catalog with a trace sink and exits 0", () => {
    const sink = createInMemoryTraceSink("eval-test");
    const report = runAgentReliabilityEval(getAgentReliabilityFixtures(), { sink });
    expect(report.totals.cases).toBe(AGENT_RELIABILITY_FIXTURES.length);
    expect(report.totals.failed).toBe(0);
    expect(report.totals.passed).toBe(AGENT_RELIABILITY_FIXTURES.length);
    expect(report.harness.externalModelCalls).toBe(false);
    expect(report.harness.networkCalls).toBe(false);
    expect(report.harness.productionDatabaseAccess).toBe(false);
    expect(report.unknownMetrics.length).toBeGreaterThan(0);
    expect(reportExitCode(report)).toBe(0);
    expect(sink.list().length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(report)).not.toMatch(/sk-|BEGIN PRIVATE KEY|chain-of-thought|password/i);
  });

  it("rejects malformed cases fail-closed", () => {
    const result = evaluateAgentReliabilityCase({ caseId: "broken", schemaVersion: "nope" });
    expect(result.pass).toBe(false);
    expect(result.failureReasons.length).toBeGreaterThan(0);
  });
});
