-- CS-12: persist canonical Native Skill objects without seeding or promotion.
--
-- Additive only. This migration does not create a Skill, qualify an executor,
-- route work, grant runtime authority, or alter the frozen Step 3D work cell.
-- Apply to Delegation Cloud QA before Production and validate every stored
-- payload through src/lib/native-skill-registry.ts.

create table public.native_skills (
  id uuid primary key default gen_random_uuid(),
  skill_key text not null,
  skill_version text not null,
  capability_key text not null references public.capabilities(key) on delete restrict,
  definition_hash text not null check (definition_hash ~ '^[0-9a-f]{64}$'),
  procedure_hash text not null check (procedure_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('candidate', 'shadow', 'qualified', 'suspended', 'retired')),
  payload jsonb not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (skill_key, skill_version),
  check (jsonb_typeof(payload) = 'object'),
  check (
    payload ?& array[
      'schemaVersion',
      'skillKey',
      'skillVersion',
      'capabilityKey',
      'procedureArtifact',
      'mayOwnAuthoritativeState',
      'qualificationHistory',
      'approval',
      'definitionHash',
      'status'
    ]
  ),
  check (payload ->> 'schemaVersion' = 'native-skill/v1'),
  check (payload ->> 'skillKey' = skill_key),
  check (payload ->> 'skillVersion' = skill_version),
  check (payload ->> 'capabilityKey' = capability_key),
  check (payload ->> 'definitionHash' = definition_hash),
  check (payload -> 'procedureArtifact' ->> 'contentHash' = procedure_hash),
  check (payload ->> 'status' = status),
  check (payload @> '{"mayOwnAuthoritativeState":false}'::jsonb),
  check (jsonb_typeof(payload -> 'qualificationHistory') = 'array'),
  check (
    (status in ('candidate', 'shadow') and payload -> 'approval' = 'null'::jsonb)
    or (status in ('qualified', 'suspended') and payload -> 'approval' <> 'null'::jsonb)
    or status = 'retired'
  )
);

create index native_skills_status_key_idx
  on public.native_skills (status, skill_key, skill_version);
create index native_skills_capability_idx
  on public.native_skills (capability_key, status);

create or replace function public.protect_native_skill_definition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_history jsonb := old.payload -> 'qualificationHistory';
  new_history jsonb := new.payload -> 'qualificationHistory';
begin
  if old.skill_key is distinct from new.skill_key
     or old.skill_version is distinct from new.skill_version
     or old.capability_key is distinct from new.capability_key
     or old.definition_hash is distinct from new.definition_hash
     or old.procedure_hash is distinct from new.procedure_hash
     or old.created_by is distinct from new.created_by then
    raise exception 'Native Skill identity and definition hashes are immutable'
      using errcode = '23514';
  end if;

  if (old.payload - array['status', 'qualificationHistory', 'approval'])
     is distinct from
     (new.payload - array['status', 'qualificationHistory', 'approval']) then
    raise exception 'Canonical Native Skill definition is immutable'
      using errcode = '23514';
  end if;

  if jsonb_array_length(new_history) < jsonb_array_length(old_history)
     or not (new_history @> old_history) then
    raise exception 'Native Skill qualification history is append-only'
      using errcode = '23514';
  end if;

  if old.payload -> 'approval' <> 'null'::jsonb
     and new.payload -> 'approval' is distinct from old.payload -> 'approval' then
    raise exception 'Native Skill qualification approval must be preserved'
      using errcode = '23514';
  end if;

  if old.status is distinct from new.status
     and not (
       (old.status = 'candidate' and new.status in ('shadow', 'retired'))
       or (old.status = 'shadow' and new.status in ('qualified', 'retired'))
       or (old.status = 'qualified' and new.status in ('suspended', 'retired'))
       or (old.status = 'suspended' and new.status in ('qualified', 'retired'))
     ) then
    raise exception 'Invalid Native Skill lifecycle transition: % -> %', old.status, new.status
      using errcode = '23514';
  end if;

  return new;
end
$$;

create trigger trg_native_skills_protect_definition
  before update on public.native_skills
  for each row execute function public.protect_native_skill_definition();

create trigger trg_native_skills_updated
  before update on public.native_skills
  for each row execute function public.set_updated_at();

alter table public.native_skills enable row level security;

grant select, insert, update on public.native_skills to authenticated;
grant all on public.native_skills to service_role;

create policy native_skills_select on public.native_skills
  for select to authenticated
  using (public.is_platform_staff());

create policy native_skills_insert on public.native_skills
  for insert to authenticated
  with check (public.is_ops_manager() and created_by = (select auth.uid()));

create policy native_skills_update on public.native_skills
  for update to authenticated
  using (public.is_ops_manager())
  with check (public.is_ops_manager());

-- Deliberately no seed. Runs 4-5 did not qualify a Catalog Integrity Skill.
