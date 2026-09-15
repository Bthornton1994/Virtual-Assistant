-- AI App Release Rescue hardening v2: close the gaps an independent audit opened.
--
-- Every fix here answers a bypass that was demonstrated against a live database,
-- not a theoretical concern. Additive only; earlier migrations are not edited.

-- --------------------------------------------------------------------------------
-- 1. The frozen scope is actually frozen
-- --------------------------------------------------------------------------------
--
-- The previous guard protected `scope_hash` and left `scope` writable, so a
-- customer could rewrite the reviewed repository, the critical workflow, or the
-- AI-assisted choice while the hash stayed constant. "Frozen at intake" was true
-- of a 64-character string that nothing checked.
--
-- Postgres cannot recompute the application's canonical-JSON SHA-256, so the
-- binding is made the other way: the scope CONTENT becomes immutable alongside
-- its hash. The only writer that may change it is the retention purge, which
-- replaces it with a stub.

create or replace function public.enforce_release_rescue_scope_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.scope is distinct from old.scope then
    -- The retention purge is the one legitimate rewrite: it replaces customer
    -- content with a stub. It may only ever move toward the stub.
    if coalesce(current_setting('delegation.retention_purge', true), 'off') = 'on'
       and new.scope = jsonb_build_object('purged', true) then
      return new;
    end if;
    raise exception 'Engagement scope is frozen at intake and cannot be rewritten';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_release_rescue_scope_frozen on public.release_rescue_engagements;
create trigger trg_release_rescue_scope_frozen
  before update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_scope_frozen();

-- --------------------------------------------------------------------------------
-- 2. The access mode is immutable, agrees with the scope, and is not self-proving
-- --------------------------------------------------------------------------------
--
-- Three demonstrated bypasses of the archive ownership gate:
--
--   a. `access_mode` was a plain column a customer could UPDATE, so an archive
--      engagement could relabel itself as an app install and start a review.
--   b. `access_mode` was never compared to the frozen scope, so the two could
--      disagree while the scope still recorded the archive.
--   c. A customer could INSERT directly at status 'auditing' declaring any mode,
--      with no repository grant row in existence. The mode was an assertion, and
--      the gate trusted the assertion.
--
-- The modes that "demonstrate control" do so because the customer performed an
-- action inside their own provider account. The evidence of that action is a
-- grant row. So the gate now requires the row, not the label.

create or replace function public.enforce_release_rescue_access_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope_mode text;
  v_live_grants integer;
begin
  if tg_op = 'UPDATE' and new.access_mode is distinct from old.access_mode and old.access_mode is not null then
    raise exception 'Engagement access mode is fixed at intake and cannot be changed';
  end if;

  -- The column and the frozen scope must agree, so neither can be used to tell a
  -- different story from the other.
  v_scope_mode := new.scope #>> '{repository,accessMode}';
  if v_scope_mode is not null and new.access_mode is not null and v_scope_mode is distinct from new.access_mode then
    raise exception 'Engagement access mode "%" contradicts the frozen scope ("%")', new.access_mode, v_scope_mode;
  end if;

  if public.release_rescue_status_starts_review(new.status) then
    -- A provider-side grant is the evidence that the customer could act on that
    -- repository at all. Without one, "installed our app" is only a claim.
    select count(*) into v_live_grants
      from public.release_rescue_repository_grants g
     where g.engagement_id = new.id
       and g.organization_id = new.organization_id
       and g.access_level = 'read_only';

    if v_live_grants = 0 then
      raise exception
        'A review cannot start before a repository access grant is recorded for this engagement';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_release_rescue_access_mode on public.release_rescue_engagements;
create trigger trg_release_rescue_access_mode
  before insert or update on public.release_rescue_engagements
  for each row execute function public.enforce_release_rescue_access_mode();

-- --------------------------------------------------------------------------------
-- 3. Report rows cannot contradict themselves or their own body
-- --------------------------------------------------------------------------------
--
-- The previous trigger checked two of the four verdicts, left coverage unpinned,
-- and never compared the row to the artifact it points at. A row could therefore
-- read "release_with_tracked_findings" (whose customer copy says nothing reached
-- high severity and nothing blocks the release) beside nine blocking findings,
-- and could claim one-of-one coverage against a thirty-two check rubric.

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
  v_payload jsonb;
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

  select platform_role into v_reviewer_role from public.operators where user_id = new.reviewed_by;
  if v_reviewer_role is null or v_reviewer_role not in ('ops_manager', 'platform_admin') then
    raise exception 'Report reviewer must be an ops manager or platform admin';
  end if;

  -- The accounting row must say what its own body says. Without this the row is
  -- free text beside an artifact nobody compares it to.
  v_payload := v_artifact.payload;
  if v_payload ? 'verdict' and v_payload->>'verdict' is distinct from new.verdict then
    raise exception 'Report row verdict "%" contradicts its body ("%")', new.verdict, v_payload->>'verdict';
  end if;
  if v_payload ? 'blockingFindingCount'
     and (v_payload->>'blockingFindingCount')::integer is distinct from new.blocking_finding_count then
    raise exception 'Report row blocking count % contradicts its body (%)',
      new.blocking_finding_count, v_payload->>'blockingFindingCount';
  end if;
  if v_payload #> '{coverage,totalChecks}' is not null
     and (v_payload #>> '{coverage,totalChecks}')::integer is distinct from new.coverage_total_checks then
    raise exception 'Report row coverage total % contradicts its body (%)',
      new.coverage_total_checks, v_payload #>> '{coverage,totalChecks}';
  end if;
  if v_payload #> '{coverage,assessedChecks}' is not null
     and (v_payload #>> '{coverage,assessedChecks}')::integer is distinct from new.coverage_assessed_checks then
    raise exception 'Report row assessed count % contradicts its body (%)',
      new.coverage_assessed_checks, v_payload #>> '{coverage,assessedChecks}';
  end if;

  if new.coverage_assessed_checks > new.coverage_total_checks then
    raise exception 'Assessed checks cannot exceed total checks';
  end if;

  -- Every verdict is cross-checked against the blocking count, not just two.
  -- The customer copy for release_with_tracked_findings says nothing blocks the
  -- release; a row claiming it beside blocking findings would make that a lie.
  if new.blocking_finding_count > 0 and new.verdict <> 'release_blocked' then
    raise exception 'Verdict "%" cannot coexist with % blocking finding(s)', new.verdict, new.blocking_finding_count;
  end if;
  if new.verdict = 'release_blocked' and new.blocking_finding_count = 0 then
    raise exception 'A release_blocked verdict requires at least one blocking finding';
  end if;
  if new.verdict = 'no_blocking_findings_identified'
     and (new.critical_count > 0 or new.high_count > 0 or new.medium_count > 0 or new.low_count > 0) then
    raise exception 'A no-blocking-findings verdict cannot carry findings above informational';
  end if;
  if new.verdict = 'release_with_tracked_findings' and (new.critical_count > 0 or new.high_count > 0) then
    raise exception 'A tracked-findings verdict cannot carry critical or high findings';
  end if;

  return new;
end;
$$;

-- --------------------------------------------------------------------------------
-- 4. The purge branch is gated on privilege, not on a flag anyone can set
-- --------------------------------------------------------------------------------
--
-- `delegation.retention_purge` is a custom GUC, and any role can set_config it.
-- The report immutability trigger gated its purge branch on that flag alone, so
-- a caller with UPDATE rights could set the flag themselves and clear a
-- delivered report's body pointer outside any sweep.
--
-- The flag now only counts when the caller could actually have run the sweep.
-- EXECUTE on the purge function is granted to service_role alone, so this is
-- true inside the security-definer sweep and false for `authenticated`.

create or replace function public.release_rescue_in_retention_purge()
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(current_setting('delegation.retention_purge', true), 'off') = 'on'
     and has_function_privilege(
           current_user,
           'public.purge_expired_release_rescue_data(text)',
           'EXECUTE'
         );
$$;

-- SECURITY INVOKER, deliberately.
--
-- Inside a SECURITY DEFINER function, current_user is the function OWNER, not
-- the caller — so a privilege check written there answers for the wrong role and
-- always passes. This trigger reads only NEW, OLD, and the purge flag; it needs
-- no elevated rights, and invoker rights are what make the privilege check below
-- mean "the caller could have run the sweep".
--
-- When the sweep itself issues the UPDATE, this trigger runs inside that
-- security-definer function, so current_user is its owner and the check passes.
-- When `authenticated` issues it directly, current_user is `authenticated`, which
-- holds no EXECUTE on the sweep, and the update is refused.
create or replace function public.enforce_release_rescue_report_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Release Rescue report records are retained as accounting rows. Retention purge clears their content instead of deleting them';
  end if;

  if public.release_rescue_in_retention_purge() then
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

-- The evidence-artifact carve-out gets the same treatment: the flag alone was
-- never sufficient there either, though no role outside service_role holds a
-- DELETE grant on that table to reach it.
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
    if not public.release_rescue_in_retention_purge() then
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

-- --------------------------------------------------------------------------------
-- 5. A grant's revocation reason is part of the record
-- --------------------------------------------------------------------------------
-- It was excluded from the immutability diff, so the stated reason for revoking
-- access could be rewritten at any time on any grant.

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
    if to_jsonb(new) - 'revoked_at' - 'revocation_reason' - 'updated_at'
       is distinct from
       to_jsonb(old) - 'revoked_at' - 'revocation_reason' - 'updated_at' then
      raise exception 'A repository access grant may only be revoked, never edited';
    end if;
    if old.revoked_at is not null then
      if new.revoked_at is distinct from old.revoked_at then
        raise exception 'A revoked repository access grant cannot be reopened';
      end if;
      -- No purge exemption is needed here: the retention sweep only sets a
      -- reason on a grant that does not yet have one (it filters on
      -- `revoked_at is null`), so it never reaches this branch.
      if new.revocation_reason is distinct from old.revocation_reason then
        raise exception 'The recorded reason for revoking access cannot be rewritten';
      end if;
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
