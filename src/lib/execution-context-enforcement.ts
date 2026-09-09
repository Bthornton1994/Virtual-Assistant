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
import {
  emptyObservationTrace,
  hashToolInvocationTrace,
  requireObservationPointers,
  TOOL_INVOCATION_TRACE_SCHEMA_VERSION,
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
