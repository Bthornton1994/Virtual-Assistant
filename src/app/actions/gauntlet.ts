"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOps } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import {
  FAILURE_CLASSIFICATIONS,
  IMPACT_DIRECTIONS,
  RETRY_DECISIONS,
  DEFAULT_AUTONOMY_POLICY,
  type AutonomyPolicy,
  type FailureClassification,
  type ImpactDirection,
  type RetryDecision,
} from "@/lib/gauntlet-policy";
import {
  addGauntletImpactAssessment,
  addGauntletObservation,
  addGauntletReview,
  applyAutonomyDecision,
  classifyGauntletFailure,
  createGauntletAttempt,
  createGauntletCycle,
  diagnoseGauntletCycle,
  evaluateGauntletAutonomy,
  resolveGauntletFailure,
  updateAutonomyPolicy,
} from "@/lib/gauntlet";
import { verifyWorkstreamRun } from "@/lib/execution-primitives";

function rethrowAction(error: unknown): never {
  if (error instanceof DomainError || error instanceof AuthzError) throw new Error(error.message);
  throw error;
}

function lines(formData: FormData, name: string) {
  return String(formData.get(name) || "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseObject(formData: FormData, name: string, label: string) {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be a JSON object.`);
  }
}

function parseJsonArray(formData: FormData, name: string, label: string): unknown[] {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a JSON array.`);
  }
}

function optionalNumber(formData: FormData, name: string) {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number.`);
  return value;
}

function refresh(cycleId?: string, runId?: string) {
  revalidatePath("/ops/gauntlet");
  if (cycleId) revalidatePath(`/ops/gauntlet/cycles/${cycleId}`);
  if (runId) revalidatePath(`/ops/execution/runs/${runId}`);
  revalidatePath("/ops/execution");
}

export async function createGauntletCycleAction(formData: FormData) {
  const actor = await requireOps();
  let cycleId = "";
  try {
    const rawMode = String(formData.get("recurrenceMode") || "manual");
    const recurrenceMode = rawMode === "recurring" || rawMode === "event" ? rawMode : "manual";
    const cycle = await createGauntletCycle(actor, {
      delegationSpecId: String(formData.get("delegationSpecId") || ""),
      recurrenceMode,
      triggerKind: "manual",
      hypothesis: String(formData.get("hypothesis") || ""),
    });
    cycleId = cycle.id;
  } catch (error) {
    rethrowAction(error);
  }
  if (!cycleId) throw new Error("Gauntlet cycle could not be created.");
  refresh(cycleId);
  redirect(`/ops/gauntlet/cycles/${cycleId}`);
}

export async function addGauntletObservationAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  try {
    await addGauntletObservation(actor, cycleId, {
      signalType: String(formData.get("signalType") || "observation"),
      summary: String(formData.get("summary") || ""),
      sourceUri: String(formData.get("sourceUri") || "") || null,
      payload: parseObject(formData, "payload", "Observation payload"),
    });
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId);
}

export async function diagnoseGauntletCycleAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  try {
    await diagnoseGauntletCycle(actor, cycleId, {
      diagnosis: String(formData.get("diagnosis") || ""),
      bindingConstraint: String(formData.get("bindingConstraint") || ""),
      selectedAction: String(formData.get("selectedAction") || ""),
      hypothesis: String(formData.get("hypothesis") || ""),
      evidenceRefs: lines(formData, "evidenceRefs"),
    });
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId);
}

export async function createGauntletAttemptAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  let runId = "";
  try {
    const run = await createGauntletAttempt(actor, cycleId, String(formData.get("retryOfRunId") || "") || null);
    runId = String(run.id);
  } catch (error) {
    rethrowAction(error);
  }
  if (!runId) throw new Error("Gauntlet attempt could not be created.");
  refresh(cycleId, runId);
  redirect(`/ops/execution/runs/${runId}`);
}

export async function addGauntletReviewAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  const runId = String(formData.get("runId") || "");
  try {
    const rawKind = String(formData.get("reviewerKind") || "human");
    const reviewerKind = rawKind === "deterministic" || rawKind === "agent" || rawKind === "hybrid" ? rawKind : "human";
    const rawVerdict = String(formData.get("verdict") || "inconclusive");
    const verdict = rawVerdict === "passed" || rawVerdict === "failed" ? rawVerdict : "inconclusive";
    await addGauntletReview(actor, runId, {
      reviewerKind,
      reviewerRef: String(formData.get("reviewerRef") || ""),
      verdict,
      hardGatePass: formData.get("hardGatePass") === "on",
      challengedAssumptions: lines(formData, "challengedAssumptions"),
      defects: parseJsonArray(formData, "defects", "Defects"),
      evidenceGaps: lines(formData, "evidenceGaps"),
      authorityIncidents: parseJsonArray(formData, "authorityIncidents", "Authority incidents"),
      notes: String(formData.get("notes") || ""),
    });
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId, runId);
}

export async function issueGauntletReceiptAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  const runId = String(formData.get("runId") || "");
  const verificationStatus = formData.get("verificationStatus") === "passed" ? "passed" : "failed";
  const rawScore = String(formData.get("qaScore") || "").trim();
  try {
    await verifyWorkstreamRun(actor, runId, {
      verificationStatus,
      definitionOfDoneMet: formData.get("definitionOfDoneMet") === "on",
      summary: String(formData.get("summary") || ""),
      verificationNotes: String(formData.get("verificationNotes") || ""),
      actionsTaken: lines(formData, "actionsTaken"),
      exceptions: lines(formData, "exceptions"),
      unresolvedDecisions: lines(formData, "unresolvedDecisions"),
      qaScore: rawScore ? Number(rawScore) : null,
    });
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId, runId);
}

export async function classifyGauntletFailureAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  const rawClassification = String(formData.get("classification") || "unknown");
  const classification = (FAILURE_CLASSIFICATIONS as readonly string[]).includes(rawClassification)
    ? (rawClassification as FailureClassification)
    : "unknown";
  const rawSeverity = String(formData.get("severity") || "medium");
  const severity = rawSeverity === "low" || rawSeverity === "high" || rawSeverity === "critical" ? rawSeverity : "medium";
  const rawRetry = String(formData.get("retryDecision") || "");
  const retryDecision = (RETRY_DECISIONS as readonly string[]).includes(rawRetry) ? (rawRetry as RetryDecision) : undefined;
  try {
    await classifyGauntletFailure(actor, String(formData.get("failureId") || ""), {
      classification,
      severity,
      retryDecision,
      rootCause: String(formData.get("rootCause") || ""),
      correctiveAction: String(formData.get("correctiveAction") || ""),
    });
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId);
}

export async function resolveAndRetryGauntletFailureAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  const failureId = String(formData.get("failureId") || "");
  const retryOfRunId = String(formData.get("runId") || "");
  let runId = "";
  try {
    await resolveGauntletFailure(actor, failureId);
    const run = await createGauntletAttempt(actor, cycleId, retryOfRunId || null);
    runId = String(run.id);
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId, runId);
  redirect(`/ops/execution/runs/${runId}`);
}

export async function addGauntletImpactAssessmentAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  const rawDirection = String(formData.get("direction") || "inconclusive");
  const direction = (IMPACT_DIRECTIONS as readonly string[]).includes(rawDirection)
    ? (rawDirection as ImpactDirection)
    : "inconclusive";
  const rawQuality = String(formData.get("evidenceQuality") || "weak");
  const evidenceQuality = rawQuality === "moderate" || rawQuality === "strong" ? rawQuality : "weak";
  try {
    await addGauntletImpactAssessment(actor, cycleId, {
      direction,
      hypothesis: String(formData.get("hypothesis") || ""),
      primaryMetric: String(formData.get("primaryMetric") || ""),
      baseline: parseObject(formData, "baseline", "Baseline"),
      observed: parseObject(formData, "observed", "Observed result"),
      delta: parseObject(formData, "delta", "Delta"),
      guardrails: parseJsonArray(formData, "guardrails", "Guardrails"),
      evidenceRefs: lines(formData, "evidenceRefs"),
      evidenceQuality,
      interpretation: String(formData.get("interpretation") || ""),
    });
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId);
}

export async function evaluateGauntletAutonomyAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  try {
    await evaluateGauntletAutonomy(actor, cycleId);
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId);
}

export async function applyAutonomyDecisionAction(formData: FormData) {
  const actor = await requireOps();
  const cycleId = String(formData.get("cycleId") || "");
  try {
    await applyAutonomyDecision(actor, String(formData.get("decisionId") || ""));
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId);
}

export async function updateAutonomyPolicyAction(formData: FormData) {
  const actor = await requireOps();
  const profileId = String(formData.get("profileId") || "");
  const cycleId = String(formData.get("cycleId") || "");
  const policy: AutonomyPolicy = {
    ...DEFAULT_AUTONOMY_POLICY,
    minimumVerifiedRunsForPromotion: optionalNumber(formData, "minimumVerifiedRunsForPromotion"),
    minimumQaScore: optionalNumber(formData, "minimumQaScore"),
    maximumFailureRate: optionalNumber(formData, "maximumFailureRate"),
    maximumExceptionRate: optionalNumber(formData, "maximumExceptionRate"),
    maximumOwnerMinutesPerRun: optionalNumber(formData, "maximumOwnerMinutesPerRun"),
    requireImprovedImpactForPromotion: formData.get("requireImprovedImpactForPromotion") === "on",
    allowAutomaticPromotion: formData.get("allowAutomaticPromotion") === "on",
    promotionRequiresApproval: formData.get("promotionRequiresApproval") === "on",
    autoDemoteOnHardGateFailure: formData.get("autoDemoteOnHardGateFailure") === "on",
    autoDemoteOnRegression: formData.get("autoDemoteOnRegression") === "on",
    autoSuspendOnAuthorityIncident: formData.get("autoSuspendOnAuthorityIncident") === "on",
  };
  try {
    await updateAutonomyPolicy(actor, profileId, policy);
  } catch (error) {
    rethrowAction(error);
  }
  refresh(cycleId);
}
