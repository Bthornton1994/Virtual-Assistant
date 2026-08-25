import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DEFINITIONS,
  CAPABILITY_KEYS,
  FROZEN_WORK_CELL_EXECUTOR_KEYS,
  getCapabilityDefinition,
  hasQualifiedCapability,
  isCapabilityKey,
  qualifiedImplementationsForCapability,
  type CapabilityImplementation,
} from "@/lib/capability-registry";

const freezeForm = readFileSync(resolve(process.cwd(), "src/components/work-cell.tsx"), "utf8");
const freezeAction = readFileSync(resolve(process.cwd(), "src/app/actions/work-cell.ts"), "utf8");
const opsPage = readFileSync(resolve(process.cwd(), "src/app/(ops)/ops/capabilities/page.tsx"), "utf8");
const fixture = readFileSync(resolve(process.cwd(), "supabase/qa/capability_registry_v1.sql"), "utf8");
const migrationDir = resolve(process.cwd(), "supabase/migrations");
const migration = readFileSync(resolve(migrationDir, "20260825190000_capability_registry_v1.sql"), "utf8");

describe("capability registry", () => {
  it("keeps the vocabulary unique and fully defined", () => {
    expect(new Set(CAPABILITY_KEYS).size).toBe(CAPABILITY_KEYS.length);
    expect(CAPABILITY_DEFINITIONS).toHaveLength(CAPABILITY_KEYS.length);

    for (const key of CAPABILITY_KEYS) {
      const definition = getCapabilityDefinition(key);
      expect(definition?.key).toBe(key);
      expect(isCapabilityKey(key)).toBe(true);
      expect(definition?.displayName).toBeTruthy();
      expect(definition?.verificationContract.implementation).toBeTruthy();
    }
  });

  it("does not treat pending or suspended implementations as qualified", () => {
    expect(
      hasQualifiedCapability(
        [
          { capabilityKey: "evidence_research", qualificationStatus: "pending" },
          { capabilityKey: "evidence_research", qualificationStatus: "suspended" },
        ],
        "evidence_research",
      ),
    ).toBe(false);

    expect(
      hasQualifiedCapability(
        [{ capabilityKey: "deterministic_catalog_validation", qualificationStatus: "qualified" }],
        "deterministic_catalog_validation",
      ),
    ).toBe(true);
  });
});

describe("frozen Step 3D executor-key guard", () => {
  it("does not change Runs 4-9 executor keys", () => {
    expect(FROZEN_WORK_CELL_EXECUTOR_KEYS.prepare).toBe("hermes-loadout-researcher-v1");
    expect(FROZEN_WORK_CELL_EXECUTOR_KEYS.review).toBe("grok-loadout-reviewer-v1");
    expect(FROZEN_WORK_CELL_EXECUTOR_KEYS.validate).toBe("catalog-evidence-validator-v1");
    expect(freezeForm).toMatch(/defaultValue="hermes-loadout-researcher-v1"/);
    expect(freezeForm).toMatch(/defaultValue="grok-loadout-reviewer-v1"/);
    expect(freezeAction).not.toMatch(/qualifiedImplementationsForCapability/);
    expect(freezeAction).not.toMatch(/loadCapabilityRoster/);
    expect(opsPage).toMatch(/does not assign work-cell phases/);
  });

  it("returns only active capabilities with qualified mappings", () => {
    const rows: CapabilityImplementation[] = [
      {
        capabilityKey: "evidence_research",
        capabilityStatus: "active",
        executorKey: "hermes-loadout-researcher-v1",
        executorKind: "agent",
        profileStatus: "shadow",
        qualificationStatus: "pending",
        qualificationVersion: "step3d-v1",
        evidenceSummary: "frozen prepare",
      },
      {
        capabilityKey: "deterministic_catalog_validation",
        capabilityStatus: "active",
        executorKey: "catalog-evidence-validator-v1",
        executorKind: "deterministic",
        profileStatus: "active",
        qualificationStatus: "qualified",
        qualificationVersion: "v1",
        evidenceSummary: "owns gate",
      },
      {
        capabilityKey: "software_repository_read",
        capabilityStatus: "proposed",
        executorKey: "some-reader",
        executorKind: "agent",
        profileStatus: "shadow",
        qualificationStatus: "qualified",
        qualificationVersion: "v0",
        evidenceSummary: "must not appear",
      },
    ];
    expect(qualifiedImplementationsForCapability(rows, "evidence_research")).toEqual([]);
    expect(qualifiedImplementationsForCapability(rows, "deterministic_catalog_validation").map((row) => row.executorKey)).toEqual([
      "catalog-evidence-validator-v1",
    ]);
    expect(qualifiedImplementationsForCapability(rows, "software_repository_read")).toEqual([]);
  });

  it("does not add a second CS-1 migration", () => {
    const cs1 = readdirSync(migrationDir).filter((name) => name.includes("capability_registry"));
    expect(cs1).toEqual(["20260825190000_capability_registry_v1.sql"]);
  });

  it("keeps environment-specific executor mappings in the QA fixture", () => {
    expect(migration).not.toContain("insert into public.executor_capabilities");
    expect(migration).not.toContain("profile_capability");
    expect(fixture).toContain("insert into public.executor_capabilities");
  });

  it("keeps agent mappings pending in the QA fixture and profiles in shadow via evidence text", () => {
    expect(fixture).toContain("'pending'");
    expect(fixture).toContain("'qualified'");
    expect(fixture).toContain("executor_profiles.status retains shadow");
    expect(fixture).not.toContain("delegation-cloud-public-web-researcher-v1");
    expect(fixture).not.toContain("'shadow'");
  });
});
