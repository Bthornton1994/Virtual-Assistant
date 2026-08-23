"use server";

import { revalidatePath } from "next/cache";
import { requireOps } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import {
  ingestCatalogEvidencePacket,
  ingestCatalogEvidenceReview,
  recordWorkCellGauntletReviews,
  runWorkCellValidation,
} from "@/lib/work-cell";

function rethrowAction(error: unknown): never {
  if (error instanceof DomainError || error instanceof AuthzError) throw new Error(error.message);
  throw error;
}

function refresh(runId: string, cycleId?: string) {
  revalidatePath(`/ops/execution/runs/${runId}`);
  if (cycleId) revalidatePath(`/ops/gauntlet/cycles/${cycleId}`);
}

function productIds(formData: FormData) {
  const raw = String(formData.get("expectedProductIds") || "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return raw.length ? raw : undefined;
}

function nonNegativeNumber(formData: FormData, name: string, label: string) {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater.`);
  return value;
}

function dollarsToMicros(formData: FormData, name: string, label: string) {
  return Math.round(nonNegativeNumber(formData, name, label) * 1_000_000);
}

/**
 * Validation failures are surfaced as thrown errors rather than persisted state:
 * the artifact is only written when the deterministic gate accepts it, so a
 * rejected paste leaves no trace of partially-trusted evidence.
 */
function assertAccepted(result: { persisted: boolean; validation: { hardFailures: string[] } }, label: string) {
  if (result.persisted) return;
  const detail = result.validation.hardFailures.slice(0, 8).join(" ");
  const more = result.validation.hardFailures.length > 8 ? ` (+${result.validation.hardFailures.length - 8} more)` : "";
  throw new Error(`${label} was rejected and not stored. ${detail}${more}`);
}

export async function ingestCatalogEvidencePacketAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    const result = await ingestCatalogEvidencePacket(actor, runId, {
      raw: String(formData.get("raw") || ""),
      executorKey: String(formData.get("executorKey") || ""),
      expectedProductIds: productIds(formData),
      humanMinutes: nonNegativeNumber(formData, "humanMinutes", "Human minutes"),
      aiCostMicros: dollarsToMicros(formData, "aiCost", "AI cost"),
      toolCostMicros: dollarsToMicros(formData, "toolCost", "Tool cost"),
    });
    assertAccepted(result, "The catalog evidence packet");
  } catch (error) {
    rethrowAction(error);
  }
  refresh(runId, String(formData.get("cycleId") || "") || undefined);
}

export async function ingestCatalogEvidenceReviewAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    const result = await ingestCatalogEvidenceReview(actor, runId, {
      raw: String(formData.get("raw") || ""),
      executorKey: String(formData.get("executorKey") || ""),
      humanMinutes: nonNegativeNumber(formData, "humanMinutes", "Human minutes"),
      aiCostMicros: dollarsToMicros(formData, "aiCost", "AI cost"),
      toolCostMicros: dollarsToMicros(formData, "toolCost", "Tool cost"),
    });
    assertAccepted(result, "The independent evidence review");
  } catch (error) {
    rethrowAction(error);
  }
  refresh(runId, String(formData.get("cycleId") || "") || undefined);
}

export async function runWorkCellValidationAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await runWorkCellValidation(actor, runId, productIds(formData));
  } catch (error) {
    rethrowAction(error);
  }
  refresh(runId, String(formData.get("cycleId") || "") || undefined);
}

export async function recordWorkCellGauntletReviewsAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await recordWorkCellGauntletReviews(actor, runId, productIds(formData));
  } catch (error) {
    rethrowAction(error);
  }
  refresh(runId, String(formData.get("cycleId") || "") || undefined);
}
