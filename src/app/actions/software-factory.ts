"use server";

import { revalidatePath } from "next/cache";
import { requireClient, requireOps } from "@/lib/auth";
import { AuthzError, DomainError } from "@/lib/domain";
import {
  attachPersistedSoftwareFactoryEvidence,
  bindSoftwareFactoryRun,
  freezePersistedSoftwareFactoryPacket,
  inspectPersistedSoftwareFactoryRepository,
  recordPersistedSoftwareFactoryHandoffs,
  recordPersistedSoftwareFactoryOwnerDecision,
  rejectPersistedSoftwareFactoryForbiddenAction,
  transitionPersistedSoftwareFactoryRun,
} from "@/lib/software-factory-persist";
import {
  SOFTWARE_FACTORY_FORBIDDEN_ACTIONS,
  SOFTWARE_FACTORY_LIFECYCLE_STATUSES,
  type SoftwareFactoryEvidenceKind,
  type SoftwareFactoryForbiddenAction,
  type SoftwareFactoryLifecycleStatus,
} from "@/lib/software-factory-run-manager";

export type SoftwareFactoryActionResult = { ok: true } | { ok: false; error: string };

function fail(error: unknown): SoftwareFactoryActionResult {
  if (error instanceof DomainError || error instanceof AuthzError) return { ok: false, error: error.message };
  if (error instanceof Error) return { ok: false, error: error.message };
  return { ok: false, error: "The Software Factory action failed." };
}

function refresh(runId: string) {
  revalidatePath("/ops/execution");
  revalidatePath(`/ops/execution/runs/${runId}`);
  revalidatePath("/app/approvals");
}

function lines(formData: FormData, name: string) {
  return String(formData.get(name) || "")
    .split("\n")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function bindSoftwareFactoryRunAction(formData: FormData): Promise<SoftwareFactoryActionResult> {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await bindSoftwareFactoryRun(actor, runId, {
      taskId: String(formData.get("taskId") || ""),
      repository: String(formData.get("repository") || ""),
      baseBranch: String(formData.get("baseBranch") || "main"),
      inScope: lines(formData, "inScope"),
      acceptanceCriteria: lines(formData, "acceptanceCriteria"),
    });
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function transitionSoftwareFactoryRunAction(formData: FormData): Promise<SoftwareFactoryActionResult> {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  const to = String(formData.get("to") || "");
  if (!(SOFTWARE_FACTORY_LIFECYCLE_STATUSES as readonly string[]).includes(to)) {
    return { ok: false, error: "Unknown Software Factory lifecycle status." };
  }
  try {
    await transitionPersistedSoftwareFactoryRun(actor, runId, to as SoftwareFactoryLifecycleStatus);
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function inspectSoftwareFactoryRepositoryAction(formData: FormData): Promise<SoftwareFactoryActionResult> {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await inspectPersistedSoftwareFactoryRepository(actor, runId, String(formData.get("notes") || ""));
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function recordSoftwareFactoryHandoffsAction(formData: FormData): Promise<SoftwareFactoryActionResult> {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await recordPersistedSoftwareFactoryHandoffs(actor, runId);
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function freezeSoftwareFactoryPacketAction(formData: FormData): Promise<SoftwareFactoryActionResult> {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    const raw = String(formData.get("packet") || "").trim();
    const parsed = JSON.parse(raw) as unknown;
    await freezePersistedSoftwareFactoryPacket(actor, runId, parsed);
    refresh(runId);
    return { ok: true };
  } catch (error) {
    if (error instanceof SyntaxError) return { ok: false, error: "Packet must be a JSON object." };
    return fail(error);
  }
}

export async function attachSoftwareFactoryEvidenceAction(formData: FormData): Promise<SoftwareFactoryActionResult> {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  try {
    await attachPersistedSoftwareFactoryEvidence(actor, runId, {
      factoryKind: String(formData.get("factoryKind") || "other") as Exclude<
        SoftwareFactoryEvidenceKind,
        "task_packet" | "owner_decision"
      >,
      summary: String(formData.get("summary") || ""),
      sourceUri: String(formData.get("sourceUri") || ""),
      conclusion: String(formData.get("conclusion") || ""),
      satisfiedCriteria: lines(formData, "satisfiedCriteria"),
    });
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function rejectSoftwareFactoryForbiddenAction(formData: FormData): Promise<SoftwareFactoryActionResult> {
  const actor = await requireOps();
  const runId = String(formData.get("runId") || "");
  const action = String(formData.get("action") || "merge_pr");
  const allowed = SOFTWARE_FACTORY_FORBIDDEN_ACTIONS as readonly string[];
  try {
    await rejectPersistedSoftwareFactoryForbiddenAction(
      actor,
      runId,
      (allowed.includes(action) ? action : "merge_pr") as SoftwareFactoryForbiddenAction,
    );
    refresh(runId);
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}

export async function recordSoftwareFactoryOwnerDecisionAction(formData: FormData): Promise<SoftwareFactoryActionResult> {
  const actor = await requireClient();
  const factoryRunId = String(formData.get("factoryRunId") || "");
  const workstreamRunId = String(formData.get("runId") || "");
  try {
    await recordPersistedSoftwareFactoryOwnerDecision(actor, factoryRunId, {
      kind: "owner_acceptance",
      status: String(formData.get("status") || "") === "rejected" ? "rejected" : "approved",
      rationale: String(formData.get("rationale") || ""),
      sourceRefs: lines(formData, "sourceRefs"),
    });
    if (workstreamRunId) refresh(workstreamRunId);
    else revalidatePath("/app/approvals");
    return { ok: true };
  } catch (error) {
    return fail(error);
  }
}
