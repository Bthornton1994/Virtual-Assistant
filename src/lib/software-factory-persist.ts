import { AuthzError, DomainError, isClientRole, isOpsRole, type Actor } from "@/lib/domain";
import { getWorkstreamRunBundle, type EvidenceArtifact } from "@/lib/execution-primitives";
import { supabaseServer } from "@/lib/supabase/server";
import {
  SOFTWARE_FACTORY_ACTION_CLASS,
  SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
  SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION,
  SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
  detectSoftwareFactoryProblems,
  evaluateAcceptance,
  hashSoftwareFactoryPacket,
  isSoftwareFactorySpec,
  validateSoftwareFactoryPacket,
  type SoftwareFactoryApprovalKind,
  type SoftwareFactoryApprovalRequest,
  type SoftwareFactoryConnectorStatus,
  type SoftwareFactoryEvidenceKind,
  type SoftwareFactoryEvidenceRecord,
  type SoftwareFactoryForbiddenAction,
  type SoftwareFactoryLifecycleStatus,
  type SoftwareFactoryPacket,
  type SoftwareFactoryRun,
} from "@/lib/software-factory-run-manager";

function canOperate(actor: Actor) {
  return isOpsRole(actor.role);
}

async function db() {
  const client = await supabaseServer();
  if (!client) throw new DomainError("Software Factory persistence requires Supabase.");
  return client;
}

function rpcError(error: { message: string } | null, fallback: string): never {
  throw new DomainError(error?.message || fallback);
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

function mapFactoryRun(row: Record<string, unknown>): SoftwareFactoryRun {
  const packet = row.packet && typeof row.packet === "object" && !Array.isArray(row.packet)
    ? (row.packet as SoftwareFactoryPacket)
    : null;
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    taskId: String(row.task_id),
    workstreamRunId: (row.workstream_run_id as string) ?? null,
    delegationSpecId: (row.delegation_spec_id as string) ?? null,
    lifecycleStatus: row.lifecycle_status as SoftwareFactoryLifecycleStatus,
    actionClass: SOFTWARE_FACTORY_ACTION_CLASS,
    mayOwnAuthoritativeState: false,
    mergeAuthorizedForHuman: Boolean(row.merge_authorized_for_human),
    mergePerformed: false,
    repository: String(row.repository),
    baseBranch: String(row.base_branch),
    frozenInScope: asStringList(row.frozen_in_scope),
    frozenAcceptanceCriteria: asStringList(row.frozen_acceptance_criteria),
    packet,
    packetHash: (row.packet_hash as string) ?? null,
    packetFreezeVersion: Number(row.packet_freeze_version ?? 0),
    version: Number(row.version ?? 1),
    connectors: Array.isArray(row.connector_status)
      ? (row.connector_status as SoftwareFactoryConnectorStatus[])
      : [],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapApproval(row: Record<string, unknown>): SoftwareFactoryApprovalRequest {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    factoryRunId: String(row.factory_run_id),
    kind: row.kind as SoftwareFactoryApprovalKind,
    status: row.status as SoftwareFactoryApprovalRequest["status"],
    requestedBy: String(row.requested_by ?? ""),
    decidedBy: (row.decided_by as string) ?? null,
    rationale: String(row.rationale ?? ""),
    sourceRefs: asStringList(row.source_refs),
    packetHash: (row.packet_hash as string) ?? null,
    createdAt: String(row.created_at),
    decidedAt: (row.decided_at as string) ?? null,
  };
}

export function factoryEvidenceFromArtifact(row: EvidenceArtifact): SoftwareFactoryEvidenceRecord | null {
  const payload = row.payload;
  const schemaVersion = payload.schemaVersion;
  const factoryKind = (
    schemaVersion === SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION
      ? "task_packet"
      : schemaVersion === SOFTWARE_FACTORY_OWNER_DECISION_SCHEMA_VERSION
        ? "owner_decision"
        : payload.factoryKind
  ) as SoftwareFactoryEvidenceKind | undefined;
  if (!factoryKind) return null;
  const recordedAt = typeof payload.recordedAt === "string" ? payload.recordedAt : row.observedAt;
  return {
    schemaVersion: SOFTWARE_FACTORY_EVIDENCE_SCHEMA_VERSION,
    evidenceId: row.id,
    kind: factoryKind,
    summary: row.summary,
    sourceUri: row.sourceUri,
    conclusion: String(payload.conclusion ?? ""),
    satisfiedCriteria: asStringList(payload.satisfiedCriteria),
    contentHash: String(payload.contentHash ?? row.contentHash ?? "0".repeat(64)),
    recordedAt,
    mutatesRepository: false,
  };
}

export type SoftwareFactoryOverlay = {
  run: SoftwareFactoryRun;
  approvals: SoftwareFactoryApprovalRequest[];
  evidence: SoftwareFactoryEvidenceRecord[];
  events: Array<{
    id: string;
    type: string;
    actorRole: string;
    fromStatus: string | null;
    toStatus: string | null;
    sourceRef: string;
    createdAt: string;
  }>;
  problems: ReturnType<typeof detectSoftwareFactoryProblems>;
  accept: ReturnType<typeof evaluateAcceptance>;
};

export async function getSoftwareFactoryOverlay(
  actor: Actor,
  workstreamRunId: string,
): Promise<SoftwareFactoryOverlay | null> {
  if (actor.source === "demo") return null;
  const bundle = await getWorkstreamRunBundle(actor, workstreamRunId);
  if (!isSoftwareFactorySpec(bundle.spec)) return null;
  const client = await db();
  const { data, error } = await client
    .from("software_factory_runs")
    .select("*")
    .eq("workstream_run_id", workstreamRunId)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (!data) return null;
  const run = mapFactoryRun(data as Record<string, unknown>);
  if (isClientRole(actor.role) && actor.organizationId !== run.organizationId) {
    throw new AuthzError("Cross-tenant access denied");
  }

  const [{ data: approvalRows, error: approvalError }, { data: eventRows, error: eventError }] = await Promise.all([
    client.from("software_factory_approvals").select("*").eq("factory_run_id", run.id).order("created_at", { ascending: true }),
    client.from("software_factory_events").select("*").eq("factory_run_id", run.id).order("created_at", { ascending: true }),
  ]);
  if (approvalError) throw new DomainError(approvalError.message);
  if (eventError) throw new DomainError(eventError.message);

  const approvals = (approvalRows ?? []).map((row) => mapApproval(row as Record<string, unknown>));
  const evidence = bundle.evidence.map(factoryEvidenceFromArtifact).filter((row): row is SoftwareFactoryEvidenceRecord => row !== null);
  const now = new Date().toISOString();
  const problems = detectSoftwareFactoryProblems({ run, evidence, approvals, now });
  const accept = evaluateAcceptance({
    run,
    evidence,
    approvals,
    now,
    actorRole: actor.role,
    verifierId: actor.id,
  });
  return {
    run,
    approvals,
    evidence,
    events: (eventRows ?? []).map((row) => ({
      id: String((row as { id: unknown }).id),
      type: String((row as { event_type?: unknown }).event_type ?? ""),
      actorRole: String((row as { actor_role?: unknown }).actor_role ?? ""),
      fromStatus: ((row as { from_status?: string | null }).from_status) ?? null,
      toStatus: ((row as { to_status?: string | null }).to_status) ?? null,
      sourceRef: String((row as { source_ref?: unknown }).source_ref ?? ""),
      createdAt: String((row as { created_at?: unknown }).created_at ?? ""),
    })),
    problems,
    accept,
  };
}

export async function listSoftwareFactoryOwnerQueue(actor: Actor) {
  if (actor.source === "demo") return [];
  if (!isClientRole(actor.role) || !actor.organizationId) return [];
  const client = await supabaseServer();
  if (!client) return [];
  const { data, error } = await client
    .from("software_factory_runs")
    .select("id, task_id, lifecycle_status, packet_hash, workstream_run_id, organization_id")
    .eq("organization_id", actor.organizationId)
    .eq("lifecycle_status", "awaiting_owner");
  if (error) throw new DomainError(error.message);
  return (data ?? []).map((row) => ({
    factoryRunId: String(row.id),
    taskId: String(row.task_id),
    workstreamRunId: (row.workstream_run_id as string) ?? null,
    packetHash: (row.packet_hash as string) ?? null,
    lifecycleStatus: String(row.lifecycle_status),
  }));
}

export async function bindSoftwareFactoryRun(
  actor: Actor,
  workstreamRunId: string,
  input: {
    taskId: string;
    repository: string;
    baseBranch: string;
    inScope: string[];
    acceptanceCriteria: string[];
  },
) {
  if (!canOperate(actor)) throw new AuthzError("Only operations staff can bind a Software Factory overlay.");
  const bundle = await getWorkstreamRunBundle(actor, workstreamRunId);
  if (!isSoftwareFactorySpec(bundle.spec)) {
    throw new DomainError("This workstream is not a software-factory-run/v1 prepare-only spec.");
  }
  if (bundle.spec.actionClass !== "prepare_only") {
    throw new DomainError("Software Factory v1 only runs under prepare_only.");
  }
  const client = await db();
  const { data, error } = await client.rpc("software_factory_bind_workstream_run", {
    p_workstream_run_id: workstreamRunId,
    p_task_id: input.taskId.trim(),
    p_repository: input.repository.trim(),
    p_base_branch: input.baseBranch.trim(),
    p_in_scope: input.inScope,
    p_acceptance_criteria: input.acceptanceCriteria,
  });
  if (error) rpcError(error, "The Software Factory bind writer did not persist an overlay.");
  if (!data) throw new DomainError("The Software Factory bind writer did not return a run id.");
  return String(data);
}

export async function transitionPersistedSoftwareFactoryRun(
  actor: Actor,
  workstreamRunId: string,
  to: SoftwareFactoryLifecycleStatus,
) {
  if (!canOperate(actor)) throw new AuthzError("Only operations staff can transition Software Factory lifecycle state.");
  const overlay = await getSoftwareFactoryOverlay(actor, workstreamRunId);
  if (!overlay) throw new DomainError("Bind a Software Factory overlay before changing lifecycle state.");
  const client = await db();
  const { error } = await client.rpc("software_factory_transition", {
    p_factory_run_id: overlay.run.id,
    p_to: to,
    p_expected_version: overlay.run.version,
  });
  if (error) rpcError(error, "The Software Factory transition writer failed.");
}

export async function inspectPersistedSoftwareFactoryRepository(
  actor: Actor,
  workstreamRunId: string,
  notes: string,
) {
  if (!canOperate(actor)) throw new AuthzError("Only operations staff can record repository inspection inputs.");
  const overlay = await getSoftwareFactoryOverlay(actor, workstreamRunId);
  if (!overlay) throw new DomainError("Bind a Software Factory overlay before recording inspection.");
  const client = await db();
  const { error } = await client.rpc("software_factory_inspect_repository", {
    p_factory_run_id: overlay.run.id,
    p_notes: notes,
  });
  if (error) rpcError(error, "The Software Factory inspection writer failed.");
}

export async function recordPersistedSoftwareFactoryHandoffs(actor: Actor, workstreamRunId: string) {
  if (!canOperate(actor)) throw new AuthzError("Only operations staff can record worker handoffs.");
  const overlay = await getSoftwareFactoryOverlay(actor, workstreamRunId);
  if (!overlay) throw new DomainError("Bind a Software Factory overlay before recording handoffs.");
  const client = await db();
  const { error } = await client.rpc("software_factory_record_missing_handoffs", {
    p_factory_run_id: overlay.run.id,
  });
  if (error) rpcError(error, "The Software Factory handoff writer failed.");
}

export async function freezePersistedSoftwareFactoryPacket(
  actor: Actor,
  workstreamRunId: string,
  packetInput: unknown,
) {
  if (!canOperate(actor)) throw new AuthzError("Only operations staff can freeze a Software Factory task packet.");
  const overlay = await getSoftwareFactoryOverlay(actor, workstreamRunId);
  if (!overlay) throw new DomainError("Bind a Software Factory overlay before freezing a packet.");
  const parsed = validateSoftwareFactoryPacket(packetInput);
  if (!parsed.ok) {
    throw new DomainError(parsed.failures.join(" "));
  }
  const client = await db();
  const { error } = await client.rpc("software_factory_freeze_packet", {
    p_factory_run_id: overlay.run.id,
    p_packet: parsed.value,
  });
  if (error) rpcError(error, "The Software Factory packet writer failed.");
  return hashSoftwareFactoryPacket(parsed.value);
}

export async function attachPersistedSoftwareFactoryEvidence(
  actor: Actor,
  workstreamRunId: string,
  input: {
    factoryKind: Exclude<SoftwareFactoryEvidenceKind, "task_packet" | "owner_decision">;
    summary: string;
    sourceUri?: string;
    conclusion: string;
    satisfiedCriteria: string[];
  },
) {
  if (!canOperate(actor)) throw new AuthzError("Only operations staff can attach Software Factory evidence.");
  const overlay = await getSoftwareFactoryOverlay(actor, workstreamRunId);
  if (!overlay) throw new DomainError("Bind a Software Factory overlay before attaching evidence.");
  const client = await db();
  const { error } = await client.rpc("software_factory_attach_evidence", {
    p_factory_run_id: overlay.run.id,
    p_factory_kind: input.factoryKind,
    p_summary: input.summary,
    p_source_uri: input.sourceUri ?? null,
    p_conclusion: input.conclusion,
    p_satisfied_criteria: input.satisfiedCriteria,
  });
  if (error) rpcError(error, "The Software Factory evidence writer failed.");
}

export async function recordPersistedSoftwareFactoryOwnerDecision(
  actor: Actor,
  factoryRunId: string,
  input: {
    kind: SoftwareFactoryApprovalKind;
    status: "approved" | "rejected";
    rationale: string;
    sourceRefs: string[];
  },
) {
  if (!isClientRole(actor.role)) {
    throw new AuthzError("Only the organization owner or a member can record owner decisions outside the task packet.");
  }
  const client = await db();
  const { error } = await client.rpc("software_factory_record_owner_decision", {
    p_factory_run_id: factoryRunId,
    p_kind: input.kind,
    p_status: input.status,
    p_rationale: input.rationale,
    p_source_refs: input.sourceRefs,
  });
  if (error) rpcError(error, "The Software Factory owner-decision writer failed.");
}

export async function rejectPersistedSoftwareFactoryForbiddenAction(
  actor: Actor,
  workstreamRunId: string,
  action: SoftwareFactoryForbiddenAction,
) {
  const overlay = await getSoftwareFactoryOverlay(actor, workstreamRunId);
  if (!overlay) throw new DomainError("Bind a Software Factory overlay before testing a forbidden action.");
  const client = await db();
  const { data, error } = await client.rpc("software_factory_reject_forbidden_action", {
    p_factory_run_id: overlay.run.id,
    p_action: action,
  });
  if (error) {
    rpcError(error, "Merge remains blocked. Software Factory Run Manager is prepare_only and does not merge pull requests.");
  }
  const payload = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  if (payload?.blocked === true) {
    throw new DomainError(
      String(payload.message ?? "Merge remains blocked. Software Factory Run Manager is prepare_only and does not merge pull requests."),
    );
  }
  throw new DomainError("Merge remains blocked. Software Factory Run Manager is prepare_only and does not merge pull requests.");
}

export function defaultSoftwareFactoryPacket(run: SoftwareFactoryRun): SoftwareFactoryPacket {
  return {
    schemaVersion: SOFTWARE_FACTORY_PACKET_SCHEMA_VERSION,
    STATUS: run.lifecycleStatus,
    TASK_ID: run.taskId,
    REPOSITORY: run.repository,
    BASE_BRANCH: run.baseBranch,
    OBJECTIVE: "Govern this software request without merging or deploying.",
    BACKGROUND: "Owner acceptance must be recorded outside this packet.",
    IN_SCOPE: run.frozenInScope,
    OUT_OF_SCOPE: ["Merge, deploy, secret change, or live GitHub mutation."],
    ACCEPTANCE_CRITERIA: run.frozenAcceptanceCriteria,
    VERIFICATION: [
      "Attach hashed PR, CI, and test evidence.",
      "Owner acceptance must be recorded outside this packet.",
    ],
    DEPENDENCIES: [],
    RISK: "medium",
    APPROVAL_REQUIRED: ["owner_acceptance"],
    HANDOFF_NOTES:
      "PM and Developer coordination is human-mediated because no approved Grok Bot or Cursor connector exists.",
    claimedApprovalIds: [],
  };
}
