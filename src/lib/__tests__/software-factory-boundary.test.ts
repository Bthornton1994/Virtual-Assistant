import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260907040000_software_factory_database_boundary_hardening.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const persist = readFileSync(resolve(process.cwd(), "src/lib/software-factory-persist.ts"), "utf8");
const contract = readFileSync(resolve(process.cwd(), "src/lib/software-factory-run-manager.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "src/app/(ops)/ops/execution/runs/[id]/page.tsx"), "utf8");

function rejectFunctionBody() {
  const start = migration.indexOf("create function public.software_factory_reject_forbidden_action");
  const end = migration.indexOf("create or replace function public.software_factory_sync_workstream");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("Software Factory database boundary hardening source contracts", () => {
  it("uses a migration version after the control-plane hardening file", () => {
    expect(basename(migrationPath)).toBe("20260907040000_software_factory_database_boundary_hardening.sql");
    expect(existsSync(resolve(process.cwd(), "supabase/migrations/20260906210000_software_factory_control_plane_hardening.sql"))).toBe(
      true,
    );
  });

  it("is replay-safe and does not rewrite historical evidence", () => {
    expect(migration).toContain("drop trigger if exists trg_software_factory_receipt_gate");
    expect(migration).toContain("create or replace function public.enforce_software_factory_receipt");
    expect(migration).toContain("drop function if exists public.software_factory_reject_forbidden_action(uuid, text)");
    expect(migration).toContain("add column if not exists packet_freeze_version");
    expect(migration).toContain("drop index if exists public.software_factory_one_reserved_artifact_per_run_idx");
    expect(migration).not.toMatch(/update\s+public\.evidence_artifacts/i);
  });

  it("encodes acceptance criteria coverage, latest owner decision, and 72h stale at the receipt gate", () => {
    expect(migration).toContain("software_factory_acceptance_criteria_covered");
    expect(migration).toContain("Acceptance criteria are not fully evidenced");
    expect(migration).toContain("software_factory_latest_owner_acceptance");
    expect(migration).toContain("order by a.decided_at desc, a.created_at desc");
    expect(migration).toContain("No recent evidence has been recorded; the run is stale");
    expect(migration).toContain("interval '72 hours'");
    expect(contract).toMatch(/problem\.class === "stale"/);
    expect(contract).toContain("latestOwnerAcceptance");
    expect(contract).toMatch(/record\.kind === "owner_decision"/);
  });

  it("versions packet freezes and unique-indexes freezeVersion plus owner decisionId", () => {
    expect(migration).toContain("software_factory_packet_freeze_version_idx");
    expect(migration).toContain("payload->>'freezeVersion'");
    expect(migration).toContain("software_factory_owner_decision_id_idx");
    expect(migration).toContain("payload->>'decisionId'");
    expect(migration).toContain("'packet:' || v_hash || ':v' || v_next_version::text");
  });

  it("rejects secrets on freeze and keeps helper execute revoked", () => {
    expect(migration).toContain("software_factory_json_has_secrets");
    expect(migration).toContain("Packet looks like a credential and is forbidden in Software Factory artifacts");
    expect(migration).toMatch(
      /revoke all on function public\.software_factory_json_has_secrets\(jsonb, integer\) from public, anon, authenticated/,
    );
    expect(persist).toContain("validateSoftwareFactoryPacket");
    expect(persist).not.toMatch(/softwareFactoryPacketSchema\.safeParse/);
  });

  it("returns a blocked JSON result for forbidden actions and never updates overlay or merge_performed", () => {
    const rejectBody = rejectFunctionBody();
    expect(rejectBody).toContain("returns jsonb");
    expect(rejectBody).toContain("forbidden_action_blocked");
    expect(rejectBody).toContain("'blocked', true");
    expect(rejectBody).toContain("'mergePerformed', false");
    expect(rejectBody).not.toMatch(/update\s+public\.software_factory_runs/i);
    expect(rejectBody).not.toMatch(/merge_performed/i);
    expect(persist).toContain('rpc("software_factory_reject_forbidden_action"');
    expect(persist).toContain("payload?.blocked === true");
  });

  it("projects factory terminals without opening awaiting_verification cancelled for every spec", () => {
    expect(migration).toContain("factory_lifecycle in ('deferred', 'cancelled')");
    expect(migration).toContain("factory_lifecycle = 'rejected'");
    expect(migration).toContain("Invalid workstream run transition");
    expect(contract).toContain("projectSoftwareFactoryWorkstreamStatus");
    expect(page).toContain("factoryTerminal");
    expect(page).toContain("isSoftwareFactoryTerminal");
  });
});
