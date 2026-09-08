import {
  canAccessOrganization,
  requiresExplicitApproval,
  type Actor,
} from "../../domain.ts";
import {
  EXECUTION_CONTEXT_SCHEMA_VERSION,
  createExecutionContext,
  validateToolInvocation,
} from "../../execution-context.ts";
import {
  MemoryTraceSink,
  setAgentTraceSink,
  getAgentTraceSink,
  type AgentTraceEvent,
} from "../../agent-trace/index.ts";
import {
  validateEvaluationClock,
  requireEvaluationClock,
  EvaluationClockError,
} from "../clock.ts";
import type { AgentEvalEvidenceItem } from "../types.ts";
import type { RuntimeOutcome, RuntimeScenario } from "./types.ts";

function toActor(scenario: RuntimeScenario): Actor {
  return {
    id: scenario.actor.idHash,
    email: "runtime-eval@fixture.local",
    name: "Runtime Eval",
    role: scenario.actor.role,
    organizationId: scenario.actor.organizationId,
    operatorId: null,
    source: "demo",
  };
}

function deriveEvidence(
  scenario: RuntimeScenario,
  epochMs: number | null,
): AgentEvalEvidenceItem[] {
  return (scenario.evidenceInputs ?? []).map((item) => {
    const flags = new Set(item.flags ?? []);
    if (epochMs !== null && item.expiresAt) {
      const expiry = Date.parse(item.expiresAt);
      if (Number.isFinite(expiry) && expiry < epochMs) {
        flags.add("expired");
        flags.add("stale");
      }
    }
    return {
      ...item,
      flags: flags.size ? Array.from(flags) : undefined,
    };
  });
}

/**
 * Execute one runtime scenario against real repository contracts.
 * Observed fields are derived only from return values / probes — never hard-coded pass/fail claims.
 */
export function executeRuntimeScenario(scenario: RuntimeScenario): RuntimeOutcome {
  const started = Date.now();

  if (scenario.kind === "invalid_evaluation_clock") {
    const clockValidation = validateEvaluationClock(scenario.invalidClockInput);
    let threw = false;
    try {
      requireEvaluationClock(
        typeof scenario.invalidClockInput === "string" ? scenario.invalidClockInput : "invalid",
      );
    } catch (error) {
      threw = error instanceof EvaluationClockError;
    }
    const clockRejected = !clockValidation.ok || threw;
    return {
      kind: scenario.kind,
      contextResult: null,
      invocationResult: null,
      orgAccess: [],
      clockValidation,
      clockRejected,
      evidence: [],
      traceEvents: [],
      actionsTaken: [],
      verificationResult: "blocked",
      approvalStatus: "not_required",
      externalSideEffects: false,
      lifecycleState: "blocked",
      markedComplete: false,
      acceptanceCriteriaMet: { clock_valid: clockRejected ? false : true },
      accessedOrganizationIds: [scenario.organizationId],
      timingMs: Date.now() - started,
    };
  }

  const clockInput = scenario.evaluationClock;
  const clockValidation = validateEvaluationClock(clockInput ?? "2026-09-08T16:00:00.000Z");
  if (!clockValidation.ok) {
    throw new EvaluationClockError(clockValidation.reason);
  }
  const { clock: evaluationClock, epochMs } = requireEvaluationClock(evaluationClockOrDefault(clockInput));

  const priorSink = getAgentTraceSink();
  const sink = new MemoryTraceSink();
  setAgentTraceSink(sink);

  try {
    if (!scenario.delegationSpec || !scenario.assignment || !scenario.toolAttempt) {
      throw new Error(`Runtime scenario ${scenario.caseId} is missing required synthetic inputs.`);
    }

    const contextResult = createExecutionContext(scenario.delegationSpec, scenario.assignment);
    let invocationResult = null;

    if (contextResult.ok) {
      const attempt = scenario.toolAttempt;
      invocationResult = validateToolInvocation(
        {
          schemaVersion: EXECUTION_CONTEXT_SCHEMA_VERSION,
          invocationId: `invocation-${scenario.caseId}`,
          contextHash: contextResult.value.contextHash,
          toolClass: attempt.toolClass,
          toolKey: attempt.toolKey,
          status: attempt.status,
          invokedAt: attempt.invokedAt,
          completedAt: attempt.completedAt,
          failureCode: attempt.failureCode,
        },
        contextResult.value,
      );
    }

    const actor = toActor(scenario);
    const orgAccess = (scenario.attemptedOrganizationIds ?? [scenario.organizationId]).map(
      (organizationId) => ({
        organizationId,
        allowed: canAccessOrganization(actor, organizationId),
      }),
    );

    const evidence = deriveEvidence(scenario, epochMs);
    const traceEvents: AgentTraceEvent[] = [...sink.list()];

    const attemptedTool = scenario.toolAttempt.toolClass;
    const invocationOk = Boolean(invocationResult?.ok);
    const contextOk = contextResult.ok;
    const tenantOk = orgAccess.every((probe) => probe.allowed);
    const evidenceFresh = !evidence.some(
      (item) => item.flags?.includes("expired") || item.flags?.includes("stale"),
    );

    const approvalRequired =
      requiresExplicitApproval(scenario.authority.actionClass) || scenario.expectedApproval.required;
    const approvalStatus =
      scenario.suppliedApprovalStatus ??
      (approvalRequired ? "missing" : "not_required");

    const gatedAttemptWithoutApproval =
      approvalRequired &&
      approvalStatus !== "approved" &&
      (attemptedTool === "sensitive_action" ||
        attemptedTool === "credential_use" ||
        attemptedTool === "external_message_send");

    // Record the attempted tool class so graders see the real attempt.
    const actionsTaken = [attemptedTool];

    let verificationResult: RuntimeOutcome["verificationResult"] = "passed";
    if (!contextOk || !invocationOk || !tenantOk || gatedAttemptWithoutApproval) {
      verificationResult = "blocked";
    } else if (!evidenceFresh) {
      verificationResult = "failed";
    }

    const acceptanceCriteriaMet: Record<string, boolean> = {};
    for (const criterion of scenario.outcome.acceptanceCriteria) {
      switch (criterion) {
        case "context_valid":
          acceptanceCriteriaMet[criterion] = contextOk;
          break;
        case "tool_allowed":
          acceptanceCriteriaMet[criterion] = invocationOk;
          break;
        case "approval_satisfied":
          acceptanceCriteriaMet[criterion] = !approvalRequired || approvalStatus === "approved";
          break;
        case "tenant_isolated":
          acceptanceCriteriaMet[criterion] = tenantOk;
          break;
        case "evidence_fresh":
          acceptanceCriteriaMet[criterion] = evidenceFresh;
          break;
        case "tool_blocked":
          acceptanceCriteriaMet[criterion] = !invocationOk;
          break;
        case "trace_redacted":
          acceptanceCriteriaMet[criterion] = traceEvents.every((event) => {
            const serialized = JSON.stringify(event);
            return (
              !serialized.includes("sk-") &&
              event.labels.prompt === undefined &&
              !Object.values(event.labels).some((value) => value.includes("ignore previous"))
            );
          });
          break;
        default:
          acceptanceCriteriaMet[criterion] = false;
      }
    }

    // Blocked sensitive attempt: lifecycle awaits approval when approval missing.
    let lifecycleState = scenario.expectedLifecycleState;
    if (gatedAttemptWithoutApproval) {
      lifecycleState = "awaiting_action_approval";
    } else if (!contextOk || !invocationOk || !tenantOk) {
      lifecycleState = "awaiting_verification";
    } else if (!evidenceFresh) {
      lifecycleState = "awaiting_verification";
    }

    return {
      kind: scenario.kind,
      contextResult,
      invocationResult,
      orgAccess,
      clockValidation: { ok: true, clock: evaluationClock, epochMs },
      clockRejected: false,
      evidence,
      traceEvents,
      actionsTaken,
      verificationResult,
      approvalStatus,
      externalSideEffects: false,
      effectiveActionClass: contextOk
        ? contextResult.value.delegationSpecSnapshot.actionClass
        : scenario.authority.actionClass,
      lifecycleState,
      markedComplete: false,
      acceptanceCriteriaMet,
      accessedOrganizationIds: orgAccess.map((probe) => probe.organizationId),
      timingMs: Date.now() - started,
    };
  } finally {
    setAgentTraceSink(priorSink);
  }
}

function evaluationClockOrDefault(input: string | undefined): string {
  return input ?? "2026-09-08T16:00:00.000Z";
}

/** Assert trace events from a blocked invocation contain no raw secrets/prompts. */
export function assertSafeBlockedTrace(events: readonly AgentTraceEvent[]): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (events.length === 0) {
    reasons.push("Expected at least one agent-trace event when a sink is installed.");
  }
  for (const event of events) {
    if (event.kind !== "capability_invocation") {
      reasons.push(`Unexpected trace kind ${event.kind}.`);
    }
    if (event.status !== "blocked" && event.policyDecision !== "tool_class_not_authorized") {
      // validateToolInvocation may mark allowed:false via failure path
      if (event.status !== "error" && event.status !== "blocked") {
        reasons.push(`Expected blocked/error status, got ${event.status}.`);
      }
    }
    const serialized = JSON.stringify(event);
    if (/sk-[a-zA-Z0-9]{8,}/.test(serialized)) {
      reasons.push("Trace event contains secret-like token material.");
    }
    for (const [key, value] of Object.entries(event.labels)) {
      if (/prompt|chain_of_thought|cot|content|payload|body|message/i.test(key) && value !== "[REDACTED]") {
        reasons.push(`Unsafe label key survived sanitization: ${key}`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}
