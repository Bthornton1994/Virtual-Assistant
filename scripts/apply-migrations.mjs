/**
 * Apply supabase/migrations to project qbvmtgaphvpwpwemplje via the Management API.
 * Requires SUPABASE_ACCESS_TOKEN (sbp_...).
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const REF = process.env.SUPABASE_PROJECT_REF || "qbvmtgaphvpwpwemplje";
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error("CREDENTIAL BLOCKER: SUPABASE_ACCESS_TOKEN is not set.");
  console.error("Create a personal access token at https://supabase.com/dashboard/account/tokens");
  console.error("Then: $env:SUPABASE_ACCESS_TOKEN='sbp_...' ; node scripts/apply-migrations.mjs");
  process.exit(2);
}

const dir = resolve(process.cwd(), "supabase/migrations");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

for (const file of files) {
  const query = readFileSync(resolve(dir, file), "utf8");
  console.log(`Applying ${file} (${query.length} bytes)`);
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`FAIL ${file}: ${res.status} ${text}`);
    process.exit(1);
  }
  console.log(`OK ${file}`);
}

console.log(`Applied ${files.length} migrations to ${REF}`);
