-- Extend immutable typed-evidence protection to the Grounded supplier-sourcing
-- contracts. The existing evidence_artifacts table remains the sole evidence
-- store; this only extends the schema-version allowlist for its hash guard.

create or replace function public.enforce_typed_evidence_artifact()
returns trigger
language plpgsql
set search_path = public
as $$
declare declared_version text;
begin
  declared_version := new.payload->>'schemaVersion';
  if declared_version is null then return new; end if;
  if declared_version in (
    'catalog-evidence-input/v1',
    'catalog-evidence-packet/v1',
    'catalog-evidence-review/v1',
    'catalog-evidence-validation/v1',
    'catalog-evidence-rejection/v1',
    'supplier-sourcing-input/v1',
    'supplier-sourcing-packet/v1',
    'supplier-sourcing-review/v1',
    'supplier-sourcing-validation/v1',
    'supplier-sourcing-rejection/v1'
  ) then
    if new.content_hash is null or new.content_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'A % artifact requires a sha256 content hash', declared_version;
    end if;
  end if;
  return new;
end;
$$;
