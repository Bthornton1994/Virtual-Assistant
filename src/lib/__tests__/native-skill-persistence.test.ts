import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260826043000_native_skill_registry_v1.sql"),
  "utf8",
);
const registry = readFileSync(
  resolve(process.cwd(), "src/lib/native-skill-registry.ts"),
  "utf8",
);
const opsPage = readFileSync(
  resolve(process.cwd(), "src/app/(ops)/ops/skills/page.tsx"),
  "utf8",
);

describe("Native Skill persistence boundary", () => {
  it("creates a no-seed, staff-read and manager-write registry", () => {
    expect(migration).toContain("create table public.native_skills");
    expect(migration).toContain("alter table public.native_skills enable row level security");
    expect(migration).toMatch(/native_skills_select[\s\S]*public\.is_platform_staff\(\)/);
    expect(migration).toMatch(/native_skills_insert[\s\S]*public\.is_ops_manager\(\)/);
    expect(migration).toMatch(/native_skills_insert[\s\S]*status = 'candidate'/);
    expect(migration).toMatch(/native_skills_update[\s\S]*public\.is_ops_manager\(\)/);
    expect(migration).not.toMatch(/insert\s+into\s+public\.native_skills/i);
    expect(migration).not.toMatch(/grant[^;]*delete[^;]*native_skills/i);
    expect(migration).not.toMatch(/create\s+policy\s+native_skills_delete/i);
  });

  it("binds persisted columns to the exact canonical payload", () => {
    expect(migration).toContain("payload ->> 'skillKey' = skill_key");
    expect(migration).toContain("payload ->> 'skillVersion' = skill_version");
    expect(migration).toContain("payload ->> 'capabilityKey' = capability_key");
    expect(migration).toContain("payload ->> 'definitionHash' = definition_hash");
    expect(migration).toContain("payload -> 'procedureArtifact' ->> 'contentHash' = procedure_hash");
    expect(migration).toContain("payload @> '{\"mayOwnAuthoritativeState\":false}'::jsonb");
  });

  it("protects definition identity, history, approval, and lifecycle transitions", () => {
    expect(migration).toContain("protect_native_skill_definition");
    expect(migration).toContain("Canonical Native Skill definition is immutable");
    expect(migration).toContain("Native Skill qualification history is append-only");
    expect(migration).toContain("Native Skill qualification approval must be preserved");
    expect(migration).toContain("Invalid Native Skill lifecycle transition");
  });

  it("fails the operator roster closed on any invalid persisted row", () => {
    expect(registry).toContain("loadNativeSkillRegistry");
    expect(registry).toContain("validateNativeSkill(payload)");
    expect(registry).toContain("skills: []");
    expect(registry).toContain("persisted Skill row(s) failed canonical validation; roster hidden");
    expect(opsPage).toContain("await requireOps()");
    expect(opsPage).toContain("await loadNativeSkillRegistry()");
    expect(opsPage).toContain("Invalid persisted rows are never shown or projected.");
  });
});
