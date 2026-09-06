-- SF-TWL-PREPARE-PROOF-01 database-boundary hardening.
--
-- Adversarial review found three alternate paths around the application gate:
-- 1. an ops manager could insert an Outcome Receipt directly;
-- 2. generic evidence insertion could impersonate the reserved TWL schemas;
-- 3. a manager assigned as the human worker could verify their own work.
--
-- This migration makes those states unreachable at the database boundary.
-- Reserved evidence is written only by purpose-built SECURITY DEFINER RPCs.
-- Authenticated callers are denied the reserved schemaVersion values by RLS.
-- Public GitHub PR evidence is fetched by PostgreSQL itself over anonymous HTTPS
-- GET, so a caller cannot substitute self-authored JSON for observed metadata.

create extension if not exists http with schema extensions;

-- Canonical JSON serializer matching src/lib/catalog-evidence-hash.ts for the
-- scalar/object/array shapes used by the TWL proof. Object keys are sorted,
-- arrays preserve order, and output is compact JSON before SHA-256.
create or replace function public.twl_prepare_proof_canonical_json(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_type text := jsonb_typeof(p_value);
  v_result text;
begin
  if v_type = 'object' then
    select '{' || coalesce(
      string_agg(to_jsonb(e.key)::text || ':' || public.twl_prepare_proof_canonical_json(e.value), ',' order by e.key),
      ''
    ) || '}'
      into v_result
      from jsonb_each(p_value) as e(key, value);
    return v_result;
  end if;

  if v_type = 'array' then
    select '[' || coalesce(
      string_agg(public.twl_prepare_proof_canonical_json(a.value), ',' order by a.ordinality),
      ''
    ) || ']'
      into v_result
      from jsonb_array_elements(p_value) with ordinality as a(value, ordinality);
    return v_result;
  end if;

  return p_value::text;
end;
$$;

create or replace function public.twl_prepare_proof_sha256(p_value jsonb)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select encode(
    extensions.digest(public.twl_prepare_proof_canonical_json(p_value), 'sha256'),
    'hex'
  );
$$;

create or replace function public.is_twl_prepare_proof_run(p_run_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.workstream_runs wr
      join public.delegation_specs ds
        on ds.id = wr.delegation_spec_id
       and ds.organization_id = wr.organization_id
     where wr.id = p_run_id
       and ds.action_class = 'prepare_only'
       and ds.required_inputs ? 'twl-prepare-proof/v1'
  );
$$;

revoke all on function public.is_twl_prepare_proof_run(uuid) from public;
grant execute on function public.is_twl_prepare_proof_run(uuid) to authenticated;

-- The reserved schemas are singleton control-plane artifacts for a proof run.
create unique index if not exists twl_prepare_proof_one_reserved_artifact_per_run_idx
  on public.evidence_artifacts (run_id, (payload->>'schemaVersion'))
  where payload->>'schemaVersion' in (
    'twl-prepare-proof-assignment/v1',
    'twl-prepare-proof-pr/v1'
  );

-- The generic evidence path remains available for ordinary evidence, but it may
-- not impersonate either reserved TWL control-plane schema. The SECURITY DEFINER
-- writers below execute as the migration owner and therefore do not depend on
-- this authenticated RLS policy to persist their validated rows.
drop policy if exists evidence_artifacts_insert on public.evidence_artifacts;
create policy evidence_artifacts_insert on public.evidence_artifacts
  for insert to authenticated
  with check (
    public.is_platform_staff()
    and coalesce(payload->>'schemaVersion', '') not in (
      'twl-prepare-proof-assignment/v1',
      'twl-prepare-proof-pr/v1'
    )
  );

-- Defense in depth for trusted SQL paths that do not traverse authenticated RLS.
-- A direct authenticated insert executes as role authenticated; the dedicated
-- SECURITY DEFINER functions below execute as their postgres owner.
create or replace function public.enforce_twl_prepare_proof_artifact_writer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_schema text := new.payload->>'schemaVersion';
begin
  if v_schema not in ('twl-prepare-proof-assignment/v1', 'twl-prepare-proof-pr/v1') then
    return new;
  end if;

  if not public.is_twl_prepare_proof_run(new.run_id) then
    raise exception 'Reserved TWL proof evidence may only be attached to an SF-TWL-PREPARE-PROOF-01 run';
  end if;

  if current_user <> 'postgres' then
    raise exception 'Reserved TWL proof evidence must be written by its database-owned writer';
  end if;

  if new.created_by is null then
    raise exception 'Reserved TWL proof evidence requires an authenticated creator';
  end if;

  if new.content_hash is null or new.content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Reserved TWL proof evidence requires a sha256 content hash';
  end if;

  return new;
end;
$$;

-- Replay-safe: QA already installed this trigger via connected-API version
-- 20260906191128. A later repository push of this file must not fail on
-- "trigger already exists".
drop trigger if exists trg_twl_prepare_proof_artifact_writer on public.evidence_artifacts;
create trigger trg_twl_prepare_proof_artifact_writer
  before insert on public.evidence_artifacts
  for each row execute function public.enforce_twl_prepare_proof_artifact_writer();

create or replace function public.twl_prepare_proof_assign_worker(
  p_run_id uuid,
  p_worker_kind text,
  p_worker_key uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_request_id uuid;
  v_run_status text;
  v_display_name text;
  v_worker_key text;
  v_worker_user_id uuid;
  v_now_text text;
  v_summary text;
  v_payload jsonb;
  v_content_hash text;
  v_artifact_id uuid;
begin
  if v_actor is null or not public.is_platform_staff() then
    raise exception 'Only authenticated operations staff may assign a TWL proof worker';
  end if;

  select wr.organization_id, wr.request_id, wr.status
    into v_org_id, v_request_id, v_run_status
    from public.workstream_runs wr
   where wr.id = p_run_id
     and public.is_twl_prepare_proof_run(wr.id);

  if v_org_id is null then
    raise exception 'SF-TWL-PREPARE-PROOF-01 run not found';
  end if;
  if v_run_status <> 'running' then
    raise exception 'Start the TWL proof run before assigning a worker';
  end if;

  if p_worker_kind = 'shadow' then
    if p_worker_key is not null then
      raise exception 'The TWL shadow worker does not accept a caller-supplied operator id';
    end if;
    v_worker_key := 'sf-twl-prepare-proof-shadow-v1';
    v_worker_user_id := null;
    v_display_name := 'SF-TWL prepare-only shadow';
  elsif p_worker_kind = 'human_operator' then
    if p_worker_key is null then
      raise exception 'A human TWL proof assignment requires an operator id';
    end if;
    select o.id::text, o.user_id, o.name
      into v_worker_key, v_worker_user_id, v_display_name
      from public.operators o
     where o.id = p_worker_key
       and o.status = 'active';
    if v_worker_key is null or v_worker_user_id is null then
      raise exception 'The selected TWL proof operator is not active or does not exist';
    end if;
  else
    raise exception 'TWL proof worker kind must be shadow or human_operator';
  end if;

  v_now_text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_payload := jsonb_build_object(
    'schemaVersion', 'twl-prepare-proof-assignment/v1',
    'workerKind', p_worker_kind,
    'workerKey', v_worker_key,
    'workerUserId', case when v_worker_user_id is null then null else to_jsonb(v_worker_user_id::text) end,
    'displayName', v_display_name,
    'mayOwnAccept', false,
    'actionClass', 'prepare_only',
    'assignedBy', v_actor::text,
    'assignedAt', v_now_text
  );
  v_payload := v_payload || jsonb_build_object(
    'payloadHash', public.twl_prepare_proof_sha256(v_payload)
  );

  v_summary := case
    when p_worker_kind = 'shadow' then
      'Assigned the prepare-only shadow worker. It cannot Accept, merge, deploy, or write to GitHub.'
    else
      format('Assigned human operator %s. This worker cannot Accept alone.', v_display_name)
  end;

  v_content_hash := public.twl_prepare_proof_sha256(jsonb_build_object(
    'kind', 'observation',
    'summary', v_summary,
    'sourceUri', null,
    'payload', v_payload
  ));

  insert into public.evidence_artifacts (
    organization_id, run_id, request_id, kind, summary, source_uri,
    content_hash, payload, created_by
  ) values (
    v_org_id, p_run_id, v_request_id, 'observation', v_summary, null,
    v_content_hash, v_payload, v_actor
  ) returning id into v_artifact_id;

  return v_artifact_id;
end;
$$;

revoke all on function public.twl_prepare_proof_assign_worker(uuid, text, uuid) from public;
revoke all on function public.twl_prepare_proof_assign_worker(uuid, text, uuid) from anon;
grant execute on function public.twl_prepare_proof_assign_worker(uuid, text, uuid) to authenticated;

create or replace function public.twl_prepare_proof_attach_public_pr(
  p_run_id uuid,
  p_owner text,
  p_repo text,
  p_pull_number integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_org_id uuid;
  v_request_id uuid;
  v_run_status text;
  v_url text;
  v_status_url text;
  v_response extensions.http_response;
  v_status_response extensions.http_response;
  v_body jsonb;
  v_status_body jsonb;
  v_html_url text;
  v_head_sha text;
  v_base_sha text;
  v_title text;
  v_state text;
  v_draft boolean;
  v_merged boolean;
  v_ci text;
  v_now_text text;
  v_summary text;
  v_payload jsonb;
  v_content_hash text;
  v_artifact_id uuid;
begin
  if v_actor is null or not public.is_platform_staff() then
    raise exception 'Only authenticated operations staff may attach TWL public PR evidence';
  end if;

  if p_owner is null or p_owner !~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$' then
    raise exception 'Invalid GitHub owner';
  end if;
  if p_repo is null or p_repo !~ '^[A-Za-z0-9._-]{1,100}$' then
    raise exception 'Invalid GitHub repository';
  end if;
  if p_pull_number is null or p_pull_number <= 0 then
    raise exception 'Invalid GitHub pull request number';
  end if;

  select wr.organization_id, wr.request_id, wr.status
    into v_org_id, v_request_id, v_run_status
    from public.workstream_runs wr
   where wr.id = p_run_id
     and public.is_twl_prepare_proof_run(wr.id);

  if v_org_id is null then
    raise exception 'SF-TWL-PREPARE-PROOF-01 run not found';
  end if;
  if v_run_status <> 'running' then
    raise exception 'Start the TWL proof run before attaching public PR evidence';
  end if;

  v_url := format('https://api.github.com/repos/%s/%s/pulls/%s', p_owner, p_repo, p_pull_number);
  select * into v_response from extensions.http_get(v_url);
  if v_response.status <> 200 then
    raise exception 'Public GitHub PR GET failed with status %. Private or missing repositories are not valid public proof targets.', v_response.status;
  end if;

  v_body := v_response.content::jsonb;
  if coalesce((v_body->>'number')::integer, 0) <> p_pull_number then
    raise exception 'GitHub PR response did not match the requested pull number';
  end if;

  v_html_url := v_body->>'html_url';
  v_head_sha := v_body#>>'{head,sha}';
  v_base_sha := v_body#>>'{base,sha}';
  v_title := v_body->>'title';
  v_state := v_body->>'state';
  v_draft := coalesce((v_body->>'draft')::boolean, false);
  v_merged := coalesce((v_body->>'merged')::boolean, false);

  if v_html_url is null or lower(v_html_url) <> lower(format('https://github.com/%s/%s/pull/%s', p_owner, p_repo, p_pull_number)) then
    raise exception 'GitHub PR response HTML URL did not match the requested public pull';
  end if;
  if coalesce(v_head_sha, '') !~ '^[0-9a-fA-F]{40}$' then
    raise exception 'GitHub PR response did not contain a valid head SHA';
  end if;
  if coalesce(v_base_sha, '') !~ '^[0-9a-fA-F]{40}$' then
    raise exception 'GitHub PR response did not contain a valid base SHA';
  end if;
  if coalesce(length(btrim(v_title)), 0) = 0 or coalesce(length(btrim(v_state)), 0) = 0 then
    raise exception 'GitHub PR response was missing required metadata';
  end if;

  v_status_url := format('https://api.github.com/repos/%s/%s/commits/%s/status', p_owner, p_repo, v_head_sha);
  select * into v_status_response from extensions.http_get(v_status_url);
  if v_status_response.status = 200 then
    v_status_body := v_status_response.content::jsonb;
    v_ci := nullif(v_status_body->>'state', '');
  else
    v_ci := null;
  end if;

  v_now_text := to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  v_payload := jsonb_build_object(
    'schemaVersion', 'twl-prepare-proof-pr/v1',
    'owner', p_owner,
    'repo', p_repo,
    'pullNumber', p_pull_number,
    'htmlUrl', v_html_url,
    'headSha', lower(v_head_sha),
    'baseSha', lower(v_base_sha),
    'title', v_title,
    'state', v_state,
    'draft', v_draft,
    'upstreamMerged', v_merged,
    'ciConclusion', v_ci,
    'mutatesRepository', false,
    'mergePerformed', false,
    'requestedMethod', 'GET',
    'fetchedAt', v_now_text,
    'source', 'github-public-api'
  );
  v_payload := v_payload || jsonb_build_object(
    'payloadHash', public.twl_prepare_proof_sha256(v_payload)
  );

  v_summary := format(
    'Read-only public PR %s/%s#%s. mutatesRepository=false; merge_performed=false.',
    p_owner, p_repo, p_pull_number
  );
  v_content_hash := public.twl_prepare_proof_sha256(jsonb_build_object(
    'kind', 'source',
    'summary', v_summary,
    'sourceUri', v_html_url,
    'payload', v_payload
  ));

  insert into public.evidence_artifacts (
    organization_id, run_id, request_id, kind, summary, source_uri,
    content_hash, payload, created_by
  ) values (
    v_org_id, p_run_id, v_request_id, 'source', v_summary, v_html_url,
    v_content_hash, v_payload, v_actor
  ) returning id into v_artifact_id;

  return v_artifact_id;
end;
$$;

revoke all on function public.twl_prepare_proof_attach_public_pr(uuid, text, text, integer) from public;
revoke all on function public.twl_prepare_proof_attach_public_pr(uuid, text, text, integer) from anon;
grant execute on function public.twl_prepare_proof_attach_public_pr(uuid, text, text, integer) to authenticated;

-- Final database receipt gate. This mirrors the proof's deterministic checks so
-- direct inserts through an alternate Supabase client cannot bypass the app.
create or replace function public.enforce_twl_prepare_proof_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_action_class text;
  v_assignment public.evidence_artifacts%rowtype;
  v_pr public.evidence_artifacts%rowtype;
  v_worker_user_id uuid;
  v_expected_hash text;
begin
  if new.verification_status <> 'passed' or not new.definition_of_done_met then
    return new;
  end if;

  if not public.is_twl_prepare_proof_run(new.run_id) then
    return new;
  end if;

  if auth.uid() is null or not public.is_ops_manager() then
    raise exception 'Only an authenticated operations manager may pass the TWL prepare-only proof';
  end if;
  if new.verified_by is distinct from auth.uid() then
    raise exception 'TWL Outcome Receipt verified_by must equal the authenticated verifier';
  end if;

  select ds.action_class into v_action_class
    from public.workstream_runs wr
    join public.delegation_specs ds
      on ds.id = wr.delegation_spec_id
     and ds.organization_id = wr.organization_id
   where wr.id = new.run_id
     and wr.organization_id = new.organization_id;
  if v_action_class is distinct from 'prepare_only' then
    raise exception 'TWL proof action_class must be prepare_only';
  end if;

  select ea.* into v_assignment
    from public.evidence_artifacts ea
   where ea.run_id = new.run_id
     and ea.payload->>'schemaVersion' = 'twl-prepare-proof-assignment/v1';
  if v_assignment.id is null then
    raise exception 'A database-reserved TWL assignment artifact is required';
  end if;

  select ea.* into v_pr
    from public.evidence_artifacts ea
   where ea.run_id = new.run_id
     and ea.payload->>'schemaVersion' = 'twl-prepare-proof-pr/v1';
  if v_pr.id is null then
    raise exception 'A database-observed public GitHub PR artifact is required';
  end if;

  if v_assignment.kind <> 'observation'
     or v_assignment.payload->>'mayOwnAccept' is distinct from 'false'
     or v_assignment.payload->>'actionClass' is distinct from 'prepare_only' then
    raise exception 'TWL assignment artifact failed deterministic validation';
  end if;
  if v_assignment.payload->>'assignedBy' is distinct from v_assignment.created_by::text then
    raise exception 'TWL assignment artifact attribution does not match its creator';
  end if;
  v_expected_hash := public.twl_prepare_proof_sha256(v_assignment.payload - 'payloadHash');
  if v_assignment.payload->>'payloadHash' is distinct from v_expected_hash then
    raise exception 'TWL assignment payload hash mismatch';
  end if;
  v_expected_hash := public.twl_prepare_proof_sha256(jsonb_build_object(
    'kind', v_assignment.kind,
    'summary', v_assignment.summary,
    'sourceUri', v_assignment.source_uri,
    'payload', v_assignment.payload
  ));
  if v_assignment.content_hash is distinct from v_expected_hash then
    raise exception 'TWL assignment evidence envelope hash mismatch';
  end if;

  if v_assignment.payload->>'workerKind' = 'human_operator' then
    begin
      v_worker_user_id := (v_assignment.payload->>'workerUserId')::uuid;
    exception when invalid_text_representation then
      raise exception 'TWL human assignment workerUserId is not a valid user id';
    end;
    if v_worker_user_id is null then
      raise exception 'TWL human assignment requires a frozen workerUserId';
    end if;
    if not exists (
      select 1
        from public.operators o
       where o.id = (v_assignment.payload->>'workerKey')::uuid
         and o.user_id = v_worker_user_id
         and o.name = v_assignment.payload->>'displayName'
    ) then
      raise exception 'TWL human assignment no longer matches its frozen operator identity';
    end if;
    if v_worker_user_id = new.verified_by then
      raise exception 'The assigned TWL worker cannot issue their own Outcome Receipt';
    end if;
  elsif v_assignment.payload->>'workerKind' = 'shadow' then
    if v_assignment.payload->>'workerKey' is distinct from 'sf-twl-prepare-proof-shadow-v1'
       or v_assignment.payload->'workerUserId' <> 'null'::jsonb then
      raise exception 'TWL shadow assignment used an invalid frozen identity';
    end if;
  else
    raise exception 'TWL assignment workerKind is invalid';
  end if;

  if v_pr.kind <> 'source'
     or v_pr.payload->>'requestedMethod' is distinct from 'GET'
     or v_pr.payload->>'mutatesRepository' is distinct from 'false'
     or v_pr.payload->>'mergePerformed' is distinct from 'false'
     or v_pr.payload->>'source' is distinct from 'github-public-api'
     or v_pr.source_uri is distinct from v_pr.payload->>'htmlUrl' then
    raise exception 'TWL public PR artifact failed deterministic validation';
  end if;
  if coalesce(v_pr.payload->>'headSha', '') !~ '^[0-9a-fA-F]{40}$'
     or coalesce(v_pr.payload->>'baseSha', '') !~ '^[0-9a-fA-F]{40}$'
     or coalesce(v_pr.payload->>'htmlUrl', '') !~ '^https://github[.]com/[^/]+/[^/]+/pull/[0-9]+$' then
    raise exception 'TWL public PR artifact contains invalid source metadata';
  end if;
  v_expected_hash := public.twl_prepare_proof_sha256(v_pr.payload - 'payloadHash');
  if v_pr.payload->>'payloadHash' is distinct from v_expected_hash then
    raise exception 'TWL public PR payload hash mismatch';
  end if;
  v_expected_hash := public.twl_prepare_proof_sha256(jsonb_build_object(
    'kind', v_pr.kind,
    'summary', v_pr.summary,
    'sourceUri', v_pr.source_uri,
    'payload', v_pr.payload
  ));
  if v_pr.content_hash is distinct from v_expected_hash then
    raise exception 'TWL public PR evidence envelope hash mismatch';
  end if;

  return new;
end;
$$;

-- Replay-safe: QA already installed this trigger via connected-API version
-- 20260906191128. A later repository push of this file must not fail on
-- "trigger already exists".
drop trigger if exists trg_twl_prepare_proof_receipt_gate on public.outcome_receipts;
create trigger trg_twl_prepare_proof_receipt_gate
  before insert on public.outcome_receipts
  for each row execute function public.enforce_twl_prepare_proof_receipt();
