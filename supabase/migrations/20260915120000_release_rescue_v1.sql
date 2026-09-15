-- AI App Release Rescue v1: engagement intake, repository access grants, and
-- report accounting.
--
-- The service reads a customer's private source code. That is the most sensitive
-- access this platform has taken, so the database boundary carries the rules
-- rather than trusting the application to remember them:
--
--   * Tenant isolation is enforced by RLS on every table, as elsewhere in this
--     schema. The application is not the boundary.
--   * There is no column anywhere here that can hold a credential. Access is
--     granted by the customer in their own provider (a read-only app install or
--     a read-only collaborator) and recorded here as a revocable, expiring FACT.
--     Triggers reject credential-shaped metadata so the absence is enforced, not
--     merely intended.
--   * Retention is a stored deadline with an idempotent purge, not a promise in
--     a policy document. Retention can be shortened, never extended.
--   * Reports are immutable once written and require a named human reviewer.
--
-- Deliberately NOT added here:
--   * No findings or report-body table. Both are ordinary immutable rows in
--     evidence_artifacts, discriminated by payload->>'schemaVersion', following
--     the Step 3D precedent. evidence_artifacts already grants authenticated
--     only select+insert, which is the immutability these artifacts need.
--   * No new authority. The Delegation Spec remains the authority ceiling and
--     the review is prepare-only. Nothing here lets an executor act externally.
--   * No payment, pricing, or subscription state. Commercial terms live in the
--     offer contract in application code; no charge is activated by this schema.

-- --------------------------------------------------------------------------------
-- Engagements
-- --------------------------------------------------------------------------------

create table public.release_rescue_engagements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid references public.requests(id) on delete set null,
  run_id uuid references public.workstream_runs(id) on delete set null,
  offer_version text not null default 'release-rescue-offer/v1',
  status text not null default 'intake' check (status in (
    'intake', 'scoped', 'access_granted', 'auditing', 'report_ready', 'delivered', 'cancelled', 'purged'
  )),
  -- The frozen ReleaseRescueScope: one repository, one application, one critical
  -- workflow. Cleared to a stub by the retention purge; scope_hash survives as the
  -- immutable identity of what was reviewed, which is a hash and reveals nothing.
  scope jsonb not null,
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  retention_policy text not null check (retention_policy in ('purge_on_delivery', 'minimum_7_day', 'standard_30_day')),
  retention_days integer not null check (retention_days between 0 and 30),
  -- When customer source material must be gone. Set on insert as an absolute
  -- backstop and recomputed at delivery; it may only ever move earlier.
  purge_after timestamptz,
  attestations jsonb not null default '{}'::jsonb,
  delivered_at timestamptz,
  purged_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create index release_rescue_engagements_org_idx
  on public.release_rescue_engagements (organization_id, created_at desc);
create index release_rescue_engagements_run_idx
  on public.release_rescue_engagements (run_id) where run_id is not null;
create index release_rescue_engagements_request_idx
  on public.release_rescue_engagements (request_id) where request_id is not null;
create index release_rescue_engagements_created_by_idx
  on public.release_rescue_engagements (created_by) where created_by is not null;
-- Drives the retention sweep. Partial, so the index stays small as purged rows accumulate.
create index release_rescue_engagements_purge_idx
  on public.release_rescue_engagements (purge_after) where purged_at is null;
-- One live engagement per organization per exact scope. A second concurrent audit
-- of the same commit is a duplicate charge and a duplicate access grant, not a
-- second engagement.
create unique index release_rescue_engagements_active_scope_idx
  on public.release_rescue_engagements (organization_id, scope_hash)
  where status not in ('delivered', 'cancelled', 'purged');

-- --------------------------------------------------------------------------------
-- Repository access grants
-- --------------------------------------------------------------------------------

-- A record that the customer granted read access, in their own provider, for a
-- bounded window. There is intentionally no token, key, password, or credential
-- column: Delegation Cloud never holds the customer's repository credential, so
-- there is nothing here to steal, leak, or have to rotate.
create table public.release_rescue_repository_grants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  provider text not null check (provider in ('github', 'gitlab', 'bitbucket', 'uploaded_archive')),
  -- owner/name only. A URL form would invite https://user:token@host, which is a
  -- credential arriving through a form; the shape is refused instead of scrubbed.
  repository_ref text not null,
  access_level text not null default 'read_only' check (access_level = 'read_only'),
  grant_method text not null check (grant_method in (
    'customer_installed_readonly_app', 'customer_added_readonly_collaborator', 'customer_uploaded_archive'
  )),
  granted_by uuid references auth.users(id) on delete set null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revocation_reason text not null default '',
  -- Non-credential context only (e.g. default branch, archive checksum).
  -- enforce_release_rescue_grant_hygiene rejects credential-shaped keys and values.
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint release_rescue_grants_engagement_fkey
    foreign key (engagement_id, organization_id)
    references public.release_rescue_engagements (id, organization_id) on delete cascade
);

create index release_rescue_grants_engagement_idx
  on public.release_rescue_repository_grants (engagement_id, granted_at desc);
create index release_rescue_grants_org_idx
  on public.release_rescue_repository_grants (organization_id, created_at desc);
create index release_rescue_grants_engagement_org_fk_idx
  on public.release_rescue_repository_grants (engagement_id, organization_id);
create index release_rescue_grants_granted_by_idx
  on public.release_rescue_repository_grants (granted_by) where granted_by is not null;
-- Live grants, for expiry sweeps and for showing a customer what is currently open.
create index release_rescue_grants_live_idx
  on public.release_rescue_repository_grants (expires_at) where revoked_at is null;

-- --------------------------------------------------------------------------------
-- Report accounting rows
-- --------------------------------------------------------------------------------

-- The report BODY is an immutable evidence_artifacts row. This table is the
-- accounting record that binds it: which engagement, which run, which rubric,
-- which canonical hash, which verdict, and which human signed it.
--
-- It deliberately survives the retention purge with its content pointer cleared.
-- After purge we can still prove an engagement happened and what verdict was
-- issued, while holding none of the customer's source-derived content.
create table public.release_rescue_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  engagement_id uuid not null,
  run_id uuid not null references public.workstream_runs(id) on delete restrict,
  report_artifact_id uuid references public.evidence_artifacts(id) on delete set null,
  schema_version text not null check (schema_version = 'release-rescue-report/v1'),
  -- Canonical sha256 of the report payload, computed in application code by
  -- hashReleaseRescueReport. Re-derived before delivery to detect tampering.
  report_hash text not null check (report_hash ~ '^[0-9a-f]{64}$'),
  rubric_version text not null,
  rubric_hash text not null check (rubric_hash ~ '^[0-9a-f]{64}$'),
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  verdict text not null check (verdict in (
    'release_blocked', 'conditional_release', 'release_with_tracked_findings', 'no_blocking_findings_identified'
  )),
  blocking_finding_count integer not null check (blocking_finding_count >= 0),
  critical_count integer not null default 0 check (critical_count >= 0),
  high_count integer not null default 0 check (high_count >= 0),
  medium_count integer not null default 0 check (medium_count >= 0),
  low_count integer not null default 0 check (low_count >= 0),
  informational_count integer not null default 0 check (informational_count >= 0),
  coverage_assessed_checks integer not null check (coverage_assessed_checks >= 0),
  coverage_total_checks integer not null check (coverage_total_checks > 0),
  prepared_by_executor_key text not null,
  -- Human accountability is a NOT NULL column, not a convention. VISION.md keeps
  -- humans as the accountable layer; an AI-drafted report cannot reach a paying
  -- customer without a named reviewer, and the trigger below checks that the
  -- named reviewer actually holds manager authority.
  reviewed_by uuid not null references auth.users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  delivered_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz not null default now(),
  unique (engagement_id, report_hash),
  constraint release_rescue_reports_engagement_fkey
    foreign key (engagement_id, organization_id)
    references public.release_rescue_engagements (id, organization_id) on delete restrict,
  constraint release_rescue_reports_run_fkey
    foreign key (run_id, organization_id)
    references public.workstream_runs (id, organization_id) on delete restrict
);

create index release_rescue_reports_org_idx
  on public.release_rescue_reports (organization_id, created_at desc);
create index release_rescue_reports_engagement_idx
  on public.release_rescue_reports (engagement_id, created_at desc);
create index release_rescue_reports_run_idx on public.release_rescue_reports (run_id);
create index release_rescue_reports_run_org_fk_idx on public.release_rescue_reports (run_id, organization_id);
create index release_rescue_reports_engagement_org_fk_idx
  on public.release_rescue_reports (engagement_id, organization_id);
create index release_rescue_reports_artifact_idx
  on public.release_rescue_reports (report_artifact_id) where report_artifact_id is not null;
create index release_rescue_reports_reviewed_by_idx on public.release_rescue_reports (reviewed_by);

create trigger trg_release_rescue_engagements_updated
  before update on public.release_rescue_engagements
  for each row execute function public.set_updated_at();

create trigger trg_release_rescue_grants_updated
  before update on public.release_rescue_repository_grants
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------------
-- Engagement invariants
-- --------------------------------------------------------------------------------

create or replace function public.enforce_release_rescue_engagement_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_expected_days integer;
begin
  -- Retention days are derived from the elected policy, never supplied
  -- independently. Two fields that can disagree about how long we keep a
  -- customer's source is a bug waiting to become a privacy incident.
  v_expected_days := case new.retention_policy
    when 'purge_on_delivery' then 0
    when 'minimum_7_day' then 7
    when 'standard_30_day' then 30
  end;
  if new.retention_days is distinct from v_expected_days then
    raise exception 'Retention days (%) do not match retention policy "%" (expected %)',
      new.retention_days, new.retention_policy, v_expected_days;
  end if;

  if tg_op = 'INSERT' then
    -- Absolute backstop: an engagement that stalls before delivery still expires.
    new.purge_after := least(coalesce(new.purge_after, now() + interval '60 days'), now() + interval '60 days');
    return new;
  end if;

  if new.organization_id is distinct from old.organization_id then
    raise exception 'Engagement organization is immutable';
  end if;
  if new.scope_hash is distinct from old.scope_hash then
    raise exception 'Engagement scope is frozen at intake';
  end if;
  if new.retention_days > old.retention_days then
    raise exception 'Retention may only be shortened, never extended';
  end if;
  if old.purged_at is not null and new.purged_at is distinct from old.purged_at then
    raise exception 'A purged engagement cannot be un-purged';
  end if;

  -- At delivery the retention clock starts. purge_after becomes the earlier of
  -- the existing backstop and delivery + elected retention.
  if old.delivered_at is null and new.delivered_at is not null then
    new.purge_after := least(
      coalesce(new.purge_after, old.purge_after, new.delivered_at),
      new.delivered_at + make_interval(days => new.retention_days)
    );
  end if;

  if new.purge_after is not null and old.purge_after is not null and new.purge_after > old.purge_after then
    raise exception 'Purge deadline may only move earlier';
  end if;

  return new;
end;
$$;

create trigger trg_release_rescue_engagement_invariants
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_engagement_invariants();

-- --------------------------------------------------------------------------------
-- Repository grant hygiene
-- --------------------------------------------------------------------------------

-- SECURITY DEFINER for the same reason as the report invariants below: the
-- engagement-ownership check must read true state rather than the caller's
-- RLS-filtered view, or a caller could satisfy it by making the engagement
-- invisible. Read-only, no dynamic SQL, locked search_path.
create or replace function public.enforce_release_rescue_grant_hygiene()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_engagement_org uuid;
  v_key text;
begin
  if tg_op = 'UPDATE' then
    -- A grant is a historical fact. The only thing that may change is that it
    -- was revoked, and revocation is one-way.
    if to_jsonb(new) - 'revoked_at' - 'revocation_reason' - 'updated_at'
       is distinct from
       to_jsonb(old) - 'revoked_at' - 'revocation_reason' - 'updated_at' then
      raise exception 'A repository access grant may only be revoked, never edited';
    end if;
    if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
      raise exception 'A revoked repository access grant cannot be reopened';
    end if;
    return new;
  end if;

  select organization_id into v_engagement_org
    from public.release_rescue_engagements where id = new.engagement_id;
  if v_engagement_org is null then
    raise exception 'Repository access grant must belong to an existing engagement';
  end if;
  if v_engagement_org is distinct from new.organization_id then
    raise exception 'Repository access grant organization must match its engagement';
  end if;

  if new.repository_ref !~ '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$' then
    raise exception 'Repository reference must be owner/name with no URL, host, or credential component';
  end if;

  if new.expires_at <= new.granted_at then
    raise exception 'A repository access grant must expire after it is granted';
  end if;
  if new.expires_at > new.granted_at + interval '30 days' then
    raise exception 'A repository access grant may not exceed 30 days';
  end if;

  -- Defence in depth for the "no credential columns" design: a JSONB column is a
  -- place someone could put one anyway, by accident or under time pressure.
  for v_key in select jsonb_object_keys(new.metadata) loop
    if lower(v_key) ~ '(token|secret|password|passwd|credential|api[_-]?key|private[_-]?key|access[_-]?key|authorization|cookie|session)' then
      raise exception 'Repository access grant metadata may not contain credential fields (found "%")', v_key;
    end if;
  end loop;

  if new.metadata::text ~ '(AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22}|xox[abposr]-[A-Za-z0-9-]{10}|sk-ant-[A-Za-z0-9_-]{20}|(sk|rk)_(live|test)_[A-Za-z0-9]{16}|AIza[0-9A-Za-z_-]{35}|BEGIN[A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})' then
    raise exception 'Repository access grant metadata contains credential-shaped material';
  end if;

  return new;
end;
$$;

create trigger trg_release_rescue_grant_hygiene
  before insert or update on public.release_rescue_repository_grants
  for each row execute function public.enforce_release_rescue_grant_hygiene();

-- --------------------------------------------------------------------------------
-- Report invariants and immutability
-- --------------------------------------------------------------------------------

-- SECURITY DEFINER, following the security-definer helper pattern this schema
-- already uses for authorization lookups.
--
-- Two reasons, and the first is a correctness bug this function had without it:
-- `authenticated` holds no SELECT grant on public.operators, so the reviewer
-- authority check below could not run at all for the ops manager actually
-- issuing the report.
--
-- The second is the more important one. A validation trigger must see TRUE
-- state, not the caller's RLS-filtered view of it. Running as the invoker, a
-- cross-tenant check can be defeated by making the conflicting row invisible:
-- the row the check is supposed to find simply is not there, so the check
-- passes. This function only reads and raises — it performs no writes, runs no
-- dynamic SQL, and has a locked search_path — so definer rights grant the
-- caller nothing beyond an honest answer.
create or replace function public.enforce_release_rescue_report_invariants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_artifact record;
  v_reviewer_role text;
  v_engagement_org uuid;
begin
  select organization_id into v_engagement_org
    from public.release_rescue_engagements where id = new.engagement_id;
  if v_engagement_org is null then
    raise exception 'Report must belong to an existing engagement';
  end if;
  if v_engagement_org is distinct from new.organization_id then
    raise exception 'Report organization must match its engagement';
  end if;

  if new.report_artifact_id is null then
    raise exception 'A report must reference the evidence artifact holding its body';
  end if;

  select organization_id, run_id, payload into v_artifact
    from public.evidence_artifacts where id = new.report_artifact_id;
  if v_artifact.organization_id is null then
    raise exception 'Report artifact does not exist';
  end if;
  if v_artifact.organization_id is distinct from new.organization_id then
    raise exception 'Report artifact organization must match the report';
  end if;
  if v_artifact.run_id is distinct from new.run_id then
    raise exception 'Report artifact must belong to the same workstream run as the report';
  end if;
  if coalesce(v_artifact.payload->>'schemaVersion', '') is distinct from new.schema_version then
    raise exception 'Report artifact schemaVersion "%" does not match the report row (%)',
      coalesce(v_artifact.payload->>'schemaVersion', '(absent)'), new.schema_version;
  end if;

  -- The named reviewer must actually hold manager authority. A NOT NULL column
  -- alone would accept any user id, including the executor's service account.
  select platform_role into v_reviewer_role from public.operators where user_id = new.reviewed_by;
  if v_reviewer_role is null or v_reviewer_role not in ('ops_manager', 'platform_admin') then
    raise exception 'Report reviewer must be an ops manager or platform admin';
  end if;

  if new.coverage_assessed_checks > new.coverage_total_checks then
    raise exception 'Assessed checks cannot exceed total checks';
  end if;

  -- A verdict of no blocking findings cannot coexist with blocking findings.
  if new.verdict = 'no_blocking_findings_identified' and new.blocking_finding_count > 0 then
    raise exception 'A report with blocking findings cannot claim no blocking findings were identified';
  end if;
  if new.verdict = 'release_blocked' and new.blocking_finding_count = 0 then
    raise exception 'A release_blocked verdict requires at least one blocking finding';
  end if;

  return new;
end;
$$;

create trigger trg_release_rescue_report_invariants
  before insert on public.release_rescue_reports
  for each row execute function public.enforce_release_rescue_report_invariants();

create or replace function public.enforce_release_rescue_report_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Release Rescue report records are retained as accounting rows. Retention purge clears their content instead of deleting them';
  end if;

  -- Retention purge: clear the pointer to the (now deleted) body, keep the row.
  if coalesce(current_setting('delegation.retention_purge', true), 'off') = 'on' then
    if new.report_artifact_id is not null or new.purged_at is null then
      raise exception 'Retention purge must clear report_artifact_id and stamp purged_at';
    end if;
    if to_jsonb(new) - 'report_artifact_id' - 'purged_at'
       is distinct from
       to_jsonb(old) - 'report_artifact_id' - 'purged_at' then
      raise exception 'Retention purge may only clear the report body reference';
    end if;
    return new;
  end if;

  -- Outside a purge, the single permitted update is stamping delivery once.
  if old.delivered_at is not null then
    raise exception 'A delivered Release Rescue report is immutable';
  end if;
  if new.delivered_at is null then
    raise exception 'The only permitted report update is stamping delivered_at';
  end if;
  if to_jsonb(new) - 'delivered_at' is distinct from to_jsonb(old) - 'delivered_at' then
    raise exception 'The only permitted report update is stamping delivered_at';
  end if;

  return new;
end;
$$;

create trigger trg_release_rescue_report_immutability
  before update or delete on public.release_rescue_reports
  for each row execute function public.enforce_release_rescue_report_immutability();

-- --------------------------------------------------------------------------------
-- Retention purge
-- --------------------------------------------------------------------------------

-- Evidence artifacts are immutable, which is correct for evidence and wrong for
-- a customer's source excerpts once their retention window closes. This adds one
-- narrow carve-out to the existing invariant function: a DELETE is permitted only
-- inside a retention purge (a transaction-local GUC no ordinary caller sets) and
-- only for a Release Rescue artifact.
--
-- The carve-out is narrow by construction: `authenticated` holds no DELETE grant
-- on evidence_artifacts at all, so the only roles that could reach this branch
-- are service_role and the owner, and the schemaVersion test keeps even those
-- from touching another workstream's evidence.
--
-- Everything above the DELETE branch is the 20260824090000 definition unchanged,
-- including the caller-supplied content-hash fallback that work-cell verification
-- depends on.
create or replace function public.enforce_evidence_artifact_invariants()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  run_record record;
  request_org uuid;
begin
  if tg_op = 'DELETE' then
    if coalesce(current_setting('delegation.retention_purge', true), 'off') <> 'on' then
      raise exception 'Evidence artifacts are immutable';
    end if;
    if coalesce(old.payload->>'schemaVersion', '') not like 'release-rescue-%' then
      raise exception 'Retention purge may only remove Release Rescue evidence artifacts';
    end if;
    return old;
  end if;

  if tg_op <> 'INSERT' then
    raise exception 'Evidence artifacts are immutable';
  end if;

  select organization_id, status into run_record
    from public.workstream_runs where id = new.run_id;
  if run_record.organization_id is null then
    raise exception 'Evidence must belong to an existing workstream run';
  end if;
  if run_record.organization_id is distinct from new.organization_id then
    raise exception 'Evidence organization must match its workstream run';
  end if;
  if run_record.status <> 'running' then
    raise exception 'Evidence may only be appended while a run is running';
  end if;

  if new.request_id is not null then
    select organization_id into request_org from public.requests where id = new.request_id;
    if request_org is distinct from new.organization_id then
      raise exception 'Evidence request must belong to the same organization';
    end if;
  end if;

  -- Fallback only. A caller that computed a real content hash keeps it.
  if new.content_hash is null or new.content_hash !~ '^[0-9a-f]{64}$' then
    new.content_hash := encode(
      extensions.digest(
        concat_ws('|', new.kind, new.summary, coalesce(new.source_uri, ''), coalesce(new.payload, '{}'::jsonb)::text),
        'sha256'
      ),
      'hex'
    );
  end if;

  return new;
end;
$$;

-- Idempotent retention sweep. Running it twice does nothing the second time;
-- running it on an empty set returns 0. Safe to schedule.
create or replace function public.purge_expired_release_rescue_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_engagement record;
  v_purged integer := 0;
begin
  -- Transaction-local. Never leaks to another statement or session.
  perform set_config('delegation.retention_purge', 'on', true);

  for v_engagement in
    select id, run_id
      from public.release_rescue_engagements
     where purged_at is null
       and purge_after is not null
       and purge_after <= now()
     order by purge_after
     for update
  loop
    -- Order matters: clear the accounting row's pointer BEFORE deleting the body,
    -- so the foreign key's own set-null update never races the immutability trigger.
    update public.release_rescue_reports
       set report_artifact_id = null,
           purged_at = now()
     where engagement_id = v_engagement.id
       and purged_at is null;

    if v_engagement.run_id is not null then
      delete from public.evidence_artifacts
       where run_id = v_engagement.run_id
         and coalesce(payload->>'schemaVersion', '') like 'release-rescue-%';
    end if;

    update public.release_rescue_repository_grants
       set revoked_at = now(),
           revocation_reason = 'retention_purge'
     where engagement_id = v_engagement.id
       and revoked_at is null;

    update public.release_rescue_engagements
       set scope = jsonb_build_object('purged', true),
           attestations = '{}'::jsonb,
           status = 'purged',
           purged_at = now()
     where id = v_engagement.id;

    v_purged := v_purged + 1;
  end loop;

  perform set_config('delegation.retention_purge', 'off', true);
  return v_purged;
end;
$$;

revoke all on function public.purge_expired_release_rescue_data() from public;
revoke all on function public.purge_expired_release_rescue_data() from anon, authenticated;
grant execute on function public.purge_expired_release_rescue_data() to service_role;

-- --------------------------------------------------------------------------------
-- Row level security
-- --------------------------------------------------------------------------------

alter table public.release_rescue_engagements enable row level security;
alter table public.release_rescue_repository_grants enable row level security;
alter table public.release_rescue_reports enable row level security;

grant select, insert, update on public.release_rescue_engagements to authenticated;
grant select, insert, update on public.release_rescue_repository_grants to authenticated;
grant select, insert, update on public.release_rescue_reports to authenticated;
grant all on public.release_rescue_engagements, public.release_rescue_repository_grants,
  public.release_rescue_reports to service_role;

-- Customers see their own engagements. Platform staff see all, because operating
-- the queue requires it; the reviewed source itself is never in these rows.
create policy release_rescue_engagements_select on public.release_rescue_engagements
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

-- A customer admin starts their own engagement. Ops can start one on their behalf.
create policy release_rescue_engagements_insert on public.release_rescue_engagements
  for insert to authenticated
  with check (public.is_org_admin(organization_id) or public.is_ops_manager());

create policy release_rescue_engagements_update on public.release_rescue_engagements
  for update to authenticated
  using (public.is_org_admin(organization_id) or public.is_ops_manager())
  with check (public.is_org_admin(organization_id) or public.is_ops_manager());

create policy release_rescue_grants_select on public.release_rescue_repository_grants
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

-- The customer grants access to their own repository. An operator cannot mint a
-- grant record for an organization: access originates with its owner.
create policy release_rescue_grants_insert on public.release_rescue_repository_grants
  for insert to authenticated
  with check (public.is_org_admin(organization_id));

-- Revocation is available to the customer at any time, and to ops for cleanup.
-- VISION.md requires delegated access to be removable; that has to mean removable
-- by the person who granted it, without asking us first.
create policy release_rescue_grants_update on public.release_rescue_repository_grants
  for update to authenticated
  using (public.is_org_admin(organization_id) or public.is_ops_manager())
  with check (public.is_org_admin(organization_id) or public.is_ops_manager());

create policy release_rescue_reports_select on public.release_rescue_reports
  for select to authenticated
  using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

-- Only a manager issues a report. is_platform_staff() admits a plain operator,
-- which is too wide for the artifact the customer actually pays for.
create policy release_rescue_reports_insert on public.release_rescue_reports
  for insert to authenticated
  with check (public.is_ops_manager());

create policy release_rescue_reports_update on public.release_rescue_reports
  for update to authenticated
  using (public.is_ops_manager())
  with check (public.is_ops_manager());
