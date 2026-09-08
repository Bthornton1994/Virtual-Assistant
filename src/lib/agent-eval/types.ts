/**
 * Agent evaluation harness contracts (agent-eval-case/v1, agent-eval-report/v1).
 *
 * Deterministic, fixture-driven. Does not call models, networks, or production DBs.
 * Measures policy/authority/evidence/approval/lifecycle compliance — not model quality.
 */

import type { ActionClass, Role } from "../domain.ts";
import type { EconomicTotals } from "../economic-envelope.ts";

export const AGENT_EVAL_CASE_SCHEMA_VERSION = "agent-eval-case/v1" as const;
export const AGENT_EVAL_REPORT_SCHEMA_VERSION = "agent-eval-report/v1" as const;
export const AGENT_EVAL_POLICY_VERSION = "agent-reliability-eval/v1" as const;

export const AGENT_EVAL_GRADER_IDS = [
  "authority_compliance",
  "tenant_isolation",
  "evidence_provenance",
  "approval_compliance",
  "lifecycle_correctness",
  "acceptance_criteria",
  "false_completion",
  "forbidden_actions",
] as const;

export type AgentEvalGraderId = (typeof AGENT_EVAL_GRADER_IDS)[number];

export type AgentEvalGraderVerdict = "pass" | "fail" | "unknown";

export type AgentEvalEvidenceItem = {
  id: string;
  kind: string;
  contentHash: string;
  organizationId: string;
  observedAt: string;
  /** ISO expiry; null/undefined means no expiry declared. */
  expiresAt?: string | null;
  provenanceValid: boolean;
  required: boolean;
  flags?: Array<
    "prompt_injection" | "contradictory" | "malformed" | "stale" | "missing_required" | "expired"
  >;
  /** Detected injection marker labels only — never the injected payload body. */
  injectionMarkers?: string[];
};

export type AgentEvalApprovalExpectation = {
  required: boolean;
  status: "not_required" | "pending" | "approved" | "rejected" | "missing";
};

export type AgentEvalObserved = {
  lifecycleState: string;
  actionsTaken: string[];
  approvalStatus: AgentEvalApprovalExpectation["status"];
  verificationResult: "passed" | "failed" | "blocked";
  markedComplete: boolean;
  acceptanceCriteriaMet: Record<string, boolean>;
  accessedOrganizationIds: string[];
  economicTotals?: EconomicTotals;
  economicEnvelope?: Record<string, unknown>;
  /** True when an external side effect was attempted or performed. */
  externalSideEffects: boolean;
  /** Observed action class after any escalation attempt. */
  effectiveActionClass?: ActionClass;
};

export type AgentEvalCase = {
  schemaVersion: typeof AGENT_EVAL_CASE_SCHEMA_VERSION;
  caseId: string;
  title: string;
  tags: string[];
  organizationId: string;
  actor: {
    idHash: string;
    role: Role;
    organizationId: string | null;
  };
  outcome: {
    summary: string;
    acceptanceCriteria: string[];
  };
  authority: {
    actionClass: ActionClass;
    allowedActions: string[];
    forbiddenActions: string[];
  };
  evidence: AgentEvalEvidenceItem[];
  expectedLifecycleState: string;
  expectedApproval: AgentEvalApprovalExpectation;
  expectedVerification: "passed" | "failed" | "blocked";
  observed: AgentEvalObserved;
  /**
   * Expected grader outcomes for this fixture.
   * Adversarial cases expect specific graders to fail (detection).
   * Compliant cases expect graders to pass.
   */
  expectedGraderResults: Partial<Record<AgentEvalGraderId, AgentEvalGraderVerdict>>;
  /** Wall-clock fixture timing when supplied; otherwise null in the report. */
  timingMs?: number | null;
};

export type AgentEvalGraderResult = {
  graderId: AgentEvalGraderId;
  verdict: AgentEvalGraderVerdict;
  reasons: string[];
  expected: AgentEvalGraderVerdict | "unspecified";
  matchedExpectation: boolean;
};

export type AgentEvalCaseResult = {
  caseId: string;
  pass: boolean;
  graderResults: AgentEvalGraderResult[];
  failureReasons: string[];
  policyVersion: string;
  fixtureHash: string;
  timingMs: number | null;
  unknownMetrics: string[];
};

export type AgentEvalReport = {
  schemaVersion: typeof AGENT_EVAL_REPORT_SCHEMA_VERSION;
  policyVersion: typeof AGENT_EVAL_POLICY_VERSION;
  generatedAt: string;
  harness: {
    name: "agent-reliability-eval" | "agent-reliability-eval-runtime";
    /** Separates fixture-only grading from runtime-backed synthetic evaluation. */
    suite: "fixture" | "runtime";
    measures: string[];
    doesNotMeasure: string[];
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    securityCaseFailures: number;
  };
  cases: AgentEvalCaseResult[];
  /** Explicit unknowns — never invent measurements. */
  unmeasured: string[];
};
