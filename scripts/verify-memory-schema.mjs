import { readFileSync } from "node:fs";

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const compatibility = read("../supabase/migrations/20260902120000_legacy_execution_plan_snapshot_compat.sql");
const runtimeSchema = read("../supabase/migrations/20260903090000_execution_runtime_v1.sql");
const runtimeIndexMigration = read(
  "../supabase/migrations/20260904160000_execution_runtime_v1_foreign_key_indexes.sql",
);
const runtimeSource = [runtimeSchema, runtimeIndexMigration].join("\n");
const runtimeFunctionFiles = [
  "20260903090001_execution_runtime_v1_functions.sql",
  "20260903090002_execution_runtime_v1_worker_functions.sql",
  "20260903090003_execution_runtime_v1_terminal_functions.sql",
  "20260903090004_execution_runtime_v1_completion.sql",
  "20260903090005_execution_runtime_v1_failure.sql",
  "20260903090006_execution_runtime_v1_reaper.sql",
  "20260903090007_execution_runtime_v1_approval.sql",
  "20260903090008_execution_runtime_v1_cancellation.sql",
].map((name) => read("../supabase/migrations/" + name));
const runtimeFunctions = runtimeFunctionFiles.join("\n");
const memoryMigration = read(
  "../supabase/migrations/20260904120000_memory_control_plane_persistence_v1.sql",
);
const memoryPatches = [
  "20260904130000_memory_control_plane_persistence_v1_recorded_by_fix.sql",
  "20260904140000_memory_control_plane_persistence_v1_ambiguity_fix.sql",
  "20260904150000_memory_control_plane_persistence_v1_scope_reference_fix.sql",
].map((name) => read("../supabase/migrations/" + name));
const memorySource = [memoryMigration, ...memoryPatches].join("\n");
const structuralProof = read("../supabase/qa/memory_control_plane_v1_proof.sql");
const persistenceProof = read("../supabase/qa/memory_control_plane_v1_persistence_proof.sql");
const runtimeProof = read("../supabase/qa/execution_runtime_v1_proof.sql");

const requiredFragments = [
  [compatibility, "alter table public.execution_plans", "legacy compatibility relation"],
  [compatibility, "execution_plan_snapshots_legacy", "legacy snapshot preservation"],
  [compatibility, "refusing to merge or overwrite data", "legacy data refusal guard"],

  [runtimeSchema, "create table public.execution_plans", "runtime plans table"],
  [runtimeSchema, "create table public.execution_plan_steps", "runtime steps table"],
  [runtimeSchema, "create table public.execution_attempts", "runtime attempts table"],
  [runtimeSchema, "create table public.execution_approval_requests", "approval table"],
  [runtimeSchema, "create table public.execution_events", "append-only event table"],
  [runtimeSchema, "alter table public.execution_events enable row level security", "runtime event RLS"],
  [runtimeSource, "execution_plans_created_by_idx", "plan FK index"],
  [runtimeSource, "execution_plan_steps_plan_org_idx", "step composite FK index"],
  [runtimeSource, "execution_attempts_plan_org_idx", "attempt composite FK index"],
  [runtimeSource, "execution_approval_plan_org_idx", "approval composite FK index"],
  [runtimeSource, "execution_events_attempt_org_idx", "event composite FK index"],

  [memorySource, "alter table public.operational_memory_records enable row level security", "memory RLS"],
  [memorySource, "alter table public.operational_memory_erasures enable row level security", "erasure RLS"],
  [memorySource, "operational_memory_records_client_deny", "explicit memory browser deny policy"],
  [memorySource, "operational_memory_erasures_client_deny", "explicit erasure browser deny policy"],
  [memorySource, "trg_operational_memory_record_invariants", "memory record invariants"],
  [memorySource, "trg_operational_memory_erasure_invariants", "erasure invariants"],
  [memorySource, "persist_operational_memory(", "memory persistence RPC"],
  [memorySource, "read_operational_memories(", "memory read RPC"],
  [memorySource, "erase_operational_memory(", "memory erasure RPC"],
  [memorySource, "claim_execution_step_with_memory(", "atomic memory binding RPC"],
  [memorySource, "memory_selected_refs", "exact selected-memory binding"],
  [memorySource, "current_user <> 'service_role'", "server-only guard"],
  [memorySource, "Every source artifact reference must resolve to the same-tenant immutable evidence artifact", "source provenance guard"],
  [memorySource, "Memory revision must be the next append-only revision", "revision lineage guard"],
  [memorySource, "Operational memory ID was erased and cannot be reused", "non-resurrection guard"],
  [memorySource, "old.memory_read_receipt_hash, old.memory_binding_hash", "binding immutability guard"],
  [memorySource, "memory_context_bound", "binding event compatibility"],
  [memorySource, "insert into public.audit_events", "audit emission"],
  [memorySource, "'memory.updated'", "memory audit action"],
  [memorySource, "'memoryIdHash'", "hashed memory identity"],

  [structuralProof, "role_table_grants", "grant proof"],
  [structuralProof, "pg_get_constraintdef", "constraint proof"],
  [persistenceProof, "set local role service_role", "transactional proof role"],
  [persistenceProof, "two persistence revisions plus erasure did not emit three audit events", "revision audit proof"],
  [persistenceProof, "erased memory ID was allowed to be reused", "non-resurrection proof"],
  [persistenceProof, "transaction rolled back", "fixture rollback documentation"],
  [runtimeFunctions, "authority_envelope->>'actionClass'", "executor authority ceiling"],
  [runtimeProof, "execution_runtime_v1_fixture", "runtime transactional proof marker"],
  [runtimeProof, "FOR UPDATE", "runtime lock proof"],
  [runtimeProof, "reap_execution_leases", "runtime reaper proof"],
  [runtimeProof, "decide_execution_approval", "runtime approval proof"],
  [runtimeProof, "prepare-only executor claimed an approved external step", "runtime authority proof"],
  [runtimeProof, "__QA_RUNTIME_PROOF_ROLLBACK__", "runtime fixture rollback marker"],
];

const runtimeFunctionNames = [
  "create_execution_plan",
  "freeze_execution_plan",
  "refresh_execution_plan_queue",
  "claim_execution_step",
  "heartbeat_execution_attempt",
  "complete_execution_attempt",
  "fail_execution_attempt",
  "reap_execution_leases",
  "decide_execution_approval",
  "cancel_execution_plan",
];
const memoryFunctionNames = [
  "enforce_operational_memory_record_invariants",
  "enforce_operational_memory_erasure_invariants",
  "persist_operational_memory",
  "read_operational_memories",
  "erase_operational_memory",
  "enforce_execution_attempt_memory_binding",
  "claim_execution_step_with_memory",
];

const failures = [];
for (const [source, fragment, label] of requiredFragments) {
  if (!source.includes(fragment)) failures.push("Missing " + label + ": " + fragment);
}
for (const functionName of runtimeFunctionNames) {
  const definition = "create or replace function public." + functionName + "(";
  const count = runtimeFunctions.split(definition).length - 1;
  if (count !== 1) {
    failures.push("Runtime must define exactly one " + functionName + ", found " + count);
  }
}
for (const functionName of memoryFunctionNames) {
  const definition = "create or replace function public." + functionName + "(";
  const count = memorySource.split(definition).length - 1;
  if (count < 1) failures.push("Memory source missing " + functionName);
}
for (const fragment of [
  "grant select, insert, update, delete on public.operational_memory_records to authenticated",
  "grant all on public.operational_memory_records to authenticated",
  "create policy operational_memory_records_public",
  "p_memory->>'recordedBy'",
  "select s, ep.executor_kind into v_step",
]) {
  if (memorySource.includes(fragment) || runtimeFunctions.includes(fragment)) {
    failures.push("Forbidden exposed or unsafe fragment: " + fragment);
  }
}
for (const fragment of [
  "p_memory #>> '{provenance,recordedBy}'",
  "v_step record;",
  "select s.*, ep.executor_kind into v_step",
  "v_canonical_body_v2",
  'revision":2',
  'supersedesHash":null',
]) {
  if (!memorySource.includes(fragment) && !runtimeFunctions.includes(fragment) && !persistenceProof.includes(fragment)) {
    failures.push("Regression guard missing: " + fragment);
  }
}
if (!structuralProof.includes("$$;")) failures.push("Structural proof must close its DO block correctly");
if (!persistenceProof.includes("memory_control_plane_v1_persistence_fixture")) {
  failures.push("Transactional proof result marker missing");
}

const report = {
  compatibilityLength: compatibility.length,
  runtimeSchemaLength: runtimeSchema.length,
  runtimeIndexLength: runtimeIndexMigration.length,
  runtimeFunctionFiles: runtimeFunctionFiles.length,
  runtimeProofLength: runtimeProof.length,
  memorySourceLength: memorySource.length,
  requiredChecks: requiredFragments.length,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exit(1);
