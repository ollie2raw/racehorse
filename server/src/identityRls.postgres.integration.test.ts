/**
 * Account-identity / data-authorization matrix against the REAL schema (every supabase/*.sql and migration) in an
 * owned loopback PostgreSQL, run AS the Supabase roles (`anon`, `authenticated`) with a verified-subject claim.
 * The database itself must reject cross-account access: principal (A, B, guest/anon) x resource owner x operation.
 *
 *   PGHOST=127.0.0.1 PGPORT=55439 PGUSER=postgres server/scripts/setupIdentityAuditDb.sh racehorse_identity_audit
 *   IDENTITY_AUDIT_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/racehorse_identity_audit npx vitest run src/identityRls.postgres.integration.test.ts
 *
 * Skipped unless that exact loopback URL is set. Never point this at a real project.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

const DB_URL = 'postgresql://postgres@127.0.0.1:55439/racehorse_identity_audit';
const enabled = process.env.IDENTITY_AUDIT_TEST_DATABASE_URL === DB_URL;
const d = enabled ? describe : describe.skip;

function psqlRaw(script: string): { ok: boolean; out: string; err: string } {
  if (!enabled) throw new Error('Refusing nonlocal database');
  try {
    const out = execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-At', DB_URL], {
      input: script,
      encoding: 'utf8',
      timeout: 20_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, out: out.trim(), err: '' };
  } catch (e) {
    const err = (e as { stderr?: Buffer | string }).stderr?.toString() ?? String(e);
    return { ok: false, out: '', err };
  }
}
const admin = (sql: string) => {
  const r = psqlRaw(sql);
  if (!r.ok) throw new Error(r.err);
  return r.out;
};

type Principal = { name: string; role: 'anon' | 'authenticated'; sub: string | null; email?: string };
const A: Principal = { name: 'A', role: 'authenticated', sub: randomUUID() };
const B: Principal = { name: 'B', role: 'authenticated', sub: randomUUID() };
const C: Principal = { name: 'C', role: 'authenticated', sub: randomUUID() };
const D: Principal = { name: 'D', role: 'authenticated', sub: randomUUID() };
const GUEST: Principal = { name: 'guest(anon)', role: 'anon', sub: null };
const ANON: Principal = { name: 'anonymous', role: 'anon', sub: null };

/** Runs ONE statement as `p` inside a rolled-back transaction. Returns rows affected/selected or the DB error. */
function attempt(p: Principal, statement: string): { ok: true; value: string } | { ok: false; error: string } {
  const claims = JSON.stringify({ role: p.role, ...(p.sub ? { sub: p.sub } : {}), ...(p.email ? { email: p.email } : {}) });
  const script = [
    'begin;',
    `set local role ${p.role};`,
    `select set_config('request.jwt.claims', '${claims}', true) \\g /dev/null`,
    statement.trim().endsWith(';') ? statement : `${statement};`,
    'rollback;',
  ].join('\n');
  const r = psqlRaw(script);
  return r.ok ? { ok: true, value: r.out } : { ok: false, error: r.err.trim().split('\n').find((l) => /ERROR/.test(l)) ?? r.err };
}
/** Count of rows a DML/SELECT statement touched (0 when RLS filters everything). Throws-as-denied is its own outcome. */
const countOf = (p: Principal, body: string) => attempt(p, `with x as (${body}) select count(*) from x`);
const denied = (r: ReturnType<typeof attempt>) => !r.ok && /permission denied|row-level security|violates|ERROR/i.test(r.error);
const zeroOrDenied = (r: ReturnType<typeof attempt>) => (r.ok ? r.value.split('\n').pop() === '0' : denied(r));

const q = (s: string) => `'${s}'`;

d('account identity RLS matrix (real schema, real roles)', () => {
  beforeAll(() => {
    for (const [p, n] of [[A, 'idnusera'], [B, 'idnuserb'], [C, 'idnuserc'], [D, 'idnuserd']] as const) {
      admin(`insert into auth.users(id,email,raw_user_meta_data) values (${q(p.sub!)},${q(`${n}@racehorse-test.invalid`)},'{"username":"${n}"}')`);
    }
    // Resources owned by B (and one by A) — seeded as the privileged owner of the database.
    admin(`
      set racehorse.ghost_rating_v2 = 'on';
      insert into public.ghost_profiles(user_id, ghost_rating) values (${q(B.sub!)}, 1200), (${q(A.sub!)}, 1200);
      insert into public.ghost_games(user_id, final_score, opponent_score, match_id) values (${q(B.sub!)}, 100, 50, ${q(randomUUID())});
      insert into public.matches(mode, winner_user_id, loser_user_id) values ('online', ${q(B.sub!)}, null);
      insert into public.activity_feed(user_id, type, metadata) values (${q(B.sub!)}, 'win', '{}');
      insert into public.rivals(user_id, rival_id) values (${q(B.sub!)}, ${q(C.sub!)});
      insert into public.player_presence(user_id, status) values (${q(B.sub!)}, 'online');
      insert into public.friends(user_id, friend_user_id, status) values (${q(B.sub!)}, ${q(C.sub!)}, 'accepted');
      insert into public.daily_puzzle_attempts(puzzle_date, user_id) values (current_date, ${q(B.sub!)});
      insert into public.game_reviews(user_id, game_digest, review_engine_version, accuracy_model_version, evaluations, accuracy_model_result, mode)
        values (${q(B.sub!)}, 'd', 'v', 'v', '[]', '{}', 'pvf');
      insert into public.room_match_logs(match_id, room_code, status, event_log_version, last_event_sequence, event_count, participant_user_ids)
        values (${q(randomUUID())}, 'ROOMB', 'completed', 1, 0, 0, array[${q(B.sub!)}]::uuid[]);
      insert into public.review_completion_jobs(id, user_id, game_digest, source_match_id, status, job_payload)
        values ('job-b-${randomUUID()}', ${q(B.sub!)}, 'd', 'm', 'pending', '{}');
    `);
  });

  const OWN_ONLY_READ: Array<[table: string, ownerCol: string]> = [
    ['ghost_profiles', 'user_id'],
    ['ghost_games', 'user_id'],
    ['matches', 'winner_user_id'],
    ['activity_feed', 'user_id'],
    ['rivals', 'user_id'],
    ['friends', 'user_id'],
    ['daily_puzzle_attempts', 'user_id'],
    ['game_reviews', 'user_id'],
    ['review_completion_jobs', 'user_id'],
  ];

  describe('SELECT: another account / guest / anonymous never sees B-owned rows', () => {
    for (const [table, col] of OWN_ONLY_READ) {
      for (const p of [A, GUEST, ANON]) {
        it(`${p.name} cannot read ${table} rows owned by B`, () => {
          expect(zeroOrDenied(countOf(p, `select 1 from public.${table} where ${col} = ${q(B.sub!)}`))).toBe(true);
        });
      }
      it(`B can read own ${table}`, () => {
        const r = countOf(B, `select 1 from public.${table} where ${col} = ${q(B.sub!)}`);
        expect(r.ok && Number(r.value) >= 1).toBe(true);
      });
    }
    it('A cannot read B room_match_logs (participant policy); B can', () => {
      expect(zeroOrDenied(countOf(A, `select 1 from public.room_match_logs where room_code = 'ROOMB'`))).toBe(true);
      expect(zeroOrDenied(countOf(GUEST, `select 1 from public.room_match_logs where room_code = 'ROOMB'`))).toBe(true);
      const own = countOf(B, `select 1 from public.room_match_logs where room_code = 'ROOMB'`);
      expect(own.ok && own.value === '1').toBe(true);
    });
    it('profiles are readable only by authenticated users and expose no email/auth metadata columns', () => {
      expect(zeroOrDenied(countOf(ANON, `select 1 from public.profiles`))).toBe(true);
      const cols = admin(`select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='public' and table_name='profiles'`);
      expect(cols).not.toMatch(/email|phone|provider|token|secret/);
    });
  });

  describe('INSERT: ownership is bound to the verified subject', () => {
    it('A cannot insert a friend request as B', () => {
      const r = attempt(A, `insert into public.friends(user_id, friend_user_id, status) values (${q(B.sub!)}, ${q(A.sub!)}, 'pending')`);
      expect(denied(r)).toBe(true);
    });
    it('A cannot insert an already-accepted friendship (even as self)', () => {
      expect(denied(attempt(A, `insert into public.friends(user_id, friend_user_id, status) values (${q(A.sub!)}, ${q(B.sub!)}, 'accepted')`))).toBe(true);
    });
    it('A cannot forge a match for B (winner or loser)', () => {
      expect(denied(attempt(A, `insert into public.matches(mode, winner_user_id) values ('online', ${q(B.sub!)})`))).toBe(true);
      expect(denied(attempt(A, `insert into public.matches(mode, winner_user_id, loser_user_id) values ('online', ${q(B.sub!)}, ${q(A.sub!)})`))).toBe(true);
    });
    it('A cannot create rivals / presence rows for B', () => {
      expect(denied(attempt(A, `insert into public.rivals(user_id, rival_id) values (${q(B.sub!)}, ${q(A.sub!)})`))).toBe(true);
      expect(denied(attempt(A, `insert into public.player_presence(user_id, status) values (${q(B.sub!)}, 'offline')`))).toBe(true);
    });
    it('no client may write Ghost, rating, Daily or review state — not for B and not for self', () => {
      for (const p of [A, ANON]) {
        const own = p.sub ?? A.sub!;
        expect(denied(attempt(p, `insert into public.ghost_profiles(user_id, ghost_rating) values (${q(randomUUID())}, 3000)`))).toBe(true);
        expect(denied(attempt(p, `insert into public.ghost_games(user_id, final_score, opponent_score) values (${q(own)}, 999, 0)`))).toBe(true);
        expect(denied(attempt(p, `insert into public.daily_puzzle_attempts(puzzle_date, user_id) values (current_date + 1, ${q(own)})`))).toBe(true);
        expect(denied(attempt(p, `insert into public.game_reviews(user_id, game_digest, review_engine_version, accuracy_model_version, evaluations, accuracy_model_result, mode) values (${q(own)}, 'x','v','v','[]','{}','pvf')`))).toBe(true);
        expect(denied(attempt(p, `insert into public.profiles(id, username) values (${q(randomUUID())}, 'forged')`))).toBe(true);
      }
    });
    it('guest/anonymous cannot insert anything account-owned', () => {
      for (const sql of [
        `insert into public.matches(mode, winner_user_id) values ('online', ${q(B.sub!)})`,
        `insert into public.friends(user_id, friend_user_id, status) values (${q(B.sub!)}, ${q(C.sub!)}, 'pending')`,
        `insert into public.player_presence(user_id, status) values (${q(B.sub!)}, 'online')`,
      ]) expect(denied(attempt(GUEST, sql))).toBe(true);
    });
  });

  describe('UPDATE / DELETE: another principal affects zero of B\'s rows', () => {
    const cases: Array<[string, string]> = [
      ['profiles username', `update public.profiles set username = 'hijacked' where id = ${q(B.sub!)} returning 1`],
      ['profiles rating', `update public.profiles set glicko_rating = 9999 where id = ${q(B.sub!)} returning 1`],
      ['ghost_profiles rating', `update public.ghost_profiles set ghost_rating = 9999 where user_id = ${q(B.sub!)} returning 1`],
      ['ghost_games', `update public.ghost_games set final_score = 0 where user_id = ${q(B.sub!)} returning 1`],
      ['matches', `update public.matches set winner_score = 1 where winner_user_id = ${q(B.sub!)} returning 1`],
      ['activity_feed', `update public.activity_feed set metadata = '{}' where user_id = ${q(B.sub!)} returning 1`],
      ['rivals', `update public.rivals set rival_id = ${q(A.sub!)} where user_id = ${q(B.sub!)} returning 1`],
      ['presence', `update public.player_presence set status = 'offline' where user_id = ${q(B.sub!)} returning 1`],
      ['friends status', `update public.friends set status = 'blocked' where user_id = ${q(B.sub!)} returning 1`],
      ['daily_puzzle_attempts', `update public.daily_puzzle_attempts set total_score = 999999 where user_id = ${q(B.sub!)} returning 1`],
      ['game_reviews', `update public.game_reviews set mode = 'x' where user_id = ${q(B.sub!)} returning 1`],
      ['delete profiles', `delete from public.profiles where id = ${q(B.sub!)} returning 1`],
      ['delete ghost_games', `delete from public.ghost_games where user_id = ${q(B.sub!)} returning 1`],
      ['delete matches', `delete from public.matches where winner_user_id = ${q(B.sub!)} returning 1`],
      ['delete activity_feed', `delete from public.activity_feed where user_id = ${q(B.sub!)} returning 1`],
      ['delete rivals', `delete from public.rivals where user_id = ${q(B.sub!)} returning 1`],
      ['delete friends', `delete from public.friends where user_id = ${q(B.sub!)} returning 1`],
      ['delete game_reviews', `delete from public.game_reviews where user_id = ${q(B.sub!)} returning 1`],
    ];
    for (const [label, sql] of cases) {
      for (const p of [A, GUEST, ANON]) {
        it(`${p.name}: ${label} -> 0 rows or denied`, () => {
          expect(zeroOrDenied(countOf(p, sql))).toBe(true);
        });
      }
    }
    it('even the owner cannot self-write rating columns (service-role only)', () => {
      expect(denied(attempt(B, `update public.profiles set glicko_rating = 9999 where id = ${q(B.sub!)}`))).toBe(true);
      expect(denied(attempt(B, `update public.ghost_profiles set ghost_rating = 9999 where user_id = ${q(B.sub!)}`))).toBe(true);
      expect(denied(attempt(B, `update public.profiles set id = ${q(randomUUID())} where id = ${q(B.sub!)}`))).toBe(true);
    });
    it('owner can still rename self (the one allowed profile write)', () => {
      const r = countOf(B, `update public.profiles set username = 'idnuserb_renamed' where id = ${q(B.sub!)} returning 1`);
      expect(r.ok && r.value === '1').toBe(true);
    });
  });

  describe('friends: a request recipient cannot re-point the row at a third account', () => {
    it('recipient re-targeting user_id to a victim is rejected (column grant), and no friendship with the victim exists', () => {
      const m1 = { ...A }, m2 = D;
      admin(`insert into public.friends(user_id, friend_user_id, status) values (${q(m1.sub!)}, ${q(m2.sub!)}, 'pending')`);
      try {
        const r = attempt(m2, `update public.friends set user_id = ${q(B.sub!)}, status = 'accepted' where friend_user_id = ${q(m2.sub!)} and user_id = ${q(m1.sub!)}`);
        expect(denied(r)).toBe(true);
        // the legitimate path still works: recipient accepts via status only
        const ok = countOf(m2, `update public.friends set status = 'accepted' where friend_user_id = ${q(m2.sub!)} and user_id = ${q(m1.sub!)} returning 1`);
        expect(ok.ok && ok.value === '1').toBe(true);
        // and the victim's activity stays invisible to the mallory pair
        expect(zeroOrDenied(countOf(m2, `select 1 from public.activity_feed where user_id = ${q(B.sub!)} and user_id <> ${q(m2.sub!)}`))).toBe(true);
      } finally {
        admin(`delete from public.friends where user_id = ${q(m1.sub!)} and friend_user_id = ${q(m2.sub!)}`);
      }
    });
    it('sender cannot self-accept; recipient cannot rewrite friend_user_id or id', () => {
      admin(`insert into public.friends(user_id, friend_user_id, status) values (${q(A.sub!)}, ${q(B.sub!)}, 'pending')`);
      try {
        expect(zeroOrDenied(countOf(A, `update public.friends set status = 'accepted' where user_id = ${q(A.sub!)} and friend_user_id = ${q(B.sub!)} returning 1`))).toBe(true);
        expect(denied(attempt(B, `update public.friends set friend_user_id = ${q(C.sub!)} where user_id = ${q(A.sub!)} and friend_user_id = ${q(B.sub!)}`))).toBe(true);
        expect(denied(attempt(B, `update public.friends set id = gen_random_uuid() where user_id = ${q(A.sub!)} and friend_user_id = ${q(B.sub!)}`))).toBe(true);
      } finally {
        admin(`delete from public.friends where user_id = ${q(A.sub!)} and friend_user_id = ${q(B.sub!)}`);
      }
    });
    it('an accepted friend can read the friend activity feed (documented intent), a stranger cannot', () => {
      const asFriend = countOf(C, `select 1 from public.activity_feed where user_id = ${q(B.sub!)}`);
      expect(asFriend.ok && asFriend.value === '1').toBe(true);
      expect(zeroOrDenied(countOf(A, `select 1 from public.activity_feed where user_id = ${q(B.sub!)}`))).toBe(true);
    });
  });

  describe('daily_puzzles: authority is never derived from an email claim', () => {
    for (const email of ['admin@example.com', 'olivermorid@gmail.com']) {
      it(`a session whose JWT email claim is ${email} still cannot write daily_puzzles`, () => {
        const mallory: Principal = { ...A, email };
        expect(denied(attempt(mallory, `insert into public.daily_puzzles(puzzle_date, starting_board, starting_hand, target_score) values (current_date + 400, '{}', '[]', 1)`))).toBe(true);
        expect(zeroOrDenied(countOf(mallory, `update public.daily_puzzles set published = false returning 1`))).toBe(true);
        expect(zeroOrDenied(countOf(mallory, `delete from public.daily_puzzles returning 1`))).toBe(true);
      });
    }
  });

  describe('server-only tables: deny-all to every client principal', () => {
    const serverOnly = [
      'ranked_games', 'rating_periods', 'rush_runs', 'rush_run_puzzles', 'puzzle_pool', 'bot_match_pending',
      'mp_authority_events', 'room_command_receipts', 'room_live_sessions', 'room_live_session_entries',
      'ghost_deferred_completions', 'ghost_cutover_resolutions', 'rating_cutover_gate', 'user_reports', 'user_blocks',
      'daily_fritz_events', 'daily_fritz_outbox', 'daily_fritz_attempt_operations', 'daily_fritz_verified_games', 'daily_fritz_verified_hands',
      'fritz_challenges', 'fritz_challenge_attempts', 'tournament_orchestrator_leases',
    ];
    for (const t of serverOnly) {
      for (const p of [A, GUEST, ANON]) {
        it(`${p.name} reads nothing from ${t}`, () => {
          expect(zeroOrDenied(countOf(p, `select 1 from public.${t}`))).toBe(true);
        });
      }
      it(`${t}: authenticated cannot delete`, () => {
        expect(zeroOrDenied(countOf(A, `delete from public.${t} returning 1`))).toBe(true);
      });
    }
  });

  describe('RPC trust boundary', () => {
    it('the ONLY client-executable public functions are trigger functions and a pinned allowlist with no identity parameters', () => {
      const rows = admin(`
        select p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' || '|' || p.prorettype::regtype || '|' || p.prosecdef
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f'
           and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
           and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
         order by 1`).split('\n').filter(Boolean);
      const nonTrigger = rows.filter((r) => !r.split('|')[1]!.startsWith('trigger')).map((r) => r.split('|')[0]!);
      expect(nonTrigger).toEqual([
        'ensure_tournament_seed_window()',
        'seed_future_tournaments(days_ahead integer)',
        'username_policy_violation(candidate text)',
        'valid_ranked_rating_context(c jsonb)',
      ]);
      for (const sig of nonTrigger) expect(sig).not.toMatch(/user_id|player_id|owner_id|profile_id|p_user|uuid/);
      // trigger functions cannot be invoked as RPC, but they must not be SECURITY DEFINER-callable with arguments
      for (const r of rows.filter((x) => x.split('|')[1]!.startsWith('trigger'))) expect(r.split('|')[0]).toMatch(/\(\)$/);
    });
    it('every function that takes a user/player/profile id is NOT executable by anon/authenticated', () => {
      const leaked = admin(`
        select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prokind = 'f'
           and pg_get_function_identity_arguments(p.oid) ~* '(user_id|player_id|owner_id|profile_id)'
           and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))`);
      expect(leaked).toBe('');
    });
    it('calling a service-only RPC as A with B\'s id is denied', () => {
      const r1 = attempt(A, `select public.complete_ghost_rating_v2(${q(B.sub!)}, ${q(randomUUID())}, 100, 0, '[]'::jsonb, 'x', 1200, true)`);
      const r2 = attempt(A, `select public.register_for_tournament(${q(randomUUID())}, ${q(B.sub!)})`);
      const r3 = attempt(ANON, `select public.commit_glicko_game_update(${q(B.sub!)}, 3000, 1, 1, now(), false, 3000, 1, ${q(randomUUID())}, 1, 1, 1, 1, '{}'::jsonb)`);
      for (const r of [r1, r2, r3]) expect(!r.ok && /permission denied for function/.test(r.error)).toBe(true);
    });
    it('the executable tournament seeders are invoker-rights and cannot write as a client', () => {
      const r = attempt(A, `select public.seed_future_tournaments(3)`);
      const before = admin(`select count(*) from public.scheduled_tournaments`);
      expect(!r.ok || r.value === '0').toBe(true);
      expect(admin(`select count(*) from public.scheduled_tournaments`)).toBe(before);
    });
  });

  describe('structural guards (a new table/policy must be classified here)', () => {
    it('no policy lets anon write; no authenticated write policy omits an auth.uid() binding', () => {
      const rows = admin(`
        select tablename || '.' || policyname || '|' || cmd || '|' || roles::text || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
          from pg_policies where schemaname = 'public' and cmd in ('INSERT','UPDATE','DELETE','ALL')`).split('\n').filter(Boolean);
      const bad: string[] = [];
      for (const row of rows) {
        const [name, cmd, roles, qual, check] = row.split('|') as [string, string, string, string, string];
        if (/service_role/.test(roles) && !/anon|authenticated|public/.test(roles.replace('service_role', ''))) continue;
        const deniesAll = qual === 'false' && (check === 'false' || check === '');
        if (deniesAll) continue;
        if (/\banon\b|\{public\}/.test(roles)) bad.push(`${name}: anon/public write policy`);
        else if (!/auth\.uid\(\)/.test(qual + check)) bad.push(`${name}: no auth.uid() binding (${cmd})`);
      }
      expect(bad).toEqual([]);
    });
    it('no client-writable table exposes a write policy with an email-claim predicate', () => {
      expect(admin(`select count(*) from pg_policies where schemaname='public' and (coalesce(qual,'') || coalesce(with_check,'')) ~* 'jwt\\(\\)|email'`)).toBe('0');
    });
    it('authenticated has no INSERT/UPDATE/DELETE on rating-bearing tables', () => {
      for (const t of ['profiles', 'ghost_profiles', 'ghost_games', 'ranked_games', 'rush_runs']) {
        const writes = admin(`select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='${t}' and grantee in ('anon','authenticated') and privilege_type in ('INSERT','DELETE','TRUNCATE')`);
        expect(writes, t).toBe('0');
      }
      expect(admin(`select has_column_privilege('authenticated','public.profiles','glicko_rating','update')`)).toBe('f');
      expect(admin(`select has_column_privilege('authenticated','public.profiles','username','update')`)).toBe('t');
    });
  });
});
