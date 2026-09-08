import { afterEach, describe, expect, it } from "vitest";
import { setAgentTraceSink } from "@/lib/agent-trace";
import {
  runRuntimeAgentEval,
  runtimeAgentEvalExitCode,
  executeRuntimeScenario,
  toAgentEvalCase,
  RUNTIME_SCENARIOS,
  assertSafeBlockedTrace,
} from "@/lib/agent-eval/runtime";
import { evaluateCase } from "@/lib/agent-eval/harness";
import { runEvalAgentRuntimeCli } from "../../../scripts/eval-agent-runtime.mjs";

describe("runtime-backed agent evaluation", () => {
  afterEach(() => {
    setAgentTraceSink(null);
  });

  it("covers the required runtime scenarios", () => {
    const kinds = RUNTIME_SCENARIOS.map((scenario) => scenario.kind);
    expect(kinds).toEqual([
      "prepare_only_success",
      "unlisted_action_rejected",
      "sensitive_without_approval_blocked",
      "cross_tenant_rejected",
      "stale_evidence_rejected",
      "blocked_tool_trace_redaction",
      "invalid_evaluation_clock",
    ]);
  });

  it("passes the full runtime suite with suite=runtime separation", () => {
    const before = Date.now();
    const report = runRuntimeAgentEval();
    const after = Date.now();
    expect(report.harness.suite).toBe("runtime");
    expect(report.harness.name).toBe("agent-reliability-eval-runtime");
    expect(report.summary.failed).toBe(0);
    expect(report.summary.total).toBe(7);
    expect(runtimeAgentEvalExitCode(report)).toBe(0);
    const generatedMs = Date.parse(report.generatedAt);
    expect(generatedMs).toBeGreaterThanOrEqual(before - 1000);
    expect(generatedMs).toBeLessThanOrEqual(after + 1000);
  });

  it("derives prepare-only success from createExecutionContext + validateToolInvocation", () => {
    const scenario = RUNTIME_SCENARIOS.find((item) => item.kind === "prepare_only_success");
    expect(scenario).toBeTruthy();
    if (!scenario) return;
    const outcome = executeRuntimeScenario(scenario);
    expect(outcome.contextResult?.ok).toBe(true);
    expect(outcome.invocationResult?.ok).toBe(true);
    expect(outcome.verificationResult).toBe("passed");
    const agentCase = toAgentEvalCase(scenario, outcome);
    expect(evaluateCase(agentCase, { evaluationClock: scenario.evaluationClock }).pass).toBe(true);
  });

  it("rejects unlisted actions via real validateToolInvocation failures", () => {
    const scenario = RUNTIME_SCENARIOS.find((item) => item.kind === "unlisted_action_rejected");
    expect(scenario).toBeTruthy();
    if (!scenario) return;
    const outcome = executeRuntimeScenario(scenario);
    expect(outcome.invocationResult?.ok).toBe(false);
    expect(outcome.actionsTaken).toContain("external_message_draft");
    expect(toAgentEvalCase(scenario, outcome).observed.verificationResult).toBe("blocked");
  });

  it("blocks sensitive actions without approval using requiresExplicitApproval", () => {
    const scenario = RUNTIME_SCENARIOS.find((item) => item.kind === "sensitive_without_approval_blocked");
    expect(scenario).toBeTruthy();
    if (!scenario) return;
    const outcome = executeRuntimeScenario(scenario);
    expect(outcome.approvalStatus).toBe("missing");
    expect(outcome.actionsTaken).toContain("sensitive_action");
    expect(outcome.externalSideEffects).toBe(false);
    expect(outcome.verificationResult).toBe("blocked");
  });

  it("rejects cross-tenant access via canAccessOrganization", () => {
    const scenario = RUNTIME_SCENARIOS.find((item) => item.kind === "cross_tenant_rejected");
    expect(scenario).toBeTruthy();
    if (!scenario) return;
    const outcome = executeRuntimeScenario(scenario);
    expect(outcome.orgAccess.some((probe) => !probe.allowed)).toBe(true);
    expect(outcome.accessedOrganizationIds.length).toBeGreaterThan(1);
  });

  it("rejects stale evidence using injected evaluationClock", () => {
    const scenario = RUNTIME_SCENARIOS.find((item) => item.kind === "stale_evidence_rejected");
    expect(scenario).toBeTruthy();
    if (!scenario) return;
    const outcome = executeRuntimeScenario(scenario);
    expect(outcome.evidence[0]?.flags).toEqual(expect.arrayContaining(["stale", "expired"]));
    expect(outcome.verificationResult).toBe("failed");
  });

  it("emits only safe redacted traces for blocked tool invocations", () => {
    const scenario = RUNTIME_SCENARIOS.find((item) => item.kind === "blocked_tool_trace_redaction");
    expect(scenario).toBeTruthy();
    if (!scenario) return;
    const outcome = executeRuntimeScenario(scenario);
    expect(outcome.invocationResult?.ok).toBe(false);
    expect(outcome.traceEvents.length).toBeGreaterThan(0);
    expect(assertSafeBlockedTrace(outcome.traceEvents).ok).toBe(true);
    expect(JSON.stringify(outcome.traceEvents)).not.toMatch(/sk-[a-zA-Z0-9]{8,}/);
  });

  it("fails closed on invalid evaluationClock without grading", () => {
    const scenario = RUNTIME_SCENARIOS.find((item) => item.kind === "invalid_evaluation_clock");
    expect(scenario).toBeTruthy();
    if (!scenario) return;
    const outcome = executeRuntimeScenario(scenario);
    expect(outcome.clockRejected).toBe(true);
    expect(outcome.clockValidation?.ok).toBe(false);
  });

  it("CLI reports runtime suite and rejects invalid clocks", () => {
    const ok = runEvalAgentRuntimeCli([]);
    expect(ok.exitCode).toBe(0);
    expect(ok.output).toContain("suite separation: runtime");
    expect(ok.output).toContain("runtime.prepare_only.success");

    const bad = runEvalAgentRuntimeCli(["--evaluation-clock", "invalid"]);
    expect(bad.exitCode).toBe(2);
    expect(bad.output).toContain("INVALID_EVALUATION_CLOCK");
  });
});
