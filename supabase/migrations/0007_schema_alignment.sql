-- Align catalog + housekeeping with the current domain.
-- deliveries is the persisted DeliveryPackage table (not a separate delivery_packages table).

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_workstreams_updated on public.workstreams;
create trigger trg_workstreams_updated
  before update on public.workstreams
  for each row execute function public.set_updated_at();

drop trigger if exists trg_requests_updated on public.requests;
create trigger trg_requests_updated
  before update on public.requests
  for each row execute function public.set_updated_at();

drop trigger if exists trg_playbooks_updated on public.playbooks;
create trigger trg_playbooks_updated
  before update on public.playbooks
  for each row execute function public.set_updated_at();

insert into public.workstream_templates (name, slug, objective, sla, recurring_tasks, metrics)
values
  (
    'Executive Operations',
    'executive-operations',
    'Protect founder time with briefing, follow-through, and decision logistics.',
    'Same-day on urgent, 1 business day otherwise',
    '["Daily priority brief","Decision log upkeep","Follow-up chase list"]'::jsonb,
    '["Hours returned","Brief on-time rate","Open decisions"]'::jsonb
  ),
  (
    'Inbox Operations',
    'inbox-operations',
    'Triage, draft, and file communications so only decisions reach the founder.',
    'Inbox zero-ready draft pack twice daily',
    '["Morning triage","Draft replies","Label and file"]'::jsonb,
    '["Messages processed","Response latency","Escalation rate"]'::jsonb
  ),
  (
    'Sales Operations',
    'sales-operations',
    'Keep pipeline hygiene, proposals, and follow-ups moving without founder admin.',
    'CRM updates same day; proposals in 2 business days',
    '["Pipeline hygiene","Proposal assembly","Follow-up sequences"]'::jsonb,
    '["Stale deals","Proposal cycle time","Follow-up coverage"]'::jsonb
  ),
  (
    'Meeting Operations',
    'meeting-operations',
    'Schedule, prep, capture, and convert meetings into owned next steps.',
    'Agenda 4 hours before; notes within 4 hours after',
    '["Scheduling","Agenda packs","Notes and actions"]'::jsonb,
    '["Prep on-time","Action capture rate","Hours in meetings avoided"]'::jsonb
  ),
  (
    'Research Desk',
    'research-desk',
    'Produce sourced briefs the team can act on without starting from a blank page.',
    'Standard brief in 2 business days',
    '["Market scans","Account research","Competitive notes"]'::jsonb,
    '["Briefs delivered","Source completeness","Reuse rate"]'::jsonb
  ),
  (
    'Customer Operations',
    'customer-operations',
    'Onboard, renew, and support accounts with a consistent operating rhythm.',
    'Onboarding pack in 1 business day; renewals 14 days out',
    '["Onboarding checklists","Health reviews","Renewal prep"]'::jsonb,
    '["Time to onboard","At-risk accounts","Renewal readiness"]'::jsonb
  ),
  (
    'Content Operations',
    'content-operations',
    'Turn approved points of view into drafts, assets, and a publish-ready queue.',
    'First draft in 3 business days; publish only after approval',
    '["Editorial calendar","Draft production","Asset packaging"]'::jsonb,
    '["Drafts delivered","Revision cycles","Publish-ready queue"]'::jsonb
  ),
  (
    'Back Office Operations',
    'back-office-operations',
    'Keep billing, vendors, and reporting current without founder bookkeeping.',
    'Weekly close pack every Friday; invoices within 1 day of trigger',
    '["Invoice prep","Vendor follow-up","Weekly operating report"]'::jsonb,
    '["Close on-time","Aging invoices","Report punctuality"]'::jsonb
  )
on conflict (slug) do update
  set name = excluded.name,
      objective = excluded.objective,
      sla = excluded.sla,
      recurring_tasks = excluded.recurring_tasks,
      metrics = excluded.metrics;

create or replace view public.delivery_packages as
  select * from public.deliveries;
