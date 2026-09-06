"use server";

import { revalidatePath } from "next/cache";
import { requireOps } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import {
  assignTwlPrepareProofWorker,
  attachTwlPrepareProofPrEvidence,
} from "@/lib/twl-prepare-proof-run";

export type TwlPrepareProofActionResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown): TwlPrepareProofActionResult {
  if (error instanceof DomainError || error instanceof AuthzError) return { ok: false, error: error.message };
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: "The prepare-only proof action failed." };
}

function refresh(runId: string) {
  revalidatePath("/ops/execution");
  revalidatePath(`/ops/execution/runs/${runId}`);
}

export async function assignTwlPrepareProofWorkerAction(
  formData: FormData,
): Promise<TwlPrepareProofActionResult> {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  const workerKind = String(formData.get("workerKind") || "") === "human_operator" ? "human_operator" : "shadow";
  try {
    await assignTwlPrepareProofWorker(actor, runId, {
      workerKind,
      workerKey: String(formData.get("workerKey") || ""),
      displayName: String(formData.get("displayName") || ""),
    });
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function attachTwlPrepareProofPrEvidenceAction(
  formData: FormData,
): Promise<TwlPrepareProofActionResult> {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await attachTwlPrepareProofPrEvidence(actor, runId, {
      owner: String(formData.get("owner") || ""),
      repo: String(formData.get("repo") || ""),
      pullNumber: String(formData.get("pullNumber") || ""),
    });
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
