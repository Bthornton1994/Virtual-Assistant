-- Execution Runtime v1 lease reaper RPC.
-- The schema and worker lifecycle RPCs are installed by prior migrations.
create or replace function public.reap_execution_leases(p_limit integer default 100)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_attempt record;
  v_count integer := 0;
begin
  if current_user <> 'service_role' then raise exception 'Execution runtime mutations require the service role'; end if;
  if p_limit < 1 or p_limit > 1000 then raise exception 'Reap limit must be between 1 and 1000'; end if;
  for v_attempt in
    select id, worker_id, lease_token_hash
      from public.execution_attempts
     where status = 'running' and lease_expires_at <= now()
     order by lease_expires_at, created_at
     limit p_limit
     for update skip locked
  loop
    perform public.fail_execution_attempt(
      v_attempt.id, v_attempt.worker_id, v_attempt.lease_token_hash,
      'external_dependency', 'lease_expired',
      'Worker lease expired before the attempt completed.', '{}'::jsonb,
      0, 0, 0, true
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.reap_execution_leases(integer) from public, anon, authenticated;
grant execute on function public.reap_execution_leases(integer) to service_role;
