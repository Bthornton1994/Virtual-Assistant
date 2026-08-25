/**
 * Preview/QA only. Applies the existing CS-1 migration (PR #26 filename) plus
 * the QA fixture to qbvmtgaphvpwpwemplje. Does not add a second migration.
 * Refuses any other Supabase URL. Does not write Production or OpenBot.
 *
 * This file is the apply tool. Do not run it unless Preview apply is explicitly
 * authorized. Qualified lookup uses table reads, not a new RPC.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { FROZEN_WORK_CELL_EXECUTOR_KEYS } from "../src/lib/capability-registry";

const PREVIEW_REF = "qbvmtgaphvpwpwemplje";

function loadEnv() {
  for (const candidate of [".env.local", resolve("..", "Virtual-Assistant", ".env.local")]) {
    try {
      for (const line of readFileSync(candidate, "utf8").split(/\r?\n/)) {
        const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^"|"$/g, "");
      }
    } catch {
      // optional
    }
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const token = process.env.SUPABASE_ACCESS_TOKEN || "";

if (!url.includes(PREVIEW_REF)) {
  console.error("REFUSED: Supabase URL is not the Delegation Cloud Preview project.");
  process.exit(2);
}
if (!service) {
  console.error("CREDENTIAL BLOCKER: SUPABASE_SERVICE_ROLE_KEY is not set.");
  process.exit(2);
}

async function runSql(sql: string, label: string) {
  if (!token) return false;
  const res = await fetch(`https://api.supabase.com/v1/projects/${PREVIEW_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`FAIL ${label}: ${res.status} ${text.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`OK SQL ${label}`);
  return true;
}

async function main() {
  const migration = readFileSync(resolve("supabase/migrations/20260825190000_capability_registry_v1.sql"), "utf8");
  const fixture = readFileSync(resolve("supabase/qa/capability_registry_v1.sql"), "utf8");
  const appliedDdl = await runSql(migration, "capability_registry_v1 migration");
  if (appliedDdl) await runSql(fixture, "capability_registry_v1 fixture");

  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db
    .from("executor_capabilities")
    .select("qualification_status, capabilities ( key, status ), executor_profiles ( key, status )");
  if (error) {
    console.error(`LOOKUP FAIL: ${error.message}`);
    if (!token) {
      console.error("DDL not applied. Set SUPABASE_ACCESS_TOKEN and re-run. Preview only.");
      process.exit(2);
    }
    process.exit(1);
  }

  const qualified = (data ?? []).filter((row) => {
    const capability = (row as { capabilities?: { key?: string; status?: string } }).capabilities;
    return (
      (row as { qualification_status?: string }).qualification_status === "qualified" &&
      capability?.status === "active"
    );
  });
  const qualifiedKeys = qualified.map((row) => {
    const capability = (row as { capabilities?: { key?: string } }).capabilities;
    const profile = (row as { executor_profiles?: { key?: string } }).executor_profiles;
    return `${capability?.key}:${profile?.key}`;
  });

  console.log(
    JSON.stringify(
      {
        preview: PREVIEW_REF,
        frozenWorkCellKeys: FROZEN_WORK_CELL_EXECUTOR_KEYS,
        qualifiedMappings: qualifiedKeys,
        routing: "none",
      },
      null,
      2,
    ),
  );

  if (!qualifiedKeys.includes("deterministic_catalog_validation:catalog-evidence-validator-v1")) {
    console.error("Validator is missing from qualified deterministic_catalog_validation mappings.");
    process.exit(1);
  }
  if (qualifiedKeys.some((key) => key.startsWith("evidence_research:") && key.endsWith("hermes-loadout-researcher-v1"))) {
    console.error("Hermes must remain pending for evidence_research.");
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
