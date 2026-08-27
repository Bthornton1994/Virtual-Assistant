"use server";

import { revalidatePath } from "next/cache";
import { requireManager } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import {
  freezeSupplierSourcingInputManifest,
  getGrokSupplierSourcingPrompt,
  ingestSupplierSourcingPacket,
  ingestSupplierSourcingReview,
  runSupplierSourcingValidation,
  submitSupplierSourcingRun,
} from "@/lib/supplier-sourcing-run";

function rethrowAction(error: unknown): never {
  if (error instanceof DomainError || error instanceof AuthzError) throw new Error(error.message);
  throw error;
}

function jsonArray(formData: FormData, name: string, label: string): unknown[] {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) throw new Error(label + " is required.");
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error(label + " must be a JSON array.");
  }
}

function refresh(runId: string) {
  revalidatePath("/ops/gauntlet");
  revalidatePath("/ops/execution");
  revalidatePath("/ops/execution/runs/" + runId);
}

function nonNegativeNumber(formData: FormData, name: string) {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(name + " must be a non-negative number.");
  return value;
}

export async function freezeSupplierSourcingInputManifestAction(formData: FormData) {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    const result = await freezeSupplierSourcingInputManifest(actor, runId, {
      objective: String(formData.get("objective") || ""),
      market: String(formData.get("market") || ""),
      catalogRepository: String(formData.get("catalogRepository") || "") || null,
      catalogRepositorySha: String(formData.get("catalogRepositorySha") || "") || null,
      candidates: jsonArray(formData, "candidates", "Candidates"),
      prepareExecutorKey: String(formData.get("prepareExecutorKey") || "") || undefined,
      reviewExecutorKey: String(formData.get("reviewExecutorKey") || "") || undefined,
    });
    refresh(runId);
    return result;
  } catch (error) {
    rethrowAction(error);
  }
}

export async function getGrokSupplierSourcingPromptAction(formData: FormData) {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    return { prompt: await getGrokSupplierSourcingPrompt(actor, runId) };
  } catch (error) {
    rethrowAction(error);
  }
}

export async function ingestSupplierSourcingPacketAction(formData: FormData) {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    const result = await ingestSupplierSourcingPacket(actor, runId, {
      raw: String(formData.get("raw") || ""),
      humanMinutes: nonNegativeNumber(formData, "humanMinutes"),
      aiCostMicros: nonNegativeNumber(formData, "aiCostMicros"),
      toolCostMicros: nonNegativeNumber(formData, "toolCostMicros"),
    });
    refresh(runId);
    return result;
  } catch (error) {
    rethrowAction(error);
  }
}

export async function ingestSupplierSourcingReviewAction(formData: FormData) {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    const result = await ingestSupplierSourcingReview(actor, runId, {
      raw: String(formData.get("raw") || ""),
      humanMinutes: nonNegativeNumber(formData, "humanMinutes"),
      aiCostMicros: nonNegativeNumber(formData, "aiCostMicros"),
      toolCostMicros: nonNegativeNumber(formData, "toolCostMicros"),
    });
    refresh(runId);
    return result;
  } catch (error) {
    rethrowAction(error);
  }
}

export async function runSupplierSourcingValidationAction(formData: FormData) {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    const result = await runSupplierSourcingValidation(actor, runId);
    refresh(runId);
    return result;
  } catch (error) {
    rethrowAction(error);
  }
}

export async function submitSupplierSourcingRunAction(formData: FormData) {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    const result = await submitSupplierSourcingRun(actor, runId);
    refresh(runId);
    return result;
  } catch (error) {
    rethrowAction(error);
  }
}
