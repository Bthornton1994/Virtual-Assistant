/**
 * Runtime-backed agent evaluation contracts.
 * Scenarios carry synthetic inputs only — observed fields are derived from real code paths.
 */

import type { ActionClass, Role } from "../../domain.ts";
import type {
  AgentEvalApprovalExpectation,
  AgentEvalCase,
  AgentEvalEvidenceItem,
  AgentEvalGraderId,
  AgentEvalGraderVerdict,
} from "../types.ts";
import type { EvaluationClockValidation } from "../clock.ts";
import type { AgentTraceEvent } from "../../agent-trace/types.ts";
import type {
  AssignmentSnapshot,
  DelegationSpecSnapshot,
  ExecutionContext,
  ToolInvocation,
} from "../../execution-context.ts";
import type { ExecutionContextValidationResult } from "../../execution-context.ts";

export const RUNTIME_EVAL_POLICY_VERSION = "agent-reliability-eval-runtime/v1" as const;

export type RuntimeScenarioKind =
  | "prepare_only_success"
  | "unlisted_action_rejected"
  | "sensitive_without_approval_blocked"
  | "cross_tenant_rejected"
  | "stale_evidence_rejected"
  | "blocked_tool_trace_redaction"
  | "invalid_evaluation_clock";

export type RuntimeScenario = {
  kind: RuntimeScenarioKind;
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
  expectedLifecycleState: string;
  expectedApproval: AgentEvalApprovalExpectation;
  expectedVerification: AgentEvalCase["expectedVerification"];
  expectedGraderResults: Partial<Record<AgentEvalGraderId, AgentEvalGraderVerdict>>;
  /** Synthetic inputs — never pre-baked observed verdicts. */
  delegationSpec?: DelegationSpecSnapshot;
  assignment?: AssignmentSnapshot;
  /** Tool invocation fields excluding contextHash (bound at execute time). */
  toolAttempt?: {
    toolClass: ToolInvocation["toolClass"];
    toolKey: string;
    status: ToolInvocation["status"];
    failureCode: string | null;
    invokedAt: string;
    completedAt: string | null;
  };
  evidenceInputs?: Array<Omit<AgentEvalEvidenceItem, "flags"> & { flags?: AgentEvalEvidenceItem["flags"] }>;
  /** Orgs the scenario attempts to access (including foreign). */
  attemptedOrganizationIds?: string[];
  /** Clock used for this scenario's expiry checks. */
  evaluationClock?: string;
  /** For invalid_evaluation_clock: deliberately bad input. */
  invalidClockInput?: unknown;
  /** Approval decision supplied to the scenario (never invented as approved without input). */
  suppliedApprovalStatus?: AgentEvalApprovalExpectation["status"];
};

export type OrgAccessProbe = {
  organizationId: string;
  allowed: boolean;
};

export type RuntimeOutcome = {
  kind: RuntimeScenarioKind;
  contextResult: ExecutionContextValidationResult<ExecutionContext> | null;
  invocationResult: ExecutionContextValidationResult<ToolInvocation> | null;
  orgAccess: OrgAccessProbe[];
  clockValidation: EvaluationClockValidation | null;
  /** True when requireEvaluationClock / validate threw or returned ok:false as expected fail-closed. */
  clockRejected: boolean;
  evidence: AgentEvalEvidenceItem[];
  traceEvents: AgentTraceEvent[];
  /** Derived exclusively from runtime returns. */
  actionsTaken: string[];
  verificationResult: AgentEvalCase["expectedVerification"];
  approvalStatus: AgentEvalApprovalExpectation["status"];
  externalSideEffects: boolean;
  effectiveActionClass?: ActionClass;
  lifecycleState: string;
  markedComplete: boolean;
  acceptanceCriteriaMet: Record<string, boolean>;
  accessedOrganizationIds: string[];
  timingMs: number;
};
