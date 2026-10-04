-- Tournament v2 preflight, piece D: verification (read-only; run after each of A, B, C and at the end).
-- Every row should show ok = true. Nothing here writes: the two smoke calls use a
-- zero uuid that matches no match row, and both functions raise match_not_found
-- before any UPDATE.

-- D1. Functions exist, with the expected signature, SECURITY DEFINER and a pinned search_path.
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef as security_definer,
       p.proconfig as config,
       case p.proname
         when '_tournament_is_bot' then true
         when '_tournament_advance_target' then true
         when '_tournament_canonical_scores' then true
         else p.prosecdef and p.proconfig @> array['search_path=public, pg_temp']
       end as ok
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
 where p.proname in ('_tournament_is_bot', '_tournament_advance_target', '_tournament_canonical_scores',
                     'complete_tournament_match', 'promote_tournament_match', 'generate_tournament_bracket',
                     'register_for_tournament', 'withdraw_from_tournament')
 order by p.proname;
-- Expect 8 rows, one per name. More than one row for a name means an overload
-- exists (an old signature was left behind) — stop and report it.

-- D2. EXECUTE: service_role only on the RPCs; nobody but the owner on the helpers.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       has_function_privilege('service_role', p.oid, 'execute')  as service_role,
       not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('authenticated', p.oid, 'execute')
         and (p.proname like '\_tournament\_%' or has_function_privilege('service_role', p.oid, 'execute')) as ok
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
 where p.proname in ('_tournament_is_bot', '_tournament_advance_target', '_tournament_canonical_scores',
                     'complete_tournament_match', 'promote_tournament_match', 'generate_tournament_bracket',
                     'register_for_tournament', 'withdraw_from_tournament')
 order by p.proname;

-- D3. generate_tournament_bracket is still the 09-29 v2 (not overwritten by the 08-31 v1).
select position('registrations_changed' in p.prosrc) > 0
       and position('bracket_partial_conflict' in p.prosrc) > 0 as ok_is_v2
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
 where p.proname = 'generate_tournament_bracket';

-- D4. Smoke calls: each must print "ok ... reachable". Nothing is written.
do $$
begin
  begin
    perform public.complete_tournament_match('00000000-0000-0000-0000-000000000000'::uuid, 'x', 'game_over');
    raise exception 'unexpected: complete_tournament_match succeeded on a missing match';
  exception when others then
    if sqlerrm <> 'match_not_found' then raise; end if;
    raise notice 'ok complete_tournament_match reachable (match_not_found as expected)';
  end;
  begin
    perform public.promote_tournament_match('00000000-0000-0000-0000-000000000000'::uuid, 'ready');
    raise exception 'unexpected: promote_tournament_match succeeded on a missing match';
  exception when others then
    if sqlerrm <> 'match_not_found' then raise; end if;
    raise notice 'ok promote_tournament_match reachable (match_not_found as expected)';
  end;
end $$;

-- D5. Security posture (the weekly CI check runs the same function).
select * from public.assert_security_posture();
