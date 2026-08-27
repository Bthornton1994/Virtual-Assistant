-- Grounded supplier sourcing capability.
--
-- Additive registry metadata only. This does not qualify an executor, create a
-- supplier relationship, grant messaging authority, or change any catalog.
-- The QA fixture supplies shadow profiles and pending mappings separately.

insert into public.capabilities (
  key,
  display_name,
  description,
  risk_class,
  input_contract_versions,
  output_contract_versions,
  verification_contract,
  status
) values (
  'supplier_sourcing',
  'Supplier sourcing research',
  'Prepare evidence-backed supplier, fulfillment, kit-assembly, and draft outreach candidates without contacting suppliers or asserting a relationship.',
  'high',
  '["supplier-sourcing-input/v1"]'::jsonb,
  '["supplier-sourcing-packet/v1"]'::jsonb,
  '{"kind":"deterministic","implementation":"supplier-sourcing-validator/v1"}'::jsonb,
  'active'
)
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  risk_class = excluded.risk_class,
  input_contract_versions = excluded.input_contract_versions,
  output_contract_versions = excluded.output_contract_versions,
  verification_contract = excluded.verification_contract,
  status = excluded.status;


-- Supplier review uses the independent-review capability contract, extended with
-- the supplier-specific input and review artifact versions.
update public.capabilities
   set input_contract_versions = '["catalog-evidence-input/v1","catalog-evidence-packet/v1","supplier-sourcing-input/v1","supplier-sourcing-packet/v1"]'::jsonb,
       output_contract_versions = '["catalog-evidence-review/v1","supplier-sourcing-review/v1"]'::jsonb
 where key = 'independent_evidence_review';

insert into public.capabilities (
  key,
  display_name,
  description,
  risk_class,
  input_contract_versions,
  output_contract_versions,
  verification_contract,
  status
) values (
  'deterministic_supplier_sourcing_validation',
  'Deterministic supplier sourcing validation',
  'Parse, hash, count, and enforce the supplier-sourcing evidence contract without deciding that a supplier relationship exists.',
  'high',
  '["supplier-sourcing-packet/v1","supplier-sourcing-review/v1"]'::jsonb,
  '["supplier-sourcing-validation/v1"]'::jsonb,
  '{"kind":"native","implementation":"supplier-sourcing-validator/v1"}'::jsonb,
  'active'
)
on conflict (key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  risk_class = excluded.risk_class,
  input_contract_versions = excluded.input_contract_versions,
  output_contract_versions = excluded.output_contract_versions,
  verification_contract = excluded.verification_contract,
  status = excluded.status;
