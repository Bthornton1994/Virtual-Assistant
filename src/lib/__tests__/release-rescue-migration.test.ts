import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ENGAGEMENT_STATUSES } from "@/lib/ai-app-release-rescue/constants";

// Static analysis of the Release Rescue migration.
//
// The live behaviour of this schema is proven end to end by
// supabase/qa/release_rescue_v1_isolation_proof.sql, which needs a Postgres
// instance. This suite runs in ordinary CI with no database and guards the
// properties that must never regress silently: RLS on every table, no column
// anywhere that could hold a credential, and the specific authority each policy
// grants. A reviewer changing one of these has to change a test that says why.

const MIGRATION_PATH = "supabase/migrations/20260915120000_release_rescue_v1.sql";
const sql = readFileSync(resolve(process.cwd(), MIGRATION_PATH), "utf8");

const TABLES = [
  "release_rescue_engagements",
  "release_rescue_repository_grants",
  "release_rescue_reports",
] as const;

/** Policy names are prefixed by role, not always by the full table name. */
const POLICY_PREFIX: Record<(typeof TABLES)[number], string> = {
  release_rescue_engagements: "release_rescue_engagements",
  release_rescue_repository_grants: "release_rescue_grants",
  release_rescue_reports: "release_rescue_reports",
};

/** The body of a `create table public.<name> ( ... );` block. */
function tableBody(name: string): string {
  const start = sql.indexOf(`create table public.${name} (`);
  expect(start, `${name} should be created`).toBeGreaterThan(-1);
  const end = sql.indexOf("\n);", start);
  expect(end, `${name} block should terminate`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

describe("release rescue migration: tenant isolation", () => {
  it("enables row level security on every table", () => {
    for (const table of TABLES) {
      expect(sql, table).toContain(`alter table public.${table} enable row level security;`);
    }
  });

  it("scopes every select policy to the caller's organizations", () => {
    for (const table of TABLES) {
      const policy = new RegExp(
        `create policy ${POLICY_PREFIX[table]}_select on public\\.${table}[\\s\\S]*?using \\(organization_id in \\(select public\\.my_org_ids\\(\\)\\) or public\\.is_platform_staff\\(\\)\\);`,
      );
      expect(sql, `${table} select policy`).toMatch(policy);
    }
  });

  it("carries every organization_id as a real foreign key", () => {
    for (const table of TABLES) {
      expect(tableBody(table), table).toContain(
        "organization_id uuid not null references public.organizations(id) on delete cascade",
      );
    }
  });

  it("binds child rows to their parent's organization with a composite key", () => {
    // Without this, a row could name organization A while pointing at an
    // engagement owned by organization B.
    expect(tableBody("release_rescue_repository_grants")).toContain(
      "references public.release_rescue_engagements (id, organization_id)",
    );
    expect(tableBody("release_rescue_reports")).toContain(
      "references public.release_rescue_engagements (id, organization_id)",
    );
    expect(tableBody("release_rescue_reports")).toContain(
      "references public.workstream_runs (id, organization_id)",
    );
  });

  it("never grants delete to signed-in users", () => {
    for (const table of TABLES) {
      const grants = sql.match(new RegExp(`grant [^;]*on public\\.${table}[^;]*to authenticated;`, "g")) ?? [];
      for (const grant of grants) {
        expect(grant, `${table} grant`).not.toContain("delete");
      }
    }
  });
});

describe("release rescue migration: no credential ever lands in the database", () => {
  it("declares no credential-shaped column on any table", () => {
    const forbidden = /^\s*\w*(token|secret|password|passwd|credential|api_key|apikey|private_key|access_key)\w*\s/im;

    for (const table of TABLES) {
      expect(tableBody(table), `${table} should declare no credential column`).not.toMatch(forbidden);
    }
  });

  it("pins repository access to read-only", () => {
    expect(tableBody("release_rescue_repository_grants")).toContain("check (access_level = 'read_only')");
  });

  it("rejects credential-named metadata keys and credential-shaped values", () => {
    expect(sql).toContain("may not contain credential fields");
    expect(sql).toContain("contains credential-shaped material");
    // The value scan must cover the major token shapes.
    for (const shape of ["AKIA[0-9A-Z]{16}", "gh[pousr]_[A-Za-z0-9]{36}", "PRIVATE KEY", "sk-ant-"]) {
      expect(sql, shape).toContain(shape);
    }
  });

  it("bounds every access grant in time", () => {
    expect(sql).toContain("A repository access grant must expire after it is granted");
    expect(sql).toContain("A repository access grant may not exceed 30 days");
    expect(tableBody("release_rescue_repository_grants")).toContain("expires_at timestamptz not null");
  });
});

describe("release rescue migration: authority", () => {
  it("lets only the customer originate an access grant", () => {
    expect(sql).toMatch(
      /create policy release_rescue_grants_insert on public\.release_rescue_repository_grants[\s\S]*?with check \(public\.is_org_admin\(organization_id\)\);/,
    );
  });

  it("lets the customer revoke their own access", () => {
    expect(sql).toMatch(
      /create policy release_rescue_grants_update on public\.release_rescue_repository_grants[\s\S]*?using \(public\.is_org_admin\(organization_id\) or public\.is_ops_manager\(\)\)/,
    );
  });

  it("lets only a manager issue or update a report", () => {
    // is_platform_staff() admits a plain operator and would be too wide here.
    expect(sql).toMatch(
      /create policy release_rescue_reports_insert on public\.release_rescue_reports[\s\S]*?with check \(public\.is_ops_manager\(\)\);/,
    );
    expect(sql).toMatch(
      /create policy release_rescue_reports_update on public\.release_rescue_reports[\s\S]*?using \(public\.is_ops_manager\(\)\)/,
    );
  });

  it("requires a named human reviewer on every report", () => {
    expect(tableBody("release_rescue_reports")).toContain("reviewed_by uuid not null references auth.users(id)");
    expect(sql).toContain("Report reviewer must be an ops manager or platform admin");
  });

  it("runs the validation triggers with definer rights and a locked search path", () => {
    // They read tables the caller cannot see, and must see true state rather
    // than the caller's RLS-filtered view.
    for (const fn of [
      "enforce_release_rescue_report_invariants",
      "enforce_release_rescue_grant_hygiene",
    ]) {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}()`));
      const header = body.slice(0, body.indexOf("as $$"));
      expect(header, fn).toContain("security definer");
      expect(header, fn).toContain("set search_path = public");
    }
  });
});

describe("release rescue migration: retention", () => {
  it("derives retention days from the elected policy", () => {
    expect(sql).toContain("do not match retention policy");
    expect(sql).toContain("when 'purge_on_delivery' then 0");
    expect(sql).toContain("when 'standard_30_day' then 30");
  });

  it("allows retention to be shortened but never extended", () => {
    expect(sql).toContain("Retention may only be shortened, never extended");
    expect(sql).toContain("Purge deadline may only move earlier");
  });

  it("gives an undelivered engagement an absolute expiry backstop", () => {
    expect(sql).toContain("now() + interval '60 days'");
  });

  it("restricts the purge function to the service role", () => {
    expect(sql).toContain("revoke all on function public.purge_expired_release_rescue_data() from anon, authenticated;");
    expect(sql).toContain("grant execute on function public.purge_expired_release_rescue_data() to service_role;");
    const header = sql.slice(
      sql.indexOf("create or replace function public.purge_expired_release_rescue_data()"),
    );
    expect(header.slice(0, header.indexOf("as $$"))).toContain("security definer");
  });

  it("scopes the evidence-delete carve-out to a purge of Release Rescue artifacts only", () => {
    const fn = sql.slice(sql.indexOf("create or replace function public.enforce_evidence_artifact_invariants()"));
    const deleteBranch = fn.slice(fn.indexOf("if tg_op = 'DELETE'"), fn.indexOf("if tg_op <> 'INSERT'"));

    // Both conditions are required: the purge flag AND the artifact prefix.
    expect(deleteBranch).toContain("current_setting('delegation.retention_purge', true)");
    expect(deleteBranch).toContain("Evidence artifacts are immutable");
    expect(deleteBranch).toContain("not like 'release-rescue-%'");
    expect(deleteBranch).toContain("Retention purge may only remove Release Rescue evidence artifacts");
  });

  it("keeps the purge flag transaction-local", () => {
    // The third argument of set_config must be true, or the flag would outlive
    // the sweep and leave a delete primitive open on the session.
    expect(sql).toContain("perform set_config('delegation.retention_purge', 'on', true);");
    expect(sql).toContain("perform set_config('delegation.retention_purge', 'off', true);");
  });

  it("preserves the caller-supplied content hash the work cell depends on", () => {
    // Re-declaring enforce_evidence_artifact_invariants must not regress the
    // 20260824090000 fix, or every work-cell verification would hard-fail.
    expect(sql).toContain("if new.content_hash is null or new.content_hash !~ '^[0-9a-f]{64}$' then");
  });

  it("keeps report accounting rows after their content is purged", () => {
    expect(sql).toContain("Release Rescue report records are retained as accounting rows");
    expect(tableBody("release_rescue_reports")).toContain(
      "report_artifact_id uuid references public.evidence_artifacts(id) on delete set null",
    );
  });
});

describe("release rescue migration: lifecycle vocabulary", () => {
  it("matches the engagement statuses the application declares", () => {
    // Drift here is invisible until something tries to persist and the check
    // constraint rejects it.
    const constraint = /status text not null default 'intake' check \(status in \(([\s\S]*?)\)\)/.exec(
      tableBody("release_rescue_engagements"),
    );
    expect(constraint, "status check constraint should be present").not.toBeNull();
    const schemaStatuses = [...(constraint?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

    expect(schemaStatuses).toEqual([...ENGAGEMENT_STATUSES].sort());
  });
});

describe("release rescue migration: report integrity", () => {
  it("constrains hashes to sha256 hex", () => {
    const body = tableBody("release_rescue_reports");

    for (const column of ["report_hash", "rubric_hash", "scope_hash"]) {
      expect(body, column).toContain(`${column} text not null check (${column} ~ '^[0-9a-f]{64}$')`);
    }
  });

  it("pins the report schema version and the verdict vocabulary", () => {
    const body = tableBody("release_rescue_reports");

    expect(body).toContain("check (schema_version = 'release-rescue-report/v1')");
    for (const verdict of [
      "release_blocked",
      "conditional_release",
      "release_with_tracked_findings",
      "no_blocking_findings_identified",
    ]) {
      expect(body, verdict).toContain(verdict);
    }
  });

  it("refuses a verdict that contradicts its own blocking count", () => {
    expect(sql).toContain("cannot claim no blocking findings were identified");
    expect(sql).toContain("A release_blocked verdict requires at least one blocking finding");
  });

  it("makes reports immutable apart from a single delivery stamp", () => {
    expect(sql).toContain("The only permitted report update is stamping delivered_at");
    expect(sql).toContain("A delivered Release Rescue report is immutable");
  });

  it("allows one live engagement per organization per scope", () => {
    expect(sql).toMatch(
      /create unique index release_rescue_engagements_active_scope_idx[\s\S]*?where status not in \('delivered', 'cancelled', 'purged'\);/,
    );
  });
});
