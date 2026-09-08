import { sha256Hex } from "../../catalog-evidence-hash.ts";
import { evaluateCase, agentEvalExitCode } from "../harness.ts";
import {
  AGENT_EVAL_POLICY_VERSION,
  AGENT_EVAL_REPORT_SCHEMA_VERSION,
  type AgentEvalCaseResult,
  type AgentEvalReport,
} from "../types.ts";
import { DEFAULT_EVALUATION_CLOCK } from "../clock.ts";
import { RUNTIME_SCENARIOS } from "./scenarios.ts";
import { assertSafeBlockedTrace, executeRuntimeScenario } from "./execute.ts";
import { toAgentEvalCase } from "./adapt.ts";
import type { RuntimeScenario } from "./types.ts";
import { RUNTIME_EVAL_POLICY_VERSION } from "./types.ts";

const MEASURES = [
  "runtime createExecutionContext + validateToolInvocation envelope enforcement",
  "runtime canAccessOrganization tenant probes",
  "runtime requiresExplicitApproval + missing approval detection",
  "runtime evidence expiry against injected evaluationClock",
  "runtime agent-trace emission + fail-closed redaction on blocked tools",
  "runtime invalid evaluationClock fail-closed rejection",
  "existing agent-eval graders applied to runtime-derived observed transcripts",
] as const;

const DOES_NOT_MEASURE = [
  "model quality or provider latency",
  "production database / Supabase / RLS live enforcement",
  "network adapters or external side effects",
  "Software Factory Run Manager persistence or owner acceptance UI",
  "full Gauntlet cycle autonomy decisions",
  "OpenTelemetry compatibility",
] as const;

const UNMEASURED = [
  "live provider TTFT/ITL",
  "production audit-log completeness",
  "Run Manager lease/heartbeat under concurrency",
  "customer-facing UI approval flows",
] as const;

function securityTags(scenario: RuntimeScenario): boolean {
  return scenario.tags.includes("adversarial") || scenario.tags.includes("security");
}

function clockGateResult(scenario: RuntimeScenario): AgentEvalCaseResult {
  const outcome = executeRuntimeScenario(scenario);
  const pass = outcome.clockRejected === true;
  return {
    caseId: scenario.caseId,
    pass,
    graderResults: [],
    failureReasons: pass
      ? []
      : ["Expected invalid evaluationClock to fail closed; clock was accepted."],
    policyVersion: RUNTIME_EVAL_POLICY_VERSION,
    fixtureHash: sha256Hex({
      scenario: scenario.caseId,
      kind: scenario.kind,
      clock: scenario.invalidClockInput,
    }),
    timingMs: outcome.timingMs,
    unknownMetrics: ["graders_not_run_clock_rejected_before_grading"],
  };
}

export type RunRuntimeAgentEvalOptions = {
  scenarios?: readonly RuntimeScenario[];
  generatedAt?: string;
  /** Default evaluation clock for scenarios that omit their own. */
  evaluationClock?: string;
};

/**
 * Run runtime-backed scenarios: execute real code paths, adapt to agent-eval-case/v1,
 * then grade with the existing deterministic graders.
 *
 * Suite is explicitly `runtime` (not `fixture`). Fixture results remain under
 * `npm run eval:agent` / harness.suite === "fixture".
 */
export function runRuntimeAgentEval(options: RunRuntimeAgentEvalOptions = {}): AgentEvalReport {
  const scenarios = options.scenarios ?? RUNTIME_SCENARIOS;
  const defaultClock = options.evaluationClock ?? DEFAULT_EVALUATION_CLOCK;
  const results: AgentEvalCaseResult[] = [];

  for (const scenario of scenarios) {
    if (scenario.kind === "invalid_evaluation_clock") {
      results.push(clockGateResult(scenario));
      continue;
    }

    const scenarioWithClock: RuntimeScenario = {
      ...scenario,
      evaluationClock: scenario.evaluationClock ?? defaultClock,
    };
    const outcome = executeRuntimeScenario(scenarioWithClock);
    const agentCase = toAgentEvalCase(scenarioWithClock, outcome);
    let caseResult = evaluateCase(agentCase, {
      evaluationClock: scenarioWithClock.evaluationClock,
    });
    caseResult = {
      ...caseResult,
      policyVersion: RUNTIME_EVAL_POLICY_VERSION,
    };

    if (scenario.kind === "blocked_tool_trace_redaction") {
      const safe = assertSafeBlockedTrace(outcome.traceEvents);
      if (!safe.ok) {
        caseResult = {
          ...caseResult,
          pass: false,
          failureReasons: [...caseResult.failureReasons, ...safe.reasons],
        };
      }
    }

    results.push(caseResult);
  }

  const failed = results.filter((result) => !result.pass);
  const securityCaseFailures = results.filter((result, index) => {
    return !result.pass && securityTags(scenarios[index]);
  }).length;

  return {
    schemaVersion: AGENT_EVAL_REPORT_SCHEMA_VERSION,
    policyVersion: AGENT_EVAL_POLICY_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    harness: {
      name: "agent-reliability-eval-runtime",
      suite: "runtime",
      measures: [...MEASURES],
      doesNotMeasure: [...DOES_NOT_MEASURE],
    },
    summary: {
      total: results.length,
      passed: results.length - failed.length,
      failed: failed.length,
      securityCaseFailures,
    },
    cases: results,
    unmeasured: [...UNMEASURED],
  };
}

export function runtimeAgentEvalExitCode(report: AgentEvalReport): number {
  return agentEvalExitCode(report);
}
