import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canonicalJsonStringify, sha256Hex } from "@/lib/catalog-evidence-hash";
import { stableWorkCellAssignmentId, stableExecutionStepAssignmentId } from "@/lib/assignment-to-envelope";
import { hashToolInvocationTrace } from "@/lib/tool-invocation-trace";
import {
  CANONICAL_JSON_PARITY_FIXTURES,
  EMPTY_OPERATOR_TRACE,
  emptyOperatorTraceHash,
  fixtureCanonicalStrings,
} from "@/lib/__tests__/canonical-json-parity-fixtures";

const MIGRATION = resolve(
  process.cwd(),
  "supabase/migrations/20260909190000_execution_context_sql_hardening_v1.sql",
);
const PARENT = resolve(
  process.cwd(),
  "supabase/migrations/20260909180000_execution_context_enforcement_v1.sql",
);
const QA = resolve(process.cwd(), "supabase/qa/execution_context_sql_hardening_proof.sql");
const DOC = resolve(process.cwd(), "docs/EXECUTION-CONTEXT-SQL-HARDENING-V1.md");
const ENFORCEMENT = resolve(process.cwd(), "src/lib/execution-context-enforcement.ts");

const sql = readFileSync(MIGRATION, "utf8");
const parent = readFileSync(PARENT, "utf8");
const qa = readFileSync(QA, "utf8");
const doc = readFileSync(DOC, "utf8");
const persist = sql.slice(sql.lastIndexOf("create or replace function public.record_work_cell_phase_artifact"));
const complete = sql.slice(
  sql.lastIndexOf("create or replace function public.complete_execution_attempt"),
  sql.lastIndexOf("create or replace function public.record_work_cell_phase_artifact"),
);
const helper = sql.slice(
  sql.indexOf("create or replace function public.persist_tool_invocation_observation"),
  sql.indexOf("create or replace function public.enforce_tool_invocation_trace_observation"),
);
const trigger = sql.slice(sql.indexOf("create or replace function public.enforce_tool_invocation_trace_observation"));

describe("execution context SQL hardening v1", () => {
  it("1. fabricated observation with matching schemaVersion, 64-hex hash, and pointers is not accepted on shape alone", () => {
    expect(sql).toMatch(/tool_invocation_trace_struct_valid/);
    expect(persist).toMatch(/assert_tool_invocation_trace_struct/);
    expect(sql).toMatch(/Observation payload failed the tool-invocation-trace\/v1 structural contract/);
    expect(sql).not.toMatch(/create or replace function public\.(canonical_json_stringify|hash_tool_invocation_trace)/);
    expect(sql).not.toMatch(/digest\([^)]*jsonb::text/);
  });

  it("2. hash-shape-only validator is not treated as provenance", () => {
    expect(sql).toMatch(/SQL does NOT recompute canonicalJsonStringify \+ sha256/);
    expect(sql).toMatch(/SQL does not recompute the canonical hash/);
    expect(doc).toMatch(/does not recompute the canonical content hash in SQL/);
    expect(doc).toMatch(/No claim that SQL independently recomputes/);
  });

  it("3. unsupported direct authenticated observation INSERT is fail-closed", () => {
    expect(trigger).toMatch(/Unsupported direct authenticated observation insertion is fail-closed/);
    expect(trigger).toMatch(/delegation\.observation_persist_approved/);
    expect(trigger).toMatch(/current_user <> 'service_role'/);
  });

  it("4. persistObservationArtifact is the approved TS path and calls the persist helper", () => {
    const source = readFileSync(ENFORCEMENT, "utf8");
    expect(source).toMatch(/rpc\("persist_tool_invocation_observation"/);
    expect(source).toMatch(/it does not recompute that hash/);
    expect(helper).toMatch(/security invoker/);
    expect(helper).toMatch(/created_by must match the authenticated caller/);
  });

  it("5. null observation content_hash is rejected", () => {
    expect(trigger).toMatch(/new\.content_hash is null or new\.content_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(helper).toMatch(/p_content_hash is null or p_content_hash !~ '\^\[0-9a-f\]\{64\}\$'/);
  });

  it("6. non-64-hex observation content_hash is rejected", () => {
    expect(sql).toMatch(/Observation content_hash must be a 64-character lowercase hex digest/);
    expect(sql).toMatch(/\^\[0-9a-f\]\{64\}\$/);
  });

  it("7. schemaVersion other than tool-invocation-trace\/v1 is not treated as a bound observation", () => {
    expect(persist).toMatch(/e\.payload->>'schemaVersion' = 'tool-invocation-trace\/v1'/);
    expect(sql).toMatch(/p_payload->>'schemaVersion' is distinct from 'tool-invocation-trace\/v1'/);
  });

  it("8. shared fixtures prove TS key-order canonicalization without claiming SQL hash parity", () => {
    const keyed = CANONICAL_JSON_PARITY_FIXTURES.find((item) => item.name === "key order is sorted");
    expect(keyed).toBeTruthy();
    expect(canonicalJsonStringify(keyed?.value)).toBe('{"a":"first","m":"middle","z":"last"}');
    expect(sql).not.toMatch(/create or replace function public\.canonical_json/);
  });

  it("9. empty arrays are valid for operator_submitted and hash stably in TS", () => {
    expect(EMPTY_OPERATOR_TRACE.invocations).toEqual([]);
    expect(EMPTY_OPERATOR_TRACE.outcomes).toEqual([]);
    expect(emptyOperatorTraceHash()).toMatch(/^[0-9a-f]{64}$/);
    expect(emptyOperatorTraceHash()).toBe(hashToolInvocationTrace(EMPTY_OPERATOR_TRACE));
    expect(sql).toMatch(/v_class in \('operator_submitted', 'deterministic_validation_no_tools'\)/);
    expect(sql).toMatch(/jsonb_array_length\(p_payload->'invocations'\) <> 0/);
  });

  it("10. nested invocation objects must satisfy the contract", () => {
    expect(sql).toMatch(/schemaVersion' is distinct from 'execution-context\/v1'/);
    expect(sql).toMatch(/toolClass' not in \(/);
    expect(sql).toMatch(/failureCode' is distinct from 'tool_class_not_authorized'/);
    expect(sql).toMatch(/blocked_preflight/);
    const nested = CANONICAL_JSON_PARITY_FIXTURES.find((item) => item.name === "nested invocation object");
    expect(canonicalJsonStringify(nested?.value)).toContain('"invocations":[');
  });

  it("11. authenticated work-cell consume requires observation created_by = auth.uid()", () => {
    expect(persist).toMatch(/current_user <> 'service_role' and v_observation\.created_by is distinct from auth\.uid\(\)/);
    expect(persist).toMatch(/can only consume an observation created by the authenticated caller/);
  });

  it("12. migration and docs refuse a SQL hash-recompute claim", () => {
    expect(sql).toMatch(/does not hash the payload/i);
    expect(doc).toMatch(/TypeScript hashes observation traces/);
    expect(qa).toMatch(/SQL must not claim a canonical hash helper without proven Node parity/);
    const fixtures = fixtureCanonicalStrings();
    expect(fixtures).toHaveLength(CANONICAL_JSON_PARITY_FIXTURES.length);
    for (const fixture of fixtures) {
      expect(fixture.canonical).not.toMatch(/:\s/);
      expect(fixture.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("13. persistence UUID assignmentId is rejected", () => {
    expect(persist).toMatch(/v_assignment_id_ptr ~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/);
    expect(persist).toMatch(/not a persistence UUID or arbitrary string/);
  });

  it("14. empty or non-hex assignmentId is rejected", () => {
    expect(persist).toMatch(/v_assignment_id_ptr !~ '\^\[0-9a-f\]\{64\}\$'/);
    expect(persist).toMatch(/frozen 64-hex digest from stableWorkCellAssignmentId/);
  });

  it("15. executorKey must match the selected executor profile", () => {
    expect(persist).toMatch(/p_assignment_metadata->>'executorKey' is distinct from v_profile_key/);
    expect(persist).toMatch(/executorKey does not match the assigned executor/);
  });

  it("16. capabilityKey must belong to the assigned profile", () => {
    expect(persist).toMatch(/executor_profile_owns_active_capability/);
    expect(sql).toMatch(/ec\.executor_profile_id = p_executor_profile_id/);
    expect(sql).toMatch(/c\.key = p_capability_key/);
  });

  it("17. capability must be active and qualified", () => {
    expect(sql).toMatch(/c\.status = 'active'/);
    expect(sql).toMatch(/ec\.qualification_status = 'qualified'/);
    expect(sql).toMatch(/ec\.suspended_at is null/);
  });

  it("18. capability must be valid for the phase", () => {
    expect(sql).toMatch(/work_cell_capability_allowed_for_phase/);
    expect(sql).toMatch(/p_phase = 'prepare' and p_capability_key in \(/);
    expect(sql).toMatch(/evidence_research', 'public_web_retrieval', 'supplier_sourcing'/);
    expect(sql).toMatch(/independent_evidence_review', 'supplier_sourcing'/);
    expect(sql).toMatch(/deterministic_catalog_validation', 'deterministic_supplier_sourcing_validation'/);
    expect(persist).toMatch(/capabilityKey is not valid for this phase/);
  });

  it("19. organizationId must match the Workstream Run tenant", () => {
    expect(persist).toMatch(/organizationId does not match the Workstream Run tenant/);
  });

  it("20. runId must match the Workstream Run", () => {
    expect(persist).toMatch(/runId does not match the Workstream Run/);
  });

  it("21. phase must match the assignment phase", () => {
    expect(persist).toMatch(/phase does not match the assignment phase/);
  });

  it("22. observation production class must be valid for the phase", () => {
    expect(persist).toMatch(/p_phase = 'prepare' and e\.payload->>'productionClass' in \('operator_submitted', 'native_tool_execution'\)/);
    expect(persist).toMatch(/p_phase = 'review' and e\.payload->>'productionClass' = 'operator_submitted'/);
    expect(persist).toMatch(/p_phase = 'validate' and e\.payload->>'productionClass' = 'deterministic_validation_no_tools'/);
  });

  it("23. authority snapshot cannot exceed the Delegation Spec", () => {
    expect(persist).toMatch(/action class exceeds the Delegation Spec ceiling/);
    expect(persist).toMatch(/v_assignment_rank > v_spec_rank/);
  });

  it("24. mayOwnAuthoritativeState remains false", () => {
    expect(persist).toMatch(/mayOwnAuthoritativeState must remain false/);
    expect(persist).toMatch(/v_owns_state is distinct from 'false'/);
  });

  it("25. worker, lease, token, and secret fields are rejected on operator-submitted work-cell records", () => {
    expect(persist).toMatch(/must not invent worker, lease, token, or secret fields/);
    expect(persist).toMatch(/p_assignment_metadata \? 'apiKey'/);
    expect(persist).toMatch(/p_authority_snapshot \? 'leaseToken'/);
  });

  it("26. claim, complete, and fail are not executable by authenticated or anon", () => {
    expect(sql).toMatch(
      /revoke all on function public\.claim_execution_step\(text, text, text, text, text, integer\) from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.complete_execution_attempt\(uuid, text, text, jsonb, jsonb, numeric, bigint, bigint\) from public, anon, authenticated/,
    );
    expect(sql).toMatch(
      /revoke all on function public\.fail_execution_attempt\(uuid, text, text, text, text, text, jsonb, numeric, bigint, bigint, boolean\) from public, anon, authenticated/,
    );
    expect(qa).toMatch(/claim_execution_step must be service_role only/);
    expect(qa).toMatch(/has_function_privilege\('authenticated'/);
  });

  it("27. complete requires stored hashes and matching caller metadata", () => {
    expect(complete).toMatch(/missing a stored context hash/);
    expect(complete).toMatch(/missing a stored envelope hash/);
    expect(complete).toMatch(/contextHash equal to the stored context hash/);
    expect(complete).toMatch(/envelopeHash equal to the stored envelope hash/);
    expect(complete).toMatch(/Stored hashes are never overwritten/);
    expect(complete).not.toMatch(/context_hash = /);
    expect(complete).not.toMatch(/authority_snapshot = /);
  });

  it("28. complete rejects missing, empty, malformed, and structurally invalid leased traces", () => {
    expect(complete).toMatch(/bound observation trace artifact for leased execution/);
    expect(complete).toMatch(/assert_tool_invocation_trace_struct/);
    expect(complete).toMatch(/productionClass' = 'leased_executor_execution'/);
    expect(complete).toMatch(/jsonb_array_length\(v_observation\.payload->'invocations'\) = 0/);
    expect(complete).toMatch(/assignmentId matching the frozen execution-step assignment digest, not a persistence UUID/);
    expect(complete).toMatch(/Success does not issue an Outcome/);
  });

  it("29. complete rejects expired, cancelled, and taken-over leases", () => {
    expect(complete).toMatch(/Execution lease expired/);
    expect(complete).toMatch(/cancelled, expired, or taken-over attempts cannot complete/);
    expect(complete).toMatch(/lease_worker_id is distinct from p_worker_id/);
    expect(complete).toMatch(/same organization and Workstream Run/);
  });

  it("30. fail_execution_attempt keeps p_allow_expired for the service-role reaper only", () => {
    expect(parent).toMatch(/p_allow_expired boolean default false/);
    expect(parent).toMatch(/lease_expires_at <= now\(\) and not p_allow_expired/);
    expect(sql).toMatch(/fail_execution_attempt keeps p_allow_expired for the service-role reaper/);
    expect(sql).toMatch(/cannot set p_allow_expired/);
    expect(sql).toMatch(/Do not document this as "No p_allow_expired"/);
    expect(qa).toMatch(/authenticated cannot set p_allow_expired/);
    expect(doc).toMatch(/p_allow_expired` exists/);
    expect(doc).toMatch(/PR #78.s description said .*No `p_allow_expired`/);
  });
});

describe("SQL hardening invariants", () => {
  it("adds no tables or columns and does not rewrite the parent migration", () => {
    expect(sql).toMatch(/No new tables or columns/);
    expect(sql).not.toMatch(/create table /i);
    expect(sql).not.toMatch(/alter table /i);
    expect(sql).not.toMatch(/add column /i);
    expect(parent).toMatch(/create or replace function public\.record_work_cell_phase_artifact/);
  });

  it("keeps record_work_cell_phase_artifact SECURITY INVOKER and revokes anon", () => {
    expect(persist).toMatch(/security invoker/);
    expect(persist).not.toMatch(/security definer/);
    expect(sql).toMatch(/revoke execute on function public\.record_work_cell_phase_artifact\([\s\S]*?\) from anon/);
    expect(helper).not.toMatch(/security definer/);
    expect(complete).toMatch(/security invoker/);
  });

  it("reuses PR #76 identity helpers in TypeScript and does not reimplement them in SQL", () => {
    const identity = stableWorkCellAssignmentId({
      organizationId: "org-1",
      runId: "run-1",
      phase: "prepare",
      executorKey: "hermes-loadout-researcher-v1",
      inputManifestContentHash: "a".repeat(64),
    });
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
    expect(identity).toBe(
      sha256Hex({
        schemaVersion: "work-cell-assignment-identity/v1",
        organizationId: "org-1",
        runId: "run-1",
        phase: "prepare",
        executorKey: "hermes-loadout-researcher-v1",
        inputManifestContentHash: "a".repeat(64),
      }),
    );
    const step = stableExecutionStepAssignmentId({
      organizationId: "org-1",
      runId: "run-1",
      planHash: "b".repeat(64),
      stepKey: "research",
      capabilityKey: "evidence_research",
    });
    expect(step).toMatch(/^[0-9a-f]{64}$/);
    expect(sql).not.toMatch(/work-cell-assignment-identity\/v1/);
    expect(sql).not.toMatch(/execution-step-assignment-identity\/v1/);
  });

  it("shared fixtures cover booleans, timestamps, empty arrays, and nested invocations", () => {
    const names = CANONICAL_JSON_PARITY_FIXTURES.map((item) => item.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "booleans and null",
        "timestamps stay strings",
        "empty arrays",
        "nested invocation object",
        "arrays preserve order and canonicalize items",
      ]),
    );
    expect(canonicalJsonStringify({ yes: true, no: false, empty: null })).toBe(
      '{"empty":null,"no":false,"yes":true}',
    );
  });

  it("contains no skip, bypass, advisory, or enforcementDisabled flag", () => {
    for (const source of [sql, qa, doc, readFileSync(ENFORCEMENT, "utf8")]) {
      expect(source).not.toMatch(/enforcementDisabled|enforcement_disabled|advisoryOnly|allowBypass/);
      expect(source).not.toMatch(/bypass enforcement|enforcement bypass/i);
    }
  });

  it("QA inspects real function names and forbids a stand-in proof function", () => {
    expect(qa).toMatch(/not a stand-in replacement for the migration functions/);
    expect(qa).toMatch(/public\.record_work_cell_phase_artifact/);
    expect(qa).toMatch(/pg_proc/);
    expect(qa).toMatch(/prosecdef/);
    expect(qa).not.toMatch(/proof_work_cell_persist_gate/);
    expect(qa).toMatch(/NEVER apply this file to a real Supabase project/);
  });
});
