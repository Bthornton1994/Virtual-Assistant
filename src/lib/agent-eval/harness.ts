import { sha256Hex } from "../catalog-evidence-hash.ts";
import { runGraders } from "./graders.ts";
import { DEFAULT_AGENT_EVAL_CASES } from "./fixtures.ts";
import { DEFAULT_EVALUATION_CLOCK, requireEvaluationClock } from "./clock.ts";
import {
  AGENT_EVAL_POLICY_VERSION,
  AGENT_EVAL_REPORT_SCHEMA_VERSION,
  type AgentEvalCase,
  type AgentEvalCaseResult,
  type AgentEvalReport,
} from "./types.ts";
import {
  emitAgentTrace,
  emptyProviderMeta,
  emptyTraceMetrics,
  type AgentTraceEvent,
} from "../agent-trace/index.ts";

const MEASURES = [
  "authority compliance against declared action class and allow/deny lists",
  "tenant isolation using canAccessOrganization",
  "evidence provenance, expiry, injection markers, and required-evidence presence",
  "approval requirements for external/sensitive action classes",
  "lifecycle state and verification result alignment with fixture expectations",
  "acceptance-criteria satisfaction",
  "false-completion detection",
  "forbidden actions and economic envelope ceilings",
] as const;

const DOES_NOT_MEASURE = [
  "model quality, creativity, or helpfulness",
  "token efficiency or latency of live model providers",
  "retrieval or ranking quality",
  "production database RLS enforcement at runtime",
  "live network adapter behavior",
  "OpenTelemetry compatibility",
] as const;

const UNMEASURED = [
  "live provider TTFT/ITL",
  "production audit-log completeness",
  "human reviewer inter-rater agreement",
  "cross-workstream learning transfer",
] as const;

function fixtureHash(caseDef: AgentEvalCase): string {
  return sha256Hex(caseDef);
}

function securityTags(caseDef: AgentEvalCase): boolean {
  return caseDef.tags.includes("adversarial") || caseDef.tags.includes("security");
}

function emitCaseTrace(caseDef: AgentEvalCase, pass: boolean, evaluationClock: string): void {
  const event: AgentTraceEvent = {
    schemaVersion: "agent-trace/v1",
    traceId: `trace-${caseDef.caseId}`,
    eventId: `evt-${caseDef.caseId}-verification`,
    kind: "verification",
    runId: `run-${caseDef.caseId}`,
    stepId: "grade",
    organizationIdHash: sha256Hex(caseDef.organizationId).slice(0, 16),
    actorIdHash: caseDef.actor.idHash,
    actorRole: caseDef.actor.role,
    capability: "agent_reliability_eval",
    actionClass: caseDef.authority.actionClass,
    status: pass ? "ok" : "error",
    startedAt: evaluationClock,
    endedAt: evaluationClock,
    durationMs: caseDef.timingMs ?? null,
    errorCode: pass ? null : "eval_case_failed",
    policyDecision: pass ? "allow_fixture" : "reject_fixture_regression",
    approvalState: caseDef.observed.approvalStatus,
    evidenceHashes: caseDef.evidence.map((item) => item.contentHash),
    sourceHashes: [],
    providerMeta: emptyProviderMeta(),
    metrics: {
      ...emptyTraceMetrics(),
      latencyMs: caseDef.timingMs ?? null,
    },
    labels: {
      caseId: caseDef.caseId,
      harness: "agent-reliability-eval",
    },
  };
  emitAgentTrace(event);
}

export type EvaluateCaseOptions = {
  evaluationClock?: string;
};

export function evaluateCase(
  caseDef: AgentEvalCase,
  options: EvaluateCaseOptions = {},
): AgentEvalCaseResult {
  const { clock: evaluationClock } = requireEvaluationClock(options.evaluationClock);
  const graderResults = runGraders(caseDef, { evaluationClock });
  const failureReasons: string[] = [];

  for (const grader of graderResults) {
    if (!grader.matchedExpectation) {
      failureReasons.push(
        `${grader.graderId}: expected ${grader.expected}, got ${grader.verdict}` +
          (grader.reasons.length ? ` (${grader.reasons.join(" ")})` : ""),
      );
    }
  }

  const pass = failureReasons.length === 0;
  emitCaseTrace(caseDef, pass, evaluationClock);

  const unknownMetrics: string[] = [];
  if (caseDef.timingMs == null) unknownMetrics.push("timingMs");
  if (!caseDef.observed.economicTotals) unknownMetrics.push("economicTotals");

  return {
    caseId: caseDef.caseId,
    pass,
    graderResults,
    failureReasons,
    policyVersion: AGENT_EVAL_POLICY_VERSION,
    fixtureHash: fixtureHash(caseDef),
    timingMs: caseDef.timingMs ?? null,
    unknownMetrics,
  };
}

export type RunAgentEvalOptions = {
  cases?: readonly AgentEvalCase[];
  /**
   * Report timestamp. Defaults to the actual invocation time.
   * Tests may override only when asserting report shape — prefer leaving unset.
   */
  generatedAt?: string;
  /**
   * Clock for evidence expiry and other deterministic fixture checks.
   * Independent of generatedAt. Defaults to DEFAULT_EVALUATION_CLOCK.
   */
  evaluationClock?: string;
};

export function runAgentEval(options: RunAgentEvalOptions = {}): AgentEvalReport {
  const cases = options.cases ?? DEFAULT_AGENT_EVAL_CASES;
  const { clock: evaluationClock } = requireEvaluationClock(options.evaluationClock);
  const results = cases.map((caseDef) => evaluateCase(caseDef, { evaluationClock }));
  const failed = results.filter((result) => !result.pass);
  const securityCaseFailures = results.filter((result, index) => {
    const caseDef = cases[index];
    return !result.pass && securityTags(caseDef);
  }).length;

  return {
    schemaVersion: AGENT_EVAL_REPORT_SCHEMA_VERSION,
    policyVersion: AGENT_EVAL_POLICY_VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    harness: {
      name: "agent-reliability-eval",
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

/**
 * Exit code helper for CI: non-zero when any case fails, especially security fixtures.
 */
export function agentEvalExitCode(report: AgentEvalReport): number {
  if (report.summary.failed > 0) return 1;
  if (report.summary.securityCaseFailures > 0) return 1;
  return 0;
}

export { DEFAULT_EVALUATION_CLOCK };
