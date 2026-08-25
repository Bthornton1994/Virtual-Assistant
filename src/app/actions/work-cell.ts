"use server";

import { requireOps } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import {
  freezeWorkCellInputManifest,
  ingestCatalogEvidencePacket,
  ingestCatalogEvidenceReview,
  recordWorkCellGauntletReviews,
  runNativePublicWebPrepare,
  runWorkCellValidation,
} from "@/lib/work-cell";

export type WorkCellActionResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown): WorkCellActionResult {
  if (error instanceof DomainError || error instanceof AuthzError) return { ok: false, error: error.message };
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: "The action failed." };
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
 * Rejected outputs are persisted as immutable, untrusted audit artifacts by the
 * ingestion function. These actions return a result instead of revalidatePath:
 * a Server Component form plus revalidatePath suspends the async run page as
 * synchronous input (React #441). The client form refreshes after a successful return.
 */

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

export async function freezeWorkCellInputManifestAction(formData: FormData): Promise<WorkCellActionResult> {
  try {
    const actor = await requireOps();
    const runId = String(formData.get("runId") || "");
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
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function runNativePublicWebPrepareAction(formData: FormData): Promise<WorkCellActionResult> {
  try {
    const actor = await requireOps();
    await runNativePublicWebPrepare(actor, String(formData.get("runId") || ""));
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function ingestCatalogEvidencePacketAction(formData: FormData): Promise<WorkCellActionResult> {
  try {
    const actor = await requireOps();
    // No executor-key field: the identity comes from the frozen input manifest, so
    // an operator cannot relabel one executor's output as another's after seeing it.
    await ingestCatalogEvidencePacket(actor, String(formData.get("runId") || ""), {
      raw: String(formData.get("raw") || ""),
      humanMinutes: nonNegativeNumber(formData, "humanMinutes", "Human minutes"),
      aiCostMicros: dollarsToMicros(formData, "aiCost", "AI cost"),
      toolCostMicros: dollarsToMicros(formData, "toolCost", "Tool cost"),
    });
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function ingestCatalogEvidenceReviewAction(formData: FormData): Promise<WorkCellActionResult> {
  try {
    const actor = await requireOps();
    await ingestCatalogEvidenceReview(actor, String(formData.get("runId") || ""), {
      raw: String(formData.get("raw") || ""),
      humanMinutes: nonNegativeNumber(formData, "humanMinutes", "Human minutes"),
      aiCostMicros: dollarsToMicros(formData, "aiCost", "AI cost"),
      toolCostMicros: dollarsToMicros(formData, "toolCost", "Tool cost"),
    });
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function runWorkCellValidationAction(formData: FormData): Promise<WorkCellActionResult> {
  try {
    const actor = await requireOps();
    // The expected batch comes from the frozen input manifest, never from a form.
    await runWorkCellValidation(actor, String(formData.get("runId") || ""));
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function recordWorkCellGauntletReviewsAction(formData: FormData): Promise<WorkCellActionResult> {
  try {
    const actor = await requireOps();
    await recordWorkCellGauntletReviews(actor, String(formData.get("runId") || ""));
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
