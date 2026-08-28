"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOps } from "@/lib/auth";
import { ACTION_CLASSES, AuthzError, DomainError, type ActionClass } from "@/lib/domain";
import {
  activateDelegationSpec,
  addEvidenceArtifact,
  createDelegationSpec,
  createWorkstreamRun,
  transitionWorkstreamRun,
  verifyWorkstreamRun,
  type EvidenceKind,
} from "@/lib/execution-primitives";

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

function parseObject(raw: FormDataEntryValue | null, label: string) {
  const value = String(raw || "").trim();
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be a JSON object.`);
  }
}

function nonNegativeNumber(raw: FormDataEntryValue | null, label: string) {
  const value = Number(raw || 0);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater.`);
  return value;
}

function dollarsToMicros(raw: FormDataEntryValue | null, label: string) {
  return Math.round(nonNegativeNumber(raw, label) * 1_000_000);
}

function refreshExecution(runId?: string) {
  revalidatePath("/ops/execution");
  if (runId) revalidatePath(`/ops/execution/runs/${runId}`);
}

export async function createDelegationSpecAction(formData: FormData) {
  const actor = await requireOps();
  const rawClass = String(formData.get("actionClass") || "prepare_only");
  const actionClass = (ACTION_CLASSES as readonly string[]).includes(rawClass)
    ? (rawClass as ActionClass)
    : "prepare_only";
  try {
    await createDelegationSpec(actor, {
      workstreamId: String(formData.get("workstreamId") || ""),
      objective: String(formData.get("objective") || ""),
      definitionOfDone: lines(formData, "definitionOfDone"),
      triggerDescription: String(formData.get("triggerDescription") || ""),
      requiredInputs: lines(formData, "requiredInputs"),
      actionClass,
      authorityRules: lines(formData, "authorityRules"),
      approvalPoints: lines(formData, "approvalPoints"),
      verificationRules: lines(formData, "verificationRules"),
      exceptionPolicy: lines(formData, "exceptionPolicy"),
      sla: String(formData.get("sla") || ""),
      economicEnvelope: parseObject(formData.get("economicEnvelope"), "Economic envelope"),
    });
  } catch (error) {
    rethrowAction(error);
  }
  refreshExecution();
}

export async function activateDelegationSpecAction(formData: FormData) {
  const actor = await requireOps();
  try {
    await activateDelegationSpec(actor, String(formData.get("specId") || ""));
  } catch (error) {
    rethrowAction(error);
  }
  refreshExecution();
}

export async function createWorkstreamRunAction(formData: FormData) {
  const actor = await requireOps();
  let runId = "";
  try {
    const run = await createWorkstreamRun(actor, String(formData.get("specId") || ""));
    runId = run.id;
  } catch (error) {
    rethrowAction(error);
  }
  if (!runId) throw new Error("The workstream run could not be created.");
  refreshExecution(runId);
  redirect(`/ops/execution/runs/${runId}`);
}

export async function startWorkstreamRunAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await transitionWorkstreamRun(actor, runId, "running");
  } catch (error) {
    rethrowAction(error);
  }
  refreshExecution(runId);
}

export async function addEvidenceArtifactAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  const allowedKinds = [
    "source",
    "before_after",
    "test",
    "deployment",
    "communication",
    "reconciliation",
    "observation",
    "other",
  ] as const;
  const rawKind = String(formData.get("kind") || "observation");
  const kind: EvidenceKind = (allowedKinds as readonly string[]).includes(rawKind)
    ? (rawKind as EvidenceKind)
    : "other";
  try {
    await addEvidenceArtifact(actor, runId, {
      kind,
      summary: String(formData.get("summary") || ""),
      sourceUri: String(formData.get("sourceUri") || "") || null,
      payload: parseObject(formData.get("payload"), "Evidence payload"),
    });
  } catch (error) {
    rethrowAction(error);
  }
  refreshExecution(runId);
}

export async function submitWorkstreamRunAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await transitionWorkstreamRun(actor, runId, "awaiting_verification", {
      humanMinutes: nonNegativeNumber(formData.get("humanMinutes"), "Human minutes"),
      ownerMinutes: nonNegativeNumber(formData.get("ownerMinutes"), "Owner minutes"),
      aiCostMicros: dollarsToMicros(formData.get("aiCost"), "AI cost"),
      toolCostMicros: dollarsToMicros(formData.get("toolCost"), "Tool cost"),
      notes: String(formData.get("notes") || ""),
      executorSummary: parseObject(formData.get("executorSummary"), "Executor summary"),
    });
  } catch (error) {
    rethrowAction(error);
  }
  refreshExecution(runId);
}

export async function verifyWorkstreamRunAction(formData: FormData) {
  const actor = await requireOps();
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
      qaScore: rawScore ? nonNegativeNumber(formData.get("qaScore"), "QA score") : null,
    });
  } catch (error) {
    rethrowAction(error);
  }
  refreshExecution(runId);
}
