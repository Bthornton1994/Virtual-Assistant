"use server";

import { revalidatePath } from "next/cache";
import { requireOps } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import {
  freezeWorkCellInputManifest,
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
  revalidatePath("/ops/execution");
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
 * A rejected artifact is not stored as evidence, so the operator has to see why.
 * The rejection itself is still recorded as an untrusted audit artifact by the
 * ingestion function before this throws.
 */
function assertAccepted(result: { persisted: boolean; validation: { hardFailures: string[] } }, label: string) {
  if (result.persisted) return;
  const detail = result.validation.hardFailures.slice(0, 8).join(" ");
  const more = result.validation.hardFailures.length > 8 ? ` (+${result.validation.hardFailures.length - 8} more)` : "";
  throw new Error(`${label} was rejected and not stored as evidence. ${detail}${more}`);
}

/**
 * Input records are pasted as one JSON object keyed by product ID, mapping
 * each to its exact frozen catalog record — the same shape an operator can
 * copy straight out of the Loadout repository, rather than one record per
 * form field.
 */
function parseInputRecords(formData: FormData): Array<{ productId: string; record: Record<string, unknown> }> {
  const raw = String(formData.get("inputRecords") || "").trim();
  if (!raw) throw new Error("Frozen input records are required: paste the exact catalog record for every expected product.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Frozen input records are not valid JSON: ${(error as Error).message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Frozen input records must be a JSON object mapping each product ID to its catalog record.");
  }
  return Object.entries(parsed as Record<string, unknown>).map(([productId, record]) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`The frozen input record for product ID "${productId}" must be a JSON object.`);
    }
    return { productId, record: record as Record<string, unknown> };
  });
}

export async function freezeWorkCellInputManifestAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await freezeWorkCellInputManifest(actor, runId, {
      market: String(formData.get("market") || ""),
      expectedProductIds: String(formData.get("expectedProductIds") || "")
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean),
      inputRecords: parseInputRecords(formData),
      prepareExecutorKey: String(formData.get("prepareExecutorKey") || ""),
      reviewExecutorKey: String(formData.get("reviewExecutorKey") || ""),
    });
  } catch (error) {
    rethrowAction(error);
  }
  refresh(runId, String(formData.get("cycleId") || "") || undefined);
}

export async function ingestCatalogEvidencePacketAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    // No executor-key field: the identity comes from the frozen input manifest, so
    // an operator cannot relabel one executor's output as another's after seeing it.
    const result = await ingestCatalogEvidencePacket(actor, runId, {
      raw: String(formData.get("raw") || ""),
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
    // The expected batch comes from the frozen input manifest, never from a form.
    await runWorkCellValidation(actor, runId);
  } catch (error) {
    rethrowAction(error);
  }
  refresh(runId, String(formData.get("cycleId") || "") || undefined);
}

export async function recordWorkCellGauntletReviewsAction(formData: FormData) {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await recordWorkCellGauntletReviews(actor, runId);
  } catch (error) {
    rethrowAction(error);
  }
  refresh(runId, String(formData.get("cycleId") || "") || undefined);
}
