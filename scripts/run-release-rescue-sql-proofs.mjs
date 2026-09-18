#!/usr/bin/env node
/**
 * Run the complete Release Rescue SQL proof suite against disposable Postgres.
 *
 * This is the database half of the GitHub Actions `verify` gate (owner decision
 * 45-M2). It encodes the documented local procedure from
 * supabase/qa/release_rescue_v1_isolation_proof.sql and
 * docs/AI-APP-RELEASE-RESCUE-V1.md:
 *
 *   1. apply the auth/extensions/roles shim
 *   2. apply supabase/migrations, skipping only the named non-Release-Rescue
 *      files the architecture document lists, with the documented cs4
 *      first-197-lines workaround
 *   3. skip remaining pg_net/http dependents the same way Audit 45 did, and
 *      fail closed if a Release Rescue migration or proof cannot run
 *   4. execute every release_rescue_*_proof.sql file
 *   5. count live PASS notices with `PASS [a-z_]+ +\|` and require the
 *      published 15-proof / 495-case suite
 *
 * Never pointed at a real Supabase project. Requires psql and PG* connection
 * variables (or a local peer-auth superuser).
 *
 *   node scripts/run-release-rescue-sql-proofs.mjs
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const DOC_PATH = resolve(ROOT, "docs/AI-APP-RELEASE-RESCUE-V1.md");
const MIGRATION_DIR = resolve(ROOT, "supabase/migrations");
const QA_DIR = resolve(ROOT, "supabase/qa");
const SHIM_PATH = resolve(QA_DIR, "release_rescue_proof_shim.sql");
const CS4_FILE = "20260828080000_cs4_persisted_ledger_observations.sql";
const CS4_COMPLETE_LINES = 197;
const PASS_RE = /PASS [a-z_]+ +\|/g;
const RELEASE_RESCUE_MIGRATION = /release_rescue/;

const doc = readFileSync(DOC_PATH, "utf8");

const proofRows = [...doc.matchAll(/^\| `(release_rescue_[a-z0-9_]+\.sql)` \| (\d+) \|$/gm)].map(
  (match) => ({ file: match[1], cases: Number(match[2]) }),
);
if (proofRows.length === 0) {
  console.error("FAIL: could not read the per-proof table from docs/AI-APP-RELEASE-RESCUE-V1.md");
  process.exit(1);
}

const headline = /(\d+) live database cases across ([a-z]+) proofs/.exec(doc);
if (!headline) {
  console.error("FAIL: could not read the headline database figure from docs/AI-APP-RELEASE-RESCUE-V1.md");
  process.exit(1);
}
const expectedTotal = Number(headline[1]);
const expectedFromRows = proofRows.reduce((sum, row) => sum + row.cases, 0);
if (expectedFromRows !== expectedTotal) {
  console.error(
    `FAIL: per-proof table sums to ${expectedFromRows}, headline says ${expectedTotal}`,
  );
  process.exit(1);
}

const skipSection = doc.slice(doc.indexOf("The proof base applies"), doc.indexOf("## Sixth independent audit"));
const namedSkips = [...skipSection.matchAll(/`(\d{14}_[a-z0-9_]+\.sql)`/g)].map((match) => match[1]);
if (namedSkips.length === 0) {
  console.error("FAIL: could not read the named skip list from docs/AI-APP-RELEASE-RESCUE-V1.md");
  process.exit(1);
}

const onDiskProofs = readdirSync(QA_DIR)
  .filter((file) => /^release_rescue_.*_proof\.sql$/.test(file))
  .sort();
const expectedProofs = [...proofRows.map((row) => row.file)].sort();
if (JSON.stringify(onDiskProofs) !== JSON.stringify(expectedProofs)) {
  console.error("FAIL: supabase/qa Release Rescue proofs do not match the architecture table.");
  console.error(`  on disk: ${onDiskProofs.join(", ")}`);
  console.error(`  documented: ${expectedProofs.join(", ")}`);
  process.exit(1);
}

const migrations = readdirSync(MIGRATION_DIR)
  .filter((file) => file.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b, "en"));
const namedSkipSet = new Set(namedSkips);

function ident(name, label) {
  if (typeof name !== "string" || !/^[a-z][a-z0-9_]*$/.test(name)) {
    console.error(`FAIL: ${label} is not a safe postgres identifier: ${JSON.stringify(name)}`);
    process.exit(1);
  }
  return name;
}

const MAINT_DB = ident(process.env.PGMAINTDB || "postgres", "PGMAINTDB");
const BASE_DB = ident(
  process.env.RELEASE_RESCUE_PROOF_BASE_DB || process.env.PGDATABASE || "release_rescue_proof",
  "proof base database",
);
const RUN_DB = ident(process.env.RELEASE_RESCUE_PROOF_RUN_DB || "release_rescue_proof_run", "proof run database");
if (new Set([MAINT_DB, BASE_DB, RUN_DB]).size !== 3) {
  console.error("FAIL: maintenance, template, and per-proof databases must be three different names");
  process.exit(1);
}

function psql(args, { label, db } = {}) {
  const result = spawnSync(
    "psql",
    ["--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-X", ...(db ? ["-d", db] : []), ...args],
    { encoding: "utf8", env: process.env },
  );
  if (result.error) {
    console.error(`FAIL ${label ?? args.join(" ")}: ${result.error.message}`);
    process.exit(1);
  }
  return result;
}

function waitForPostgres() {
  const attempts = 30;
  for (let i = 1; i <= attempts; i += 1) {
    const result = spawnSync("psql", ["--no-psqlrc", "-X", "-d", MAINT_DB, "-c", "select 1"], {
      encoding: "utf8",
      env: process.env,
    });
    if (result.status === 0) return;
    if (i === attempts) {
      console.error("FAIL: postgres did not accept connections");
      if (result.stderr) console.error(result.stderr.trim());
      process.exit(1);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
}

function applySqlFile(path, label, db = BASE_DB) {
  const result = psql(["-f", path], { label, db });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    return { ok: false, output, status: result.status };
  }
  return { ok: true, output, status: 0 };
}

function applySqlText(sql, label, db = BASE_DB) {
  const dir = mkdtempSync(join(tmpdir(), "rr-sql-proof-"));
  const path = join(dir, `${label.replace(/[^a-z0-9._-]+/gi, "_")}.sql`);
  try {
    writeFileSync(path, sql);
    return applySqlFile(path, label, db);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function admin(sql, label) {
  const result = psql(["-c", sql], { label, db: MAINT_DB });
  if (result.status !== 0) {
    console.error(`FAIL ${label}: ${sql}`);
    console.error(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    process.exit(1);
  }
}

function cloneFreshProofDb() {
  // Each proof writes immutable rows and some count by a shared hash, so the
  // isolation-proof rule applies to the whole suite: the database must be fresh.
  admin(`drop database if exists ${RUN_DB} with (force)`, `drop ${RUN_DB}`);
  admin(`create database ${RUN_DB} template ${BASE_DB}`, `clone ${RUN_DB}`);
}

function isPgNetOrHttpFailure(file, output) {
  const text = output.toLowerCase();
  if (file.includes("pg_net") || file.includes("_http")) return true;
  return (
    text.includes("extension \"pg_net\"") ||
    text.includes("extension pg_net") ||
    text.includes("schema \"net\"") ||
    text.includes("net.http_") ||
    text.includes("extension \"http\"") ||
    text.includes('could not open extension control file') && (text.includes("pg_net") || text.includes("/http.control"))
  );
}

waitForPostgres();
console.log("Release Rescue SQL proof suite");
console.log(`postgres: connected`);
console.log(`documented suite: ${proofRows.length} proofs, ${expectedTotal} cases`);
console.log(`named non-applicable migrations: ${namedSkips.join(", ")}`);

const shim = applySqlFile(SHIM_PATH, "shim");
if (!shim.ok) {
  console.error("FAIL: proof shim did not apply");
  console.error(shim.output);
  process.exit(1);
}
console.log("applied shim: supabase/qa/release_rescue_proof_shim.sql");

const applied = [];
const skipped = [];
const skippedNamed = [];
const skippedPgNetHttp = [];

for (const file of migrations) {
  const full = join(MIGRATION_DIR, file);
  if (namedSkipSet.has(file)) {
    skipped.push(file);
    skippedNamed.push(file);
    console.log(`skip (named, non-Release-Rescue): ${file}`);
    continue;
  }

  let sql = readFileSync(full, "utf8");
  let label = file;
  if (file === CS4_FILE) {
    const lines = sql.split(/\r?\n/);
    sql = `${lines.slice(0, CS4_COMPLETE_LINES).join("\n")}\n`;
    label = `${file} (lines 1-${CS4_COMPLETE_LINES})`;
    console.log(`apply workaround: ${label}`);
  }

  const result = file === CS4_FILE ? applySqlText(sql, label) : applySqlFile(full, label);
  if (result.ok) {
    applied.push(file);
    if (file !== CS4_FILE) console.log(`applied: ${file}`);
    continue;
  }

  if (file.match(RELEASE_RESCUE_MIGRATION)) {
    console.error(`FAIL: Release Rescue migration ${file} did not apply`);
    console.error(result.output);
    process.exit(1);
  }

  if (isPgNetOrHttpFailure(file, result.output)) {
    skipped.push(file);
    skippedPgNetHttp.push(file);
    console.log(`skip (pg_net/http unavailable, non-Release-Rescue): ${file}`);
    continue;
  }

  console.error(`FAIL: migration ${file} did not apply and is not a documented skip`);
  console.error(result.output);
  process.exit(1);
}

const digestWrap = applySqlText(
  `
create schema if not exists extensions;
create or replace function extensions.digest(text, text)
returns bytea language sql immutable parallel safe as $$ select public.digest($1, $2) $$;
create or replace function extensions.digest(bytea, text)
returns bytea language sql immutable parallel safe as $$ select public.digest($1, $2) $$;
grant execute on function extensions.digest(text, text) to public;
grant execute on function extensions.digest(bytea, text) to public;
grant select, insert, update on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
`,
  "post-migration grants",
);
if (!digestWrap.ok) {
  console.error("FAIL: post-migration digest wrappers / grants did not apply");
  console.error(digestWrap.output);
  process.exit(1);
}

console.log(`migrations applied: ${applied.length} of ${migrations.length}`);
console.log(`migrations skipped: ${skipped.length} (${skippedNamed.length} named, ${skippedPgNetHttp.length} pg_net/http)`);

if (applied.length === 0) {
  console.error("FAIL: no migrations applied");
  process.exit(1);
}

const releaseRescueMigrations = migrations.filter((file) => RELEASE_RESCUE_MIGRATION.test(file));
const missingRr = releaseRescueMigrations.filter((file) => !applied.includes(file));
if (missingRr.length > 0) {
  console.error(`FAIL: Release Rescue migrations were not applied: ${missingRr.join(", ")}`);
  process.exit(1);
}

const perProof = [];
let liveTotal = 0;

console.log(`proof databases: template ${BASE_DB}, per-proof clone ${RUN_DB}`);

for (const { file, cases: expectedCases } of proofRows) {
  cloneFreshProofDb();
  const result = applySqlFile(join(QA_DIR, file), file, RUN_DB);
  if (!result.ok) {
    console.error(`FAIL: proof ${file} did not complete`);
    console.error(result.output);
    process.exit(1);
  }
  const matches = result.output.match(PASS_RE) ?? [];
  const live = matches.length;
  liveTotal += live;
  perProof.push({ file, expectedCases, live });
  const mark = live === expectedCases ? "ok" : "COUNT MISMATCH";
  console.log(`proof ${mark}: ${file}  ${live} / ${expectedCases}`);
  if (live !== expectedCases) {
    console.error(`FAIL: ${file} produced ${live} PASS cases, documented ${expectedCases}`);
    process.exit(1);
  }
}

if (liveTotal !== expectedTotal) {
  console.error(`FAIL: live PASS count ${liveTotal} !== documented ${expectedTotal}`);
  process.exit(1);
}

if (perProof.length !== proofRows.length) {
  console.error(`FAIL: ran ${perProof.length} proofs, documented ${proofRows.length}`);
  process.exit(1);
}

console.log("");
console.log(
  `PASS: ${perProof.length} / ${perProof.length} proofs, ${liveTotal} cases, 0 failures`,
);
console.log(`migrations: ${applied.length} applied, ${skipped.length} skipped of ${migrations.length}`);
admin(`drop database if exists ${RUN_DB} with (force)`, `drop ${RUN_DB}`);
process.exit(0);
