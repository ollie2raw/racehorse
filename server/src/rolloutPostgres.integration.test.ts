import { execFile, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const rootUrl = process.env.RACEHORSE_REMEDIATION_TEST_DATABASE_URL;
const allowed = Boolean(rootUrl && /^postgres(?:ql)?:\/\/[^/]*127\.0\.0\.1:55432\/racehorse_remediation$/.test(rootUrl));
const psqlBin = process.env.PSQL_BIN || 'psql';
const dbName = `racehorse_rollout_${process.pid}_${Date.now()}`;
const databaseUrl = rootUrl?.replace(/\/racehorse_remediation$/, `/${dbName}`) ?? '';
const adminUrl = rootUrl?.replace(/\/racehorse_remediation$/, '/postgres') ?? '';
const migration = (name: string) => resolve(process.cwd(), '../supabase/migrations', name);

function psql(url: string, query: string): string {
  if (!allowed) throw new Error('Refusing nonlocal rollout test database');
  return execFileSync(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', url, '-c', query], {
    encoding: 'utf8', timeout: 15_000,
  }).trim();
}

function sql(query: string): string { return psql(databaseUrl, query); }

async function sqlAsync(query: string): Promise<string> {
  if (!allowed) throw new Error('Refusing nonlocal rollout test database');
  const result = await execFileAsync(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', query], {
    encoding: 'utf8', timeout: 15_000,
  });
  return result.stdout.trim();
}

function apply(file: string): void {
  if (!allowed) throw new Error('Refusing nonlocal rollout test database');
  execFileSync(psqlBin, ['-X', '-v', 'ON_ERROR_STOP=1', databaseUrl, '-f', file], {
    encoding: 'utf8', timeout: 20_000,
  });
}

function newUser(): string {
  const id = randomUUID();
  sql(`insert into auth.users(id) values ('${id}')`);
  return id;
}

function ghostComplete(userId: string, matchId: string): string {
  return `select public.complete_ghost_rating_v2('${userId}','${matchId}',60,10,'[]'::jsonb,'ghost',1000,true)`;
}

const straddle = { user: '', match: '', completeUser: '', completeMatch: '', staleUser: '', staleMatch: '' };

describe.skipIf(!allowed)('mixed-version rollout against real PostgreSQL', () => {
  beforeAll(() => {
    psql(adminUrl, `create database ${dbName}`);
    apply(resolve(process.cwd(), 'test/fixtures/remediationPostgres.sql'));
    // Step 0: additive, applied before the bridge server is deployed.
    apply(migration('2026-10-13_rating_cutover_gate.sql'));
  });
  afterAll(() => {
    if (allowed) psql(adminUrl, `drop database if exists ${dbName} with (force)`);
  });

  it('fences old Ghost writes and refuses both possible legacy partial states', () => {
    const alreadyRated = newUser();
    const notRated = newUser();
    const ratedMatch = randomUUID();
    const unratedMatch = randomUUID();
    // Exact old order: game row commits first, then a separate profile write.
    // A process death can leave either of these states before verified-match
    // completion. Neither can be classified from the game row alone.
    sql(`insert into public.ghost_profiles(user_id,ghost_rating,games_played)
      values ('${alreadyRated}',830,1),('${notRated}',800,0)`);
    sql(`insert into public.ghost_games(user_id,match_id,final_score,opponent_score,move_log)
      values ('${alreadyRated}','${ratedMatch}',60,10,'[]'::jsonb),
             ('${notRated}','${unratedMatch}',60,10,'[]'::jsonb)`);
    // Expand is impossible with the gate open: the operator must have closed it.
    expect(() => apply(migration('2026-10-13_ghost_rating_idempotent_completion.sql')))
      .toThrow(/rating_cutover_gate_not_quiesced/);
    expect(sql(`select count(*) from information_schema.columns
      where table_name='ghost_games' and column_name='rating_applied_at'`)).toBe('0');
    sql(`update public.rating_cutover_gate set quiesced=true, quiesced_at=now(), enabled_boot_id='boot-1' where id`);

    // Handoff partials that happened inside the drain window, as the OLD writer
    // leaves them: (1) straddle: ranked result committed, Ghost write never
    // landed; (2) complete legacy pair (ranked + Ghost row, no receipt); (3) an
    // old game with no Ghost row from long before the window.
    straddle.user = newUser(); straddle.match = randomUUID();
    straddle.completeUser = newUser(); straddle.completeMatch = randomUUID();
    straddle.staleUser = newUser(); straddle.staleMatch = randomUUID();
    sql(`insert into public.ranked_games(player_id,game_type,source_type,source_match_id)
      values ('${straddle.user}','fritz','verified_single_player','${straddle.match}'),
             ('${straddle.completeUser}','fritz','verified_single_player','${straddle.completeMatch}')`);
    sql(`insert into public.ghost_games(user_id,match_id,final_score,opponent_score,move_log)
      values ('${straddle.completeUser}','${straddle.completeMatch}',60,10,'[]'::jsonb)`);
    sql(`insert into public.ranked_games(player_id,game_type,source_type,source_match_id,played_at)
      values ('${straddle.staleUser}','fritz','verified_single_player','${straddle.staleMatch}',now() - interval '3 days')`);
    apply(migration('2026-10-13_ghost_rating_idempotent_completion.sql'));
    apply(migration('2026-10-13_ghost_cutover_reconciliation.sql'));
    expect(sql(`select (ghost_expand_applied_at is not null)::text from public.rating_cutover_gate where id`))
      .toBe('true');

    const afterExpand = newUser();
    const afterExpandMatch = randomUUID();
    sql(`insert into public.verified_single_player_matches(match_id,user_id,status)
      values ('${afterExpandMatch}','${afterExpand}','started')`);
    expect(() => sql(`insert into public.ghost_games(user_id,match_id,final_score,opponent_score,move_log)
      values ('${afterExpand}','${afterExpandMatch}',60,10,'[]'::jsonb)`)).toThrow(/ghost_legacy_writer_fenced/);
    expect(() => sql(`update public.verified_single_player_matches
      set status='completed',completion_result='{"ghostScore":10,"newRating":840}'::jsonb
      where match_id='${afterExpandMatch}'`)).toThrow(/ghost_legacy_writer_fenced/);
    expect(() => sql(`update public.ghost_profiles set ghost_rating=870 where user_id='${alreadyRated}'`))
      .toThrow(/ghost_legacy_writer_fenced/);
    expect(() => sql(`insert into public.ranked_games(player_id,game_type,source_type,source_match_id)
      values ('${afterExpand}','fritz','verified_single_player','${afterExpandMatch}')`))
      .toThrow(/ghost_legacy_writer_fenced/);
    expect(() => sql(ghostComplete(alreadyRated, ratedMatch))).toThrow(/ghost_legacy_completion_ambiguous/);
    expect(() => sql(ghostComplete(notRated, unratedMatch))).toThrow(/ghost_legacy_completion_ambiguous/);
    expect(sql(`select ghost_rating||':'||games_played from public.ghost_profiles where user_id='${alreadyRated}'`))
      .toBe('830:1');
    expect(sql(`select ghost_rating||':'||games_played from public.ghost_profiles where user_id='${notRated}'`))
      .toBe('800:0');

    const first = JSON.parse(sql(ghostComplete(afterExpand, afterExpandMatch)));
    const retry = JSON.parse(sql(ghostComplete(afterExpand, afterExpandMatch)));
    expect(first.isNewGame).toBe(true);
    expect(retry).toMatchObject({ isNewGame: false, newRating: first.newRating, ratingDelta: first.ratingDelta });
    expect(sql(`select games_played from public.ghost_profiles where user_id='${afterExpand}'`)).toBe('1');
    sql(`insert into public.ranked_games(player_id,game_type,source_type,source_match_id)
      values ('${afterExpand}','fritz','verified_single_player','${afterExpandMatch}')`);
    sql(`update public.verified_single_player_matches
      set status='completed',completion_result='{"ghostScore":10,"newRating":840}'::jsonb
      where match_id='${afterExpandMatch}'`);
    expect(sql(`select status from public.verified_single_player_matches
      where match_id='${afterExpandMatch}'`)).toBe('completed');
    const dailyFritzMatch = randomUUID();
    sql(`insert into public.verified_single_player_matches(match_id,user_id,status,completion_result)
      values ('${dailyFritzMatch}','${afterExpand}','completed','{"finalScore":60}'::jsonb)`);
  });

  it('detects the Ghost/Fritz straddle partial, blocks the contract, and unblocks only after a deliberate resolution', () => {
    const partials = sql(`select kind||'|'||user_id||'|'||match_id from public.ghost_cutover_suspicious_partials() order by 1`);
    // Exactly the straddle: the complete legacy pair and the pre-window game are NOT partials.
    expect(partials).toBe(`ranked_without_ghost_row|${straddle.user}|${straddle.match}`);
    expect(() => apply(migration('2026-10-13_ghost_user_match_uniqueness.sql')))
      .toThrow(/ghost_cutover_unreconciled/);
    expect(sql(`select count(*) from pg_constraint where conrelid='public.ghost_games'::regclass and contype='u'
      and conname like '%match_id%'`)).not.toBe('0');

    // A resolution needs a real note and never rates anything by itself.
    expect(() => sql(`select public.ghost_cutover_resolve('${straddle.user}','${straddle.match}',
      'confirmed_no_effect_needed','short','op')`)).toThrow(/check constraint/);
    expect(() => sql(`select public.ghost_cutover_resolve('${straddle.user}','${straddle.match}',
      'rating_applied_manually','operator applied the outcome by hand','op')`))
      .toThrow(/ghost_cutover_resolution_requires_receipt/);
    expect(sql(`select count(*) from public.ghost_games where user_id='${straddle.user}'`)).toBe('0');

    // The operator applies the outcome through the one atomic writer, then records it.
    sql(ghostComplete(straddle.user, straddle.match));
    sql(`select public.ghost_cutover_resolve('${straddle.user}','${straddle.match}',
      'rating_applied_manually','applied via complete_ghost_rating_v2 after review','op')`);
    expect(sql(`select count(*) from public.ghost_cutover_suspicious_partials()`)).toBe('0');
  });

  it('flags a Fritz ranked result committed after expand without a Ghost receipt (defensive: the DB fence should make this unreachable)', () => {
    const user = newUser();
    const match = randomUUID();
    sql(`alter table public.ranked_games disable trigger ranked_fritz_ghost_receipt_v2_gate`);
    try {
      sql(`insert into public.ranked_games(player_id,game_type,source_type,source_match_id)
        values ('${user}','fritz','verified_single_player','${match}')`);
    } finally {
      sql(`alter table public.ranked_games enable trigger ranked_fritz_ghost_receipt_v2_gate`);
    }
    expect(sql(`select kind from public.ghost_cutover_suspicious_partials() order by kind`))
      .toBe('ranked_after_expand_without_receipt\nranked_without_ghost_row');
    sql(`select public.ghost_cutover_resolve('${user}','${match}','confirmed_no_effect_needed',
      'test row removed from consideration','op')`);
    expect(sql(`select count(*) from public.ghost_cutover_suspicious_partials()`)).toBe('0');
  });

  it('refuses the contract when the cutover boundary was never recorded', () => {
    sql(`update public.rating_cutover_gate set ghost_expand_applied_at=null where id`);
    try {
      expect(() => sql(`select public.ghost_cutover_assert_reconciled()`)).toThrow(/ghost_cutover_boundary_unknown/);
    } finally {
      sql(`update public.rating_cutover_gate set ghost_expand_applied_at=clock_timestamp() where id`);
    }
  });

  it('serializes new Ghost games, then permits both humans only after contract', async () => {
    const userId = newUser();
    const games = [randomUUID(), randomUUID()];
    const results = await Promise.all(games.map((id) => sqlAsync(ghostComplete(userId, id))));
    expect(results.every((result) => JSON.parse(result).isNewGame)).toBe(true);
    expect(sql(`select games_played from public.ghost_profiles where user_id='${userId}'`)).toBe('2');

    const secondUser = newUser();
    expect(() => sql(ghostComplete(secondUser, games[0]))).toThrow(/duplicate key value/);
    apply(migration('2026-10-13_ghost_user_match_uniqueness.sql'));
    expect(JSON.parse(sql(ghostComplete(secondUser, games[0]))).isNewGame).toBe(true);
    expect(sql(`select count(*) from public.ghost_games where match_id='${games[0]}'`)).toBe('2');
    expect(() => sql(`insert into public.ghost_games(user_id,match_id,final_score,opponent_score,move_log)
      values ('${secondUser}','${randomUUID()}',60,10,'[]'::jsonb) on conflict (match_id) do update
      set final_score=excluded.final_score`)).toThrow(/no unique or exclusion constraint/);
  });

  it('cancels old Rush runs from both sides of expand, then contracts safely', () => {
    const beforeUser = newUser();
    const beforeId = randomUUID();
    sql(`insert into public.rush_runs(id,user_id,is_official) values ('${beforeId}','${beforeUser}',true)`);
    apply(migration('2026-10-13_puzzle_rush_assignment_and_atomic_completion.sql'));
    const afterUser = newUser();
    const afterId = randomUUID();
    sql(`insert into public.rush_runs(id,user_id,is_official) values ('${afterId}','${afterUser}',true)`);
    expect(() => sql(`insert into public.rush_run_puzzles(run_id,puzzle_id,ordinal)
      values ('${afterId}','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1)`))
      .toThrow(/rush_legacy_writer_fenced/);
    expect(() => sql(`update public.rush_runs set status='completed',ended_at=now(),total_score=999
      where id='${afterId}'`)).toThrow(/rush_legacy_writer_fenced/);
    for (const [runId, userId] of [[beforeId, beforeUser], [afterId, afterUser]]) {
      const cancelled = JSON.parse(sql(`select public.invalidate_unassigned_rush_run_v2('${runId}','${userId}')`));
      expect(cancelled.invalidated).toBe(true);
      expect(cancelled.run.status).toBe('invalidated');
      expect(cancelled.run.is_official).toBe(false);
    }
    const assignedId = randomUUID();
    sql(`insert into public.rush_runs(id,user_id,assigned_puzzle_ids,is_official)
      values ('${assignedId}','${beforeUser}',array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid],true)`);
    const report = JSON.parse(sql(`select public.record_rush_report_v2('${assignedId}','${beforeUser}',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',1,0,'[]'::jsonb,null)`));
    expect(report.ordinal).toBe(1);
    expect(() => sql(`select public.record_rush_report_v2('${assignedId}','${beforeUser}',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,0,'[]'::jsonb,null)`)).toThrow(/rush_assignment_mismatch/);
    sql(`select public.claim_rush_completion_v2('${assignedId}','${beforeUser}',0)`);
    const grade = JSON.stringify([{ ordinal: 1, puzzleId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      rawScore: 10, awardedPoints: 10, solved: true, perfect: false, movesUsed: 1,
      bonusSeconds: 0, submittedLine: [], gradingError: null }]);
    expect(JSON.parse(sql(`select public.finalize_rush_run_v2('${assignedId}','${beforeUser}',
      'completed',10,1,null,'${grade}'::jsonb)`)).outcome).toBe('applied');

    // A final old-server start after expand is closed by contract, not graded.
    const lateId = randomUUID();
    sql(`insert into public.rush_runs(id,user_id) values ('${lateId}','${afterUser}')`);
    apply(migration('2026-10-13_puzzle_rush_assignment_contract.sql'));
    expect(sql(`select status from public.rush_runs where id='${lateId}'`)).toBe('invalidated');
    expect(() => sql(`insert into public.rush_runs(user_id) values ('${afterUser}')`))
      .toThrow(/rush_runs_open_assignment_required/);
    expect(() => sql(`select public.record_rush_report_v2('${assignedId}','${beforeUser}',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',1,0,'[]'::jsonb,null)`)).toThrow(/rush_run_closed/);
  });

  it('refuses ranked expand with the gate open (legacy decay is only stopped by the gate), applies it closed', () => {
    apply(migration('2026-06-30_commit_glicko_game_update_rpc.sql'));
    sql(`update public.rating_cutover_gate set quiesced=false where id`);
    expect(() => apply(migration('2026-10-13_ranked_rating_claim.sql'))).toThrow(/rating_cutover_gate_not_quiesced/);
    expect(sql(`select count(*) from information_schema.columns
      where table_name='rating_periods' and column_name='ranked_game_id'`)).toBe('0');
    sql(`update public.rating_cutover_gate set quiesced=true where id`);
    apply(migration('2026-10-13_ranked_rating_claim.sql'));
    expect(sql(`select count(*) from information_schema.columns
      where table_name='rating_periods' and column_name='ranked_game_id'`)).toBe('1');
  });
});
