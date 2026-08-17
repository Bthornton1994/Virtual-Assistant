-- Product lifecycle: statuses, explicit approvals, QA, delivery, playbooks, recurrence.

alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests add constraint requests_status_check check (status in (
  'draft',
  'triage',
  'needs_clarification',
  'awaiting_plan_approval',
  'queued',
  'assigned',
  'in_progress',
  'blocked',
  'qa',
  'revision_required',
  'awaiting_action_approval',
  'ready_to_deliver',
  'delivered',
  'accepted',
  'cancelled'
));

alter table public.requests add column if not exists playbook_id uuid references public.playbooks(id);
alter table public.requests add column if not exists missing_context jsonb not null default '[]'::jsonb;
alter table public.requests add column if not exists customer_instructions text not null default '';
alter table public.requests add column if not exists internal_instructions text not null default '';
alter table public.requests add column if not exists qa_checklist jsonb not null default '[]'::jsonb;

alter table public.approvals add column if not exists kind text not null default 'execution_plan'
  check (kind in ('execution_plan','external_email','crm_destructive_change','vendor_communication','sensitive_action'));
alter table public.approvals add column if not exists action text not null default '';
alter table public.approvals add column if not exists description text not null default '';
alter table public.approvals add column if not exists risk_level text not null default 'low';

alter table public.playbook_versions add column if not exists "trigger" text not null default '';
alter table public.playbook_versions add column if not exists required_inputs jsonb not null default '[]'::jsonb;
alter table public.playbook_versions add column if not exists tools jsonb not null default '[]'::jsonb;
alter table public.playbook_versions add column if not exists authority_limits jsonb not null default '[]'::jsonb;
alter table public.playbook_versions add column if not exists approval_points jsonb not null default '[]'::jsonb;
alter table public.playbook_versions add column if not exists qa_checklist jsonb not null default '[]'::jsonb;
alter table public.playbook_versions add column if not exists known_exceptions jsonb not null default '[]'::jsonb;
alter table public.playbook_versions add column if not exists templates jsonb not null default '[]'::jsonb;

alter table public.comments add column if not exists visibility text not null default 'customer'
  check (visibility in ('customer','internal'));

alter table public.qa_reviews add column if not exists checklist jsonb not null default '[]'::jsonb;
alter table public.qa_reviews add column if not exists defects jsonb not null default '[]'::jsonb;

alter table public.workstreams add column if not exists schedule jsonb;
alter table public.workstreams add column if not exists next_run_at timestamptz;

create table if not exists public.clarifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  question text not null,
  asked_by uuid references auth.users(id),
  answer text,
  answered_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create table if not exists public.deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  summary text not null,
  deliverables jsonb not null default '[]'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  actions_taken jsonb not null default '[]'::jsonb,
  exceptions jsonb not null default '[]'::jsonb,
  unresolved_decisions jsonb not null default '[]'::jsonb,
  next_step text not null default '',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id uuid not null references public.requests(id) on delete cascade,
  author_id uuid references auth.users(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table public.clarifications enable row level security;
alter table public.deliveries enable row level security;
alter table public.internal_notes enable row level security;

create policy tenant_select_cl on public.clarifications
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_cl on public.clarifications
  for all using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy tenant_select_dl on public.deliveries
  for select using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());
create policy tenant_write_dl on public.deliveries
  for all using (organization_id in (select public.my_org_ids()) or public.is_platform_staff());

create policy tenant_select_inote on public.internal_notes
  for select using (public.is_platform_staff());
create policy tenant_write_inote on public.internal_notes
  for all using (public.is_platform_staff());

drop policy if exists tenant_select_c on public.comments;
create policy tenant_select_c on public.comments
  for select using (
    public.is_platform_staff()
    or (
      organization_id in (select public.my_org_ids())
      and visibility = 'customer'
    )
    or (
      organization_id in (select public.my_org_ids())
      and visibility = 'internal'
      and public.is_platform_staff()
    )
  );

create or replace function public.enforce_sensitive_approval()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'in_progress'
     and new.approval_level = 'sensitive_execution'
     and not exists (
       select 1 from public.approvals a
       where a.request_id = new.id
         and (a.kind = 'sensitive_action' or a.action_class = 'sensitive_execution')
         and a.status = 'approved'
     ) then
    raise exception 'Sensitive execution cannot proceed without explicit approval';
  end if;
  return new;
end;
$$;
