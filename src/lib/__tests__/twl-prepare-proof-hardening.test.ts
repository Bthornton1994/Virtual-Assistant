import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260906190000_twl_prepare_proof_hardening.sql"),
  "utf8",
);
const runWriter = readFileSync(resolve(process.cwd(), "src/lib/twl-prepare-proof-run.ts"), "utf8");
const contract = readFileSync(resolve(process.cwd(), "src/lib/twl-prepare-proof.ts"), "utf8");

describe("SF-TWL-PREPARE-PROOF-01 database hardening", () => {
  it("reserves the typed evidence schemas for database-owned writers", () => {
    expect(migration).toContain("trg_twl_prepare_proof_artifact_writer");
    expect(migration).toContain("twl_prepare_proof_one_reserved_artifact_per_run_idx");
    expect(migration).toContain("drop policy if exists evidence_artifacts_insert");
    expect(migration).toContain("coalesce(payload->>'schemaVersion', '') not in");
    expect(migration).toContain("Reserved TWL proof evidence must be written by its database-owned writer");
    expect(migration).toContain("current_user <> 'postgres'");
  });

  it("derives assignment evidence and performs the public GitHub GET inside the database boundary", () => {
    expect(migration).toContain("twl_prepare_proof_assign_worker");
    expect(migration).toContain("twl_prepare_proof_attach_public_pr");
    expect(migration).toContain("extensions.http_get(v_url)");
    expect(migration).toContain("requestedMethod', 'GET'");
    expect(migration).toContain("mutatesRepository', false");
    expect(migration).toContain("mergePerformed', false");
    expect(migration).toContain("'workerUserId'");
    expect(runWriter).toContain('db.rpc("twl_prepare_proof_assign_worker"');
    expect(runWriter).toContain('db.rpc("twl_prepare_proof_attach_public_pr"');
    expect(runWriter).not.toContain("addEvidenceArtifact");
    expect(runWriter).not.toContain("fetchPublicPullRequestMetadata");
  });

  it("mirrors the passing receipt gate in Postgres and forbids self-verification", () => {
    expect(migration).toContain("trg_twl_prepare_proof_receipt_gate");
    expect(migration).toContain("TWL Outcome Receipt verified_by must equal the authenticated verifier");
    expect(migration).toContain("The assigned TWL worker cannot issue their own Outcome Receipt");
    expect(migration).toContain("TWL assignment payload hash mismatch");
    expect(migration).toContain("TWL assignment evidence envelope hash mismatch");
    expect(migration).toContain("TWL public PR payload hash mismatch");
    expect(migration).toContain("TWL public PR evidence envelope hash mismatch");
    expect(contract).toContain("workerUserId: z.string().uuid().nullable().optional()");
    expect(contract).toContain("parsed.data.workerUserId === input.verifierId");
  });

  it("keeps anonymous and public callers away from the reserved writer RPCs", () => {
    expect(migration).toMatch(/revoke all on function public\.twl_prepare_proof_assign_worker\([^)]+\) from anon/);
    expect(migration).toMatch(/revoke all on function public\.twl_prepare_proof_attach_public_pr\([^)]+\) from anon/);
    expect(migration).toMatch(/grant execute on function public\.twl_prepare_proof_assign_worker\([^)]+\) to authenticated/);
    expect(migration).toMatch(/grant execute on function public\.twl_prepare_proof_attach_public_pr\([^)]+\) to authenticated/);
  });
});
