import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AuthzError,
  DomainError,
  assertOrgAccess,
  isManagerRole,
  type Actor,
} from "@/lib/domain";
import { canonicalJsonStringify } from "@/lib/catalog-evidence-hash";
import {
  bindMemoryContextToExecution,
  type MemoryExecutionBinding,
} from "@/lib/memory-execution-binding";
import {
  compileMemoryContext,
  memoryAccessRequestSchema,
  type MemoryCompilationResult,
} from "@/lib/memory-control-plane";
import {
  createOperationalMemory,
  validateOperationalMemory,
  type OperationalMemory,
  type OperationalMemoryInput,
} from "@/lib/operational-memory";
import { supabaseAdmin } from "@/lib/supabase/admin";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

type MemoryRow = Record<string, unknown>;

export type MemoryPersistenceEnvelope = {
  memory: OperationalMemory;
  canonicalBody: string;
};

export type PersistedOperationalMemory = {
  recordId: string;
  organizationId: string;
  memoryId: string;
  revision: number;
  memoryHash: string;
};

export type OperationalMemoryErasure = {
  erasureId: string;
  erasedRevisionCount: number;
};

/**
 * Builds the exact bytes sent to the database persistence RPC.
 *
 * The database receives the full validated memory plus the hash-excluded
 * canonical body. Capture callers may send a body without a digest; this
 * boundary computes it. If a caller supplies a digest, it must still validate
 * against the canonical body so no caller can override the database verifier.
 */
export function memoryPersistenceEnvelope(input: unknown): MemoryPersistenceEnvelope {
  const hasSuppliedHash =
    typeof input === "object" &&
    input !== null &&
    Object.prototype.hasOwnProperty.call(input, "memoryHash");
  const checked = hasSuppliedHash
    ? validateOperationalMemory(input)
    : createOperationalMemory(input as OperationalMemoryInput);
  if (!checked.ok) {
    throw new DomainError(
      "Cannot persist invalid operational memory: " + checked.failures.join(" "),
    );
  }

  const { memoryHash: _memoryHash, ...body } = checked.value;
  return {
    memory: checked.value,
    canonicalBody: canonicalJsonStringify(body),
  };
}

function memoryDb(): SupabaseClient {
  const db = supabaseAdmin();
  if (!db) {
    throw new DomainError(
      "Operational memory persistence requires a verified server-side Supabase service-role client.",
    );
  }
  return db;
}

function requireUuid(value: string, label: string) {
  if (!UUID_PATTERN.test(value)) {
    throw new DomainError(label + " must be a UUID at the persistence boundary.");
  }
}

function requireIdentifier(value: string, label: string) {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new DomainError(label + " must be a bounded identifier.");
  }
}

function requirePersistentActor(actor: Actor) {
  if (actor.source === "demo") {
    throw new DomainError("Operational memory persistence is disabled in demo mode.");
  }
}

function authorizeMemoryWrite(actor: Actor | undefined, memory: OperationalMemory) {
  requireUuid(memory.scope.organizationId, "memory.scope.organizationId");
  if (!actor) {
    if (memory.status !== "candidate") {
      throw new AuthzError(
        "Non-candidate memory transitions require an authenticated operations manager.",
      );
    }
    return;
  }

  requirePersistentActor(actor);
  assertOrgAccess(actor, memory.scope.organizationId);
  if (memory.status !== "candidate" && !isManagerRole(actor.role)) {
    throw new AuthzError(
      "Only an operations manager can persist verified, conflicted, expired, invalidated, or archived memory.",
    );
  }
}

/**
 * Persists one validated memory revision.
 *
 * The database RPC verifies the source artifact IDs, schema versions, hashes,
 * tenant ownership, and append-only revision lineage in one transaction.
 * Candidates are allowed for shadow evaluation; final-state transitions require
 * an operations manager when an actor is supplied.
 */
export async function persistOperationalMemory(
  input: unknown,
  actor?: Actor,
): Promise<PersistedOperationalMemory> {
  const envelope = memoryPersistenceEnvelope(input);
  authorizeMemoryWrite(actor, envelope.memory);

  const db = memoryDb();
  const { data, error } = await db.rpc("persist_operational_memory", {
    p_memory: envelope.memory,
    p_canonical_body: envelope.canonicalBody,
  });
  if (error) throw new DomainError(error.message || "Could not persist operational memory.");

  const row = (Array.isArray(data) ? data[0] : data) as MemoryRow | null;
  if (!row?.record_id || !row.organization_id || !row.memory_id || !row.revision || !row.memory_hash) {
    throw new DomainError("The memory persistence RPC did not return a complete record.");
  }

  return {
    recordId: String(row.record_id),
    organizationId: String(row.organization_id),
    memoryId: String(row.memory_id),
    revision: Number(row.revision),
    memoryHash: String(row.memory_hash),
  };
}

/**
 * Loads only the latest non-erased revision for each memory ID.
 *
 * This calls a database RPC rather than reading the table directly so future
 * server callers cannot accidentally reintroduce old revisions or erased
 * payloads into the deterministic compiler.
 */
export async function loadOperationalMemories(
  actor: Actor,
  organizationId: string,
): Promise<OperationalMemory[]> {
  requirePersistentActor(actor);
  requireUuid(organizationId, "organizationId");
  assertOrgAccess(actor, organizationId);

  const db = memoryDb();
  const { data, error } = await db.rpc("read_operational_memories", {
    p_organization_id: organizationId,
    p_limit: 10000,
  });
  if (error) throw new DomainError(error.message || "Could not read operational memory.");

  const rows = (Array.isArray(data) ? data : data ? [data] : []) as MemoryRow[];
  return rows.map((row, index) => {
    const checked = validateOperationalMemory(row.memory_payload);
    if (!checked.ok) {
      throw new DomainError(
        "Stored operational memory row " +
          index +
          " failed validation: " +
          checked.failures.join(" "),
      );
    }
    if (checked.value.scope.organizationId !== organizationId) {
      throw new DomainError(
        "Stored operational memory row " + index + " crossed the organization boundary.",
      );
    }
    return checked.value;
  });
}

/**
 * Compiles a deterministic read from the latest persisted memory snapshot.
 */
export async function compilePersistedMemoryContext(
  actor: Actor,
  requestInput: unknown,
): Promise<MemoryCompilationResult> {
  const parsed = memoryAccessRequestSchema.safeParse(requestInput);
  if (!parsed.success) {
    throw new DomainError("Invalid memory access request.");
  }
  requirePersistentActor(actor);
  requireUuid(parsed.data.organizationId, "request.organizationId");
  assertOrgAccess(actor, parsed.data.organizationId);

  const memories = await loadOperationalMemories(actor, parsed.data.organizationId);
  return compileMemoryContext(parsed.data, memories);
}

/**
 * Compiles and binds persisted memory to one exact execution context.
 *
 * A blocked, shadow, candidate, tampered, or cross-run context never produces a
 * binding. The resulting binding can be passed to claimExecutionStep, whose
 * database wrapper records it atomically with the lease claim.
 */
export async function bindPersistedMemoryContext(
  actor: Actor,
  executionContextInput: unknown,
  requestInput: unknown,
): Promise<MemoryExecutionBinding> {
  const compiled = await compilePersistedMemoryContext(actor, requestInput);
  if (!compiled.ok) {
    throw new DomainError(
      "Memory context could not be bound: " + compiled.failures.join(" "),
    );
  }

  const binding = bindMemoryContextToExecution(executionContextInput, compiled.context);
  if (!binding.ok) {
    throw new DomainError(
      "Memory execution binding failed: " + binding.failures.join(" "),
    );
  }
  return binding.value;
}

/**
 * Erases every persisted revision for one memory ID.
 *
 * The database retains only a non-sensitive tombstone containing hashes and
 * counts. Source evidence artifacts are not deleted here because they may be
 * shared with other work; their own retention/erasure policy must be applied
 * separately.
 */
export async function eraseOperationalMemory(
  actor: Actor,
  organizationId: string,
  memoryId: string,
  reason: string,
): Promise<OperationalMemoryErasure> {
  requirePersistentActor(actor);
  requireUuid(organizationId, "organizationId");
  requireIdentifier(memoryId, "memoryId");
  if (!reason.trim() || reason.length > 2000) {
    throw new DomainError(
      "Erasure reason must be a non-empty string of at most 2000 characters.",
    );
  }
  if (!isManagerRole(actor.role)) {
    throw new AuthzError("Only an operations manager can erase operational memory.");
  }
  assertOrgAccess(actor, organizationId);

  const db = memoryDb();
  const { data, error } = await db.rpc("erase_operational_memory", {
    p_organization_id: organizationId,
    p_memory_id: memoryId,
    p_reason: reason.trim(),
    p_requested_by: actor.id,
  });
  if (error) throw new DomainError(error.message || "Could not erase operational memory.");

  const row = (Array.isArray(data) ? data[0] : data) as MemoryRow | null;
  if (!row?.erasure_id || row.erased_revision_count === undefined) {
    throw new DomainError("The memory erasure RPC did not return a complete result.");
  }

  return {
    erasureId: String(row.erasure_id),
    erasedRevisionCount: Number(row.erased_revision_count),
  };
}
