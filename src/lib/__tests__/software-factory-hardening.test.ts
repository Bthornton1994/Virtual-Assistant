import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260906210000_software_factory_control_plane_hardening.sql",
);
const migration = readFileSync(migrationPath, "utf8");
const persist = readFileSync(resolve(process.cwd(), "src/lib/software-factory-persist.ts"), "utf8");
const execution = readFileSync(resolve(process.cwd(), "src/lib/execution-primitives.ts"), "utf8");
const contract = readFileSync(resolve(process.cwd(), "src/lib/software-factory-run-manager.ts"), "utf8");

describe("Software Factory control-plane hardening", () => {
  it("uses a migration version after the TWL reserved-writer gate", () => {
    expect(basename(migrationPath)).toBe("20260906210000_software_factory_control_plane_hardening.sql");
    expect(existsSync(resolve(process.cwd(), "supabase/migrations/20260906191128_twl_prepare_proof_database_hardening.sql"))).toBe(true);
  });

  it("is replay-safe for the reserved-writer and receipt triggers", () => {
    expect(migration).toContain("drop trigger if exists trg_software_factory_artifact_writer on public.evidence_artifacts;");
    expect(migration).toContain("drop trigger if exists trg_software_factory_receipt_gate on public.outcome_receipts;");
    expect(migration.indexOf("drop trigger if exists trg_software_factory_artifact_writer")).toBeLessThan(
      migration.indexOf("create trigger trg_software_factory_artifact_writer"),
    );
    expect(migration.indexOf("drop trigger if exists trg_software_factory_receipt_gate")).toBeLessThan(
      migration.indexOf("create trigger trg_software_factory_receipt_gate"),
    );
  });

  it("reserves packet and owner-decision evidence for database-owned writers", () => {
    expect(migration).toContain("software-factory-packet/v1");
    expect(migration).toContain("software-factory-owner-decision/v1");
    expect(migration).toContain("Reserved Software Factory evidence must be written by its database-owned writer");
    expect(migration).toContain("current_user <> 'postgres'");
    expect(migration).toContain("twl-prepare-proof-assignment/v1");
    expect(execution).toContain("Reserved Software Factory evidence must be created by its guarded packet or owner-decision writer");
    expect(contract).toContain("SOFTWARE_FACTORY_RUN_INPUT");
  });

  it("closes overlay table writes and accepted self-service", () => {
    expect(migration).toContain("revoke insert, update on table public.software_factory_runs from authenticated");
    expect(migration).toContain("revoke insert, update on table public.software_factory_approvals from authenticated");
    expect(migration).toContain("Accepted is issued only by the Software Factory receipt writer");
    expect(migration).toContain("coalesce(public.is_ops_manager(), false) is not true");
    expect(migration).toContain("Staff cannot record Software Factory owner acceptance");
    expect(migration).toContain("software_factory_allowed_transitions");
  });

  it("fails acceptance closed on stale work and does not hash factory packets with catalog-evidence ordinal key sort", () => {
    expect(contract).toMatch(/problem\.class === "stale"/);
    expect(contract).not.toMatch(/export function hashSoftwareFactoryPacket[\s\S]{0,120}return sha256Hex\(packet\)/);
  });

  it("binds persist callers to reserved RPCs instead of generic evidence insert", () => {
    expect(persist).toContain('rpc("software_factory_bind_workstream_run"');
    expect(persist).toContain('rpc("software_factory_freeze_packet"');
    expect(persist).toContain('rpc("software_factory_record_owner_decision"');
    expect(persist).toContain('rpc("software_factory_attach_evidence"');
    expect(persist).not.toContain("addEvidenceArtifact");
    expect(execution).toContain("isSoftwareFactorySpec(spec)");
    expect(execution).toContain("This Software Factory run cannot be accepted");
  });

  it("keeps anonymous callers away from the reserved writer RPCs", () => {
    expect(migration).toMatch(/revoke all on function public\.software_factory_write_evidence\([^)]+\) from public, anon, authenticated/);
    expect(migration).toMatch(/revoke all on function public\.software_factory_freeze_packet\([^)]+\) from public, anon/);
    expect(migration).toMatch(/revoke all on function public\.software_factory_record_owner_decision\([^)]+\) from public, anon/);
    expect(migration).toMatch(/grant execute on function public\.software_factory_freeze_packet\([^)]+\) to authenticated/);
    expect(migration).toMatch(/grant execute on function public\.software_factory_record_owner_decision\([^)]+\) to authenticated/);
  });
});
