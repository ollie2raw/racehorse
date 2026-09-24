-- Review completion worker RPCs contain and mutate durable job payloads.
-- The client calls the HTTP routes only; RPC authority belongs to the server's
-- Supabase service-role key. Explicitly revoke Supabase's per-role default
-- function grants as well as PUBLIC EXECUTE.

begin;

revoke all on function public.claim_review_completion_job(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_review_completion_job(text, text, integer)
  to service_role;

revoke all on function public.checkpoint_review_completion_job(
  text, text, bigint, jsonb, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.checkpoint_review_completion_job(
  text, text, bigint, jsonb, text, integer, timestamptz
) to service_role;

revoke all on function public.list_claimable_review_completion_jobs(integer)
  from public, anon, authenticated;
grant execute on function public.list_claimable_review_completion_jobs(integer)
  to service_role;

-- Assert the effective client/service-role contract inside the migration.
-- has_function_privilege includes inherited grants; inspect ACL grantee 0
-- separately for PUBLIC because PUBLIC is a pseudo-role, not a role row.
do $$
declare
  fn regprocedure;
  targets regprocedure[] := array[
    'public.claim_review_completion_job(text, text, integer)',
    'public.checkpoint_review_completion_job(text, text, bigint, jsonb, text, integer, timestamptz)',
    'public.list_claimable_review_completion_jobs(integer)'
  ]::regprocedure[];
begin
  foreach fn in array targets
  loop
    if exists (
      select 1
        from pg_proc p
        cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
       where p.oid = fn::oid
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
    ) then
      raise exception 'review completion RPC remains executable by PUBLIC: %', fn;
    end if;

    if has_function_privilege('anon', fn, 'EXECUTE')
       or has_function_privilege('authenticated', fn, 'EXECUTE') then
      raise exception 'review completion RPC remains executable by a client role: %', fn;
    end if;

    if not has_function_privilege('service_role', fn, 'EXECUTE') then
      raise exception 'service_role lost EXECUTE on review completion RPC: %', fn;
    end if;
  end loop;

  raise notice 'review completion worker RPC EXECUTE restricted to service_role';
end $$;

commit;
