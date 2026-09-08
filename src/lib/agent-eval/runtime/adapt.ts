import { AGENT_EVAL_CASE_SCHEMA_VERSION, type AgentEvalCase } from "../types.ts";
import type { RuntimeOutcome, RuntimeScenario } from "./types.ts";

/**
 * Map a runtime scenario + derived outcome into agent-eval-case/v1.
 * Does not invent observed policy verdicts — copies fields from RuntimeOutcome only.
 */
export function toAgentEvalCase(scenario: RuntimeScenario, outcome: RuntimeOutcome): AgentEvalCase {
  return {
    schemaVersion: AGENT_EVAL_CASE_SCHEMA_VERSION,
    caseId: scenario.caseId,
    title: scenario.title,
    tags: [...scenario.tags],
    organizationId: scenario.organizationId,
    actor: { ...scenario.actor },
    outcome: {
      summary: scenario.outcome.summary,
      acceptanceCriteria: [...scenario.outcome.acceptanceCriteria],
    },
    authority: {
      actionClass: scenario.authority.actionClass,
      allowedActions: [...scenario.authority.allowedActions],
      forbiddenActions: [...scenario.authority.forbiddenActions],
    },
    evidence: outcome.evidence.map((item) => ({ ...item, flags: item.flags ? [...item.flags] : undefined })),
    expectedLifecycleState: scenario.expectedLifecycleState,
    expectedApproval: { ...scenario.expectedApproval },
    expectedVerification: scenario.expectedVerification,
    observed: {
      lifecycleState: outcome.lifecycleState,
      actionsTaken: [...outcome.actionsTaken],
      approvalStatus: outcome.approvalStatus,
      verificationResult: outcome.verificationResult,
      markedComplete: outcome.markedComplete,
      acceptanceCriteriaMet: { ...outcome.acceptanceCriteriaMet },
      accessedOrganizationIds: [...outcome.accessedOrganizationIds],
      externalSideEffects: outcome.externalSideEffects,
      effectiveActionClass: outcome.effectiveActionClass,
    },
    expectedGraderResults: { ...scenario.expectedGraderResults },
    timingMs: outcome.timingMs,
  };
}
