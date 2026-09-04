import { readFileSync } from "node:fs";

const migrationPath = new URL(
  "../supabase/migrations/20260904120000_memory_control_plane_persistence_v1.sql",
  import.meta.url,
);
const proofPath = new URL(
  "../supabase/qa/memory_control_plane_v1_proof.sql",
  import.meta.url,
);
const fixtureProofPath = new URL(
  "../supabase/qa/memory_control_plane_v1_persistence_proof.sql",
  import.meta.url,
);

const migration = readFileSync(migrationPath, "utf8");
const proof = readFileSync(proofPath, "utf8");
const fixtureProof = readFileSync(fixtureProofPath, "utf8");

const requiredMigrationFragments = [
  "alter table public.operational_memory_records enable row level security",
  "alter table public.operational_memory_erasures enable row level security",
  "trg_operational_memory_record_invariants",
  "trg_operational_memory_erasure_invariants",
  "persist_operational_memory(",
  "read_operational_memories(",
  "erase_operational_memory(",
  "claim_execution_step_with_memory(",
  "memory_selected_refs",
  "current_user <> 'service_role'",
  "Every source artifact reference must resolve to the same-tenant immutable evidence artifact",
  "Memory revision must be the next append-only revision",
  "Operational memory ID was erased and cannot be reused",
  "old.memory_read_receipt_hash, old.memory_binding_hash",
  "memory_context_bound",
  "insert into public.audit_events",
  "'memory.updated'",
  "'memoryIdHash'",
];

const requiredMigrationFunctions = [
  "enforce_operational_memory_record_invariants",
  "enforce_operational_memory_erasure_invariants",
  "persist_operational_memory",
  "read_operational_memories",
  "erase_operational_memory",
  "enforce_execution_attempt_memory_binding",
  "claim_execution_step_with_memory",
];

const forbiddenMigrationFragments = [
  "grant select, insert, update, delete on public.operational_memory_records to authenticated",
  "grant all on public.operational_memory_records to authenticated",
  "create policy operational_memory_records_public",
];

const requiredProofFragments = [
  "operational_memory_records",
  "operational_memory_erasures",
  "relrowsecurity",
  "role_table_grants",
  "claim_execution_step_with_memory",
  "memory_binding_hash",
];

const requiredFixtureFragments = [
  "set local role service_role",
  "persist_operational_memory",
  "read_operational_memories",
  "erase_operational_memory",
  "latest revision",
  "transaction rolled back",
  "erased memory ID was allowed to be reused",
];

const failures = [];
for (const fragment of requiredMigrationFragments) {
  if (!migration.includes(fragment)) failures.push("Migration missing: " + fragment);
}
for (const functionName of requiredMigrationFunctions) {
  const definition = "create or replace function public." + functionName + "(";
  const count = migration.split(definition).length - 1;
  if (count !== 1) {
    failures.push("Migration must define exactly one " + functionName + " function, found " + count);
  }
}
for (const fragment of forbiddenMigrationFragments) {
  if (migration.includes(fragment)) failures.push("Migration exposes forbidden surface: " + fragment);
}
for (const fragment of requiredProofFragments) {
  if (!proof.includes(fragment)) failures.push("QA proof missing: " + fragment);
}
for (const fragment of requiredFixtureFragments) {
  if (!fixtureProof.toLowerCase().includes(fragment.toLowerCase())) {
    failures.push("Transactional QA fixture missing: " + fragment);
  }
}

const report = {
  migration: migrationPath.pathname,
  proof: proofPath.pathname,
  fixtureProof: fixtureProofPath.pathname,
  requiredMigrationFragments: requiredMigrationFragments.length,
  requiredProofFragments: requiredProofFragments.length,
  requiredFixtureFragments: requiredFixtureFragments.length,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exit(1);
