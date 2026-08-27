"use server";

import { revalidatePath } from "next/cache";
import { requireManager, requireSession } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import { SUPPLIER_OUTREACH_CHANNELS } from "@/lib/supplier-communication";
import {
  createSupplierOutreachApproval,
  freezeSupplierSourcingInputManifest,
  getGrokSupplierSourcingPrompt,
  ingestSupplierSourcingPacket,
  ingestSupplierSourcingReview,
  runSupplierSourcingValidation,
  submitSupplierSourcingRun,
} from "@/lib/supplier-sourcing-run";

export type SupplierSourcingActionResult = { ok: true } | { ok: false; error: string };
export type SupplierSourcingPromptActionResult =
  | { ok: true; prompt: string }
  | { ok: false; error: string };
type SupplierSourcingActionFailure = { ok: false; error: string };

function fail(error: unknown): SupplierSourcingActionFailure {
  if (error instanceof DomainError || error instanceof AuthzError) return { ok: false, error: error.message };
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: "The supplier-sourcing action failed." };
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

function nonNegativeNumber(formData: FormData, name: string) {
  const raw = String(formData.get(name) || "").trim();
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(name + " must be a non-negative number.");
  return value;
}

function refresh(runId: string) {
  revalidatePath("/ops/gauntlet");
  revalidatePath("/ops/execution");
  revalidatePath("/ops/execution/runs/" + runId);
}

export async function freezeSupplierSourcingInputManifestAction(
  formData: FormData,
): Promise<SupplierSourcingActionResult> {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    await freezeSupplierSourcingInputManifest(actor, runId, {
      objective: String(formData.get("objective") || ""),
      market: String(formData.get("market") || ""),
      catalogRepository: String(formData.get("catalogRepository") || "") || null,
      catalogRepositorySha: String(formData.get("catalogRepositorySha") || "") || null,
      candidates: jsonArray(formData, "candidates", "Candidates"),
      prepareExecutorKey: String(formData.get("prepareExecutorKey") || "") || undefined,
      reviewExecutorKey: String(formData.get("reviewExecutorKey") || "") || undefined,
    });
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function getGrokSupplierSourcingPromptAction(
  formData: FormData,
): Promise<SupplierSourcingPromptActionResult> {
  const actor = await requireManager();
  try {
    return {
      ok: true,
      prompt: await getGrokSupplierSourcingPrompt(actor, String(formData.get("runId") || "")),
    };
  } catch (error) {
    const result = fail(error);
    return result;
  }
}

export async function ingestSupplierSourcingPacketAction(
  formData: FormData,
): Promise<SupplierSourcingActionResult> {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    await ingestSupplierSourcingPacket(actor, runId, {
      raw: String(formData.get("raw") || ""),
      humanMinutes: nonNegativeNumber(formData, "humanMinutes"),
      aiCostMicros: nonNegativeNumber(formData, "aiCostMicros"),
      toolCostMicros: nonNegativeNumber(formData, "toolCostMicros"),
    });
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function ingestSupplierSourcingReviewAction(
  formData: FormData,
): Promise<SupplierSourcingActionResult> {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    await ingestSupplierSourcingReview(actor, runId, {
      raw: String(formData.get("raw") || ""),
      humanMinutes: nonNegativeNumber(formData, "humanMinutes"),
      aiCostMicros: nonNegativeNumber(formData, "aiCostMicros"),
      toolCostMicros: nonNegativeNumber(formData, "toolCostMicros"),
    });
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function runSupplierSourcingValidationAction(
  formData: FormData,
): Promise<SupplierSourcingActionResult> {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    await runSupplierSourcingValidation(actor, runId);
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function submitSupplierSourcingRunAction(
  formData: FormData,
): Promise<SupplierSourcingActionResult> {
  const actor = await requireManager();
  const runId = String(formData.get("runId") || "");
  try {
    await submitSupplierSourcingRun(actor, runId);
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function approveSupplierOutreachAction(
  formData: FormData,
): Promise<SupplierSourcingActionResult> {
  const actor = await requireSession();
  const runId = String(formData.get("runId") || "");
  const rawChannel = String(formData.get("channel") || "");
  if (!(SUPPLIER_OUTREACH_CHANNELS as readonly string[]).includes(rawChannel)) {
    return { ok: false, error: "A valid outreach channel is required." };
  }
  try {
    await createSupplierOutreachApproval(actor, runId, {
      candidateId: String(formData.get("candidateId") || ""),
      channel: rawChannel as (typeof SUPPLIER_OUTREACH_CHANNELS)[number],
      destination: String(formData.get("destination") || ""),
      subject: String(formData.get("subject") || ""),
      body: String(formData.get("body") || ""),
      factsUsedSourceUrls: jsonArray(formData, "factsUsedSourceUrls", "Facts used source URLs").map(String),
      expiresAt: String(formData.get("expiresAt") || ""),
    });
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
