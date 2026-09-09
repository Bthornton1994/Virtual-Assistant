import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError, type Actor } from "@/lib/domain";
import {
  assignmentToEnvelope,
  type AssignmentToEnvelopeAssignment,
} from "@/lib/assignment-to-envelope";
import {
  ACTION_CLASSES,
  type ExecutorEnvelopeV1,
} from "@/lib/executor-envelope";
import {
  TOOL_CLASSES,
  type DelegationSpecSnapshot,
  type ExecutionContext,
  type ToolClass,
} from "@/lib/execution-context";
import { sha256Hex } from "@/lib/catalog-evidence-hash";
import { checkExecutionLease } from "@/lib/execution-runtime";
import {
  emptyObservationTrace,
  hashToolInvocationTrace,
  requireObservationPointers,
  TOOL_INVOCATION_TRACE_SCHEMA_VERSION,
  toolInvocationTraceSchema,
  validateToolInvocationTraceArtifact,
  type ObservationPointers,
  type ProductionClass,
  type ToolInvocationTrace,
} from "@/lib/tool-invocation-trace";

const ACTION_CLASS_RANK: Record<(typeof ACTION_CLASSES)[number], number> = {
  prepare_only: 0,
  low_risk_execution: 1,
  external_execution: 2,
  sensitive_execution: 3,
};

const TOOL_MINIMUM_ACTION_CLASS: Record<ToolClass, (typeof ACTION_CLASSES)[number]> = {
  public_read: "prepare_only",
  artifact_read: "prepare_only",
  artifact_write: "prepare_only",
  deterministic_validation: "prepare_only",
  repository_read: "prepare_only",
  repository_change_prepare: "prepare_only",
  external_message_draft: "prepare_only",
  external_message_send: "external_execution",
  sensitive_action: "sensitive_execution",
  credential_use: "sensitive_execution",
};

export type ExecutionBinding = {
  assignmentId: string;
  envelopeHash: string;
  contextHash: string;
  context: ExecutionContext;
  envelope: ExecutorEnvelopeV1;
};

export function snapshotDelegationSpec(input: {
  specKey: string;
  specVersion: string;
  actionClass: (typeof ACTION_CLASSES)[number];
  allowedToolClasses?: ToolClass[];
}): DelegationSpecSnapshot {
  const allowed =
    input.allowedToolClasses ??
    TOOL_CLASSES.filter(
      (toolClass) => ACTION_CLASS_RANK[input.actionClass] >= ACTION_CLASS_RANK[TOOL_MINIMUM_ACTION_CLASS[toolClass]],
    );
  const forbidden = TOOL_CLASSES.filter((toolClass) => !allowed.includes(toolClass));
  return {
    specKey: input.specKey,
    specVersion: input.specVersion,
    actionClass: input.actionClass,
    allowedToolClasses: allowed,
    forbiddenToolClasses: forbidden,
    requiresHumanApproval:
      input.actionClass === "external_execution" || input.actionClass === "sensitive_execution",
    mayOwnAuthoritativeState: false,
  };
}

export function translateWorkCellAssignment(
  assignment: AssignmentToEnvelopeAssignment,
  spec: DelegationSpecSnapshot,
  inputArtifactRefs: ExecutorEnvelopeV1["inputArtifactRefs"],
): ExecutionBinding {
  const translated = assignmentToEnvelope(assignment, spec, inputArtifactRefs);
  if (!translated.ok) {
    throw new DomainError("Execution context translation failed: " + translated.failures.join(" "));
  }
  return {
    assignmentId: translated.value.assignmentId,
    envelopeHash: translated.value.envelopeHash,
    contextHash: translated.value.contextHash,
    context: translated.value.context,
    envelope: translated.value.envelope,
  };
}

export function buildRequiredEmptyTrace(
  productionClass: Extract<ProductionClass, "operator_submitted" | "deterministic_validation_no_tools">,
  binding: ExecutionBinding,
  supplied?: unknown,
): ToolInvocationTrace {
  if (supplied === undefined) {
    const explicit = emptyObservationTrace({
      productionClass,
      assignmentId: binding.assignmentId,
      envelopeHash: binding.envelopeHash,
      contextHash: binding.contextHash,
    });
    const checked = validateToolInvocationTraceArtifact(explicit, binding.context, {
      productionClass,
      assignmentId: binding.assignmentId,
      envelopeHash: binding.envelopeHash,
      contextHash: binding.contextHash,
    });
    if (!checked.ok) {
      throw new DomainError("Explicit empty observation trace is invalid: " + checked.failures.join(" "));
    }
    return checked.value;
  }

  const checked = validateToolInvocationTraceArtifact(supplied, binding.context, {
    productionClass,
    assignmentId: binding.assignmentId,
    envelopeHash: binding.envelopeHash,
    contextHash: binding.contextHash,
  });
  if (!checked.ok) {
    throw new DomainError("Observation trace is invalid: " + checked.failures.join(" "));
  }
  if (checked.value.invocations.length > 0) {
    throw new DomainError("This production class rejects Delegation Cloud tool invocations.");
  }
  return checked.value;
}

export function mergeObservationPointers(
  existing: Record<string, unknown>,
  pointers: ObservationPointers,
): Record<string, unknown> {
  return {
    ...existing,
    assignmentId: pointers.assignmentId,
    envelopeHash: pointers.envelopeHash,
    contextHash: pointers.contextHash,
    traceContentHash: pointers.traceContentHash,
  };
}

export async function loadObservationTrace(
  db: SupabaseClient,
  runId: string,
  assignmentId: string,
): Promise<{ id: string; contentHash: string; payload: ToolInvocationTrace } | null> {
  const { data, error } = await db
    .from("evidence_artifacts")
    .select("id, content_hash, payload, kind")
    .eq("run_id", runId)
    .eq("kind", "observation")
    .eq("payload->>schemaVersion", TOOL_INVOCATION_TRACE_SCHEMA_VERSION)
    .eq("payload->>assignmentId", assignmentId)
    .order("created_at", { ascending: true });
  if (error) throw new DomainError(error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: String(row.id),
    contentHash: String(row.content_hash ?? ""),
    payload: row.payload as ToolInvocationTrace,
  };
}

export async function persistObservationArtifact(
  db: SupabaseClient,
  actor: Actor,
  run: { id: string; organization_id: string },
  trace: ToolInvocationTrace,
): Promise<{ artifactId: string; contentHash: string; pointers: ObservationPointers }> {
  const contentHash = hashToolInvocationTrace(trace);
  const existing = await loadObservationTrace(db, run.id, trace.assignmentId);
  if (existing) {
    if (existing.contentHash !== contentHash || sha256Hex(existing.payload) !== contentHash) {
      throw new DomainError(
        "A second observation for this frozen assignment identity would insert. Observation traces are insert-only and idempotent.",
      );
    }
    return {
      artifactId: existing.id,
      contentHash: existing.contentHash,
      pointers: {
        assignmentId: trace.assignmentId,
        envelopeHash: trace.envelopeHash,
        contextHash: trace.contextHash,
        traceContentHash: existing.contentHash,
      },
    };
  }

  const { data, error } = await db
    .from("evidence_artifacts")
    .insert({
      organization_id: run.organization_id,
      run_id: run.id,
      kind: "observation",
      summary: "Tool invocation observation trace v1.",
      source_uri: null,
      content_hash: contentHash,
      payload: trace,
      created_by: actor.id,
    })
    .select("id, content_hash")
    .single();
  if (error) throw new DomainError(error.message);
  return {
    artifactId: String(data.id),
    contentHash: String(data.content_hash),
    pointers: {
      assignmentId: trace.assignmentId,
      envelopeHash: trace.envelopeHash,
      contextHash: trace.contextHash,
      traceContentHash: String(data.content_hash),
    },
  };
}

const WORK_CELL_PHASES = ["prepare", "review", "validate"] as const;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const LEASE_SECRET_KEYS = ["workerId", "leaseToken", "leaseTokenHash", "tokenHash"] as const;

export type WorkCellPhaseName = (typeof WORK_CELL_PHASES)[number];

export type BoundObservationRow = {
  organizationId: string;
  runId: string;
  kind: string;
  contentHash: string;
  payload: unknown;
};

export type WorkCellPersistGateInput = {
  organizationId: string;
  runId: string;
  phase: WorkCellPhaseName;
  executorKey: string;
  capabilityKey: string;
  specActionClass: (typeof ACTION_CLASSES)[number];
  assignmentActionClass?: (typeof ACTION_CLASSES)[number] | null;
  metadata: Record<string, unknown>;
  observation: BoundObservationRow | null;
};

export type LeasedCompleteGateInput = {
  attempt: {
    status: string;
    organizationId: string;
    runId: string;
    workerId: string;
    leaseTokenHash: string;
    leaseExpiresAt: string;
    contextHash: string | null;
    envelopeHash: string | null;
    stepLeaseWorkerId?: string | null;
  };
  caller: {
    attemptId: string;
    stepKey: string;
    workerId: string;
    leaseTokenHash: string;
    now: string;
    metadata: Record<string, unknown>;
    outputArtifactIds: string[];
  };
  observation: BoundObservationRow | null;
  context: ExecutionContext;
  expectedAssignmentId: string;
  expectedEnvelopeHash: string;
  expectedContextHash: string;
};

function metadataHasLeaseSecret(metadata: Record<string, unknown>): boolean {
  return LEASE_SECRET_KEYS.some((key) => key in metadata);
}

function productionClassForPhase(phase: WorkCellPhaseName, productionClass: string): boolean {
  if (phase === "prepare") {
    return productionClass === "operator_submitted" || productionClass === "native_tool_execution";
  }
  if (phase === "review") return productionClass === "operator_submitted";
  return productionClass === "deterministic_validation_no_tools";
}

export function workCellPersistIdentity(input: {
  organizationId: string;
  runId: string;
  phase: WorkCellPhaseName;
  executorKey: string;
  capabilityKey: string;
}): Record<string, string> {
  return {
    organizationId: input.organizationId,
    runId: input.runId,
    phase: input.phase,
    executorKey: input.executorKey,
    capabilityKey: input.capabilityKey,
  };
}

/**
 * Same predicates the work-cell persist RPC must fail-close on.
 * Work-cell paste is operator_submitted: no worker, lease, or token.
 * Lease expiry is enforced on leased complete, not on paste ingest.
 */
export function assertWorkCellPhasePersistAllowed(input: WorkCellPersistGateInput): ObservationPointers {
  if (metadataHasLeaseSecret(input.metadata)) {
    throw new DomainError("Work-cell persistence must not invent worker, lease, or token fields.");
  }

  const pointers = requireObservationPointers(input.metadata);
  if (!pointers.ok) {
    throw new DomainError(pointers.failures.join(" "));
  }

  const identity = workCellPersistIdentity(input);
  if (input.metadata.organizationId !== identity.organizationId) {
    throw new DomainError("Work-cell persistence organizationId does not match the Workstream Run tenant.");
  }
  if (input.metadata.runId !== identity.runId) {
    throw new DomainError("Work-cell persistence runId does not match the Workstream Run.");
  }
  if (input.metadata.phase !== identity.phase) {
    throw new DomainError("Work-cell persistence phase does not match the assignment phase.");
  }
  if (input.metadata.executorKey !== identity.executorKey) {
    throw new DomainError("Work-cell persistence executorKey does not match the assigned executor.");
  }
  if (input.metadata.capabilityKey !== identity.capabilityKey) {
    throw new DomainError("Work-cell persistence capabilityKey does not match the assigned capability.");
  }

  if (
    input.assignmentActionClass &&
    ACTION_CLASS_RANK[input.assignmentActionClass] > ACTION_CLASS_RANK[input.specActionClass]
  ) {
    throw new DomainError("Work-cell persistence action class exceeds the Delegation Spec ceiling.");
  }

  const observation = input.observation;
  if (!observation) {
    throw new DomainError("Work-cell persistence requires a same-organization, same-run observation trace.");
  }
  if (observation.kind !== "observation") {
    throw new DomainError("Work-cell persistence requires a same-organization, same-run observation trace.");
  }
  if (observation.organizationId !== input.organizationId || observation.runId !== input.runId) {
    throw new DomainError("Observation trace is not bound to this organization and Workstream Run.");
  }
  if (observation.contentHash !== pointers.value.traceContentHash) {
    throw new DomainError("Observation trace content hash does not match the bound pointer.");
  }

  const parsed = toolInvocationTraceSchema.safeParse(observation.payload);
  if (!parsed.success) {
    throw new DomainError("Work-cell observation is not a validated Execution Context trace.");
  }
  if (hashToolInvocationTrace(parsed.data) !== observation.contentHash) {
    throw new DomainError("Observation content hash does not match the recomputed trace hash.");
  }
  if (
    parsed.data.assignmentId !== pointers.value.assignmentId ||
    parsed.data.contextHash !== pointers.value.contextHash ||
    parsed.data.envelopeHash !== pointers.value.envelopeHash
  ) {
    throw new DomainError("Observation hashes do not match the frozen envelope and context.");
  }
  if (!productionClassForPhase(input.phase, parsed.data.productionClass)) {
    throw new DomainError("Observation production class is not valid for this work-cell phase.");
  }
  return pointers.value;
}

export function requireCompleteMetadataHashes(
  metadata: Record<string, unknown>,
  stored: { contextHash: string; envelopeHash: string },
): ObservationPointers {
  const pointers = requireObservationPointers(metadata);
  if (!pointers.ok) {
    throw new DomainError(
      "Completion requires contextHash, envelopeHash, assignmentId, and traceContentHash. Omitted hashes are not skipped.",
    );
  }
  if (pointers.value.contextHash !== stored.contextHash) {
    throw new DomainError("Caller metadata contextHash does not match the stored context hash.");
  }
  if (pointers.value.envelopeHash !== stored.envelopeHash) {
    throw new DomainError("Caller metadata envelopeHash does not match the stored envelope hash.");
  }
  return pointers.value;
}

/**
 * Same predicates leased complete must fail-close on in TypeScript and SQL.
 * Lease expiry applies here, not to work-cell operator paste.
 */
export function assertLeasedCompleteAllowed(input: LeasedCompleteGateInput): ObservationPointers {
  if (input.attempt.status !== "running") {
    throw new DomainError("Execution attempt is not running; cancelled, expired, or taken-over attempts cannot complete.");
  }
  if (
    input.attempt.stepLeaseWorkerId != null &&
    input.attempt.stepLeaseWorkerId !== input.caller.workerId
  ) {
    throw new DomainError("Execution attempt is not running; cancelled, expired, or taken-over attempts cannot complete.");
  }
  if (!input.attempt.contextHash || !SHA256_HEX.test(input.attempt.contextHash)) {
    throw new DomainError("Execution attempt is missing a stored context hash.");
  }
  if (!input.attempt.envelopeHash || !SHA256_HEX.test(input.attempt.envelopeHash)) {
    throw new DomainError("Execution attempt is missing a stored envelope hash.");
  }
  if (input.attempt.contextHash !== input.expectedContextHash) {
    throw new DomainError("Recomputed execution context hash does not match the stored context hash.");
  }
  if (input.attempt.envelopeHash !== input.expectedEnvelopeHash) {
    throw new DomainError("Recomputed executor envelope hash does not match the stored envelope hash.");
  }

  const leaseCheck = checkExecutionLease(
    {
      attemptId: input.caller.attemptId,
      stepKey: input.caller.stepKey,
      workerId: input.attempt.workerId,
      leaseTokenHash: input.attempt.leaseTokenHash,
      leaseExpiresAt: input.attempt.leaseExpiresAt,
    },
    {
      attemptId: input.caller.attemptId,
      stepKey: input.caller.stepKey,
      workerId: input.caller.workerId,
      leaseTokenHash: input.caller.leaseTokenHash,
    },
    input.caller.now,
  );
  if (!leaseCheck.ok) {
    throw new DomainError("Execution lease check failed: " + leaseCheck.reason);
  }

  const pointers = requireCompleteMetadataHashes(input.caller.metadata, {
    contextHash: input.attempt.contextHash,
    envelopeHash: input.attempt.envelopeHash,
  });
  if (pointers.assignmentId !== input.expectedAssignmentId) {
    throw new DomainError("Completion assignmentId does not match the frozen execution-step assignment.");
  }
  if (pointers.contextHash !== input.expectedContextHash || pointers.envelopeHash !== input.expectedEnvelopeHash) {
    throw new DomainError("Completion hashes do not match the recomputed execution context.");
  }

  const observation = input.observation;
  if (!observation) {
    throw new DomainError("Completion requires a bound observation trace artifact for leased execution.");
  }
  if (
    observation.kind !== "observation" ||
    observation.organizationId !== input.attempt.organizationId ||
    observation.runId !== input.attempt.runId
  ) {
    throw new DomainError("Observation trace is not bound to this organization and Workstream Run.");
  }
  if (!input.caller.outputArtifactIds.length) {
    throw new DomainError("Completion requires a bound observation trace artifact for leased execution.");
  }

  const context = input.context;
  if (context.contextHash !== input.expectedContextHash) {
    throw new DomainError("Recomputed execution context hash does not match the stored context hash.");
  }

  const checked = validateToolInvocationTraceArtifact(observation.payload, context, {
    productionClass: "leased_executor_execution",
    assignmentId: input.expectedAssignmentId,
    envelopeHash: input.expectedEnvelopeHash,
    contextHash: input.expectedContextHash,
  });
  if (!checked.ok) {
    throw new DomainError("Leased observation is not a validated Execution Context trace: " + checked.failures.join(" "));
  }
  const recomputed = hashToolInvocationTrace(checked.value);
  if (recomputed !== observation.contentHash || recomputed !== pointers.traceContentHash) {
    throw new DomainError("Observation content hash does not match the recomputed trace hash.");
  }
  if (checked.value.assignmentId !== input.expectedAssignmentId) {
    throw new DomainError("Observation assignmentId does not match the frozen execution-step assignment.");
  }
  return pointers;
}

export async function assertObservationBound(
  db: SupabaseClient,
  run: { id: string; organization_id: string },
  metadata: Record<string, unknown>,
): Promise<ObservationPointers> {
  const pointers = requireObservationPointers(metadata);
  if (!pointers.ok) {
    throw new DomainError(pointers.failures.join(" "));
  }

  const existing = await loadObservationTrace(db, run.id, pointers.value.assignmentId);
  if (!existing) {
    throw new DomainError("Missing observation trace is not an empty trace.");
  }
  if (existing.contentHash !== pointers.value.traceContentHash) {
    throw new DomainError("Observation trace content hash does not match the bound pointer.");
  }
  if (
    existing.payload.envelopeHash !== pointers.value.envelopeHash ||
    existing.payload.contextHash !== pointers.value.contextHash
  ) {
    throw new DomainError("Observation trace hashes do not match the frozen envelope and context.");
  }

  const { data, error } = await db
    .from("evidence_artifacts")
    .select("organization_id, run_id, kind")
    .eq("id", existing.id)
    .maybeSingle();
  if (error) throw new DomainError(error.message);
  if (
    !data ||
    String(data.organization_id) !== run.organization_id ||
    String(data.run_id) !== run.id ||
    String(data.kind) !== "observation"
  ) {
    throw new DomainError("Observation trace is not bound to this organization and Workstream Run.");
  }
  return pointers.value;
}
