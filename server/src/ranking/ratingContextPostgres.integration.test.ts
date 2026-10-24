import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertNotProductionSupabase } from '../platform/env/productionSupabaseGuard';
import { holdPostgresRowLock, waitForBlockedPostgresCalls } from '../../test/support/postgresLockBarrier';
import { insertRankedGameIdempotent } from './insertRankedGameIdempotent';
import { processAllPendingRatingGames, processRealtimeMultiplayerGame, resetRatingCatchUpForTests, type Profile } from './periodService';
import { computeGlicko2, getFritzConfig, FRITZ_ELITE_ID } from './glicko2';
import { supabaseFetch } from '../supabaseUtils';

// Only configuration is supplied by this test. Fetch, PostgREST, PostgreSQL,
// migration, insert helper, processor, CAS and row locks are all real.
vi.mock('../config', async () => {
  const { createHmac } = await import('node:crypto');
  const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const message = `${encoded({ alg: 'HS256', typ: 'JWT' })}.${encoded({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  const key = `${message}.${createHmac('sha256', 'racehorse-forfeit-r1-local-validation-only-secret').update(message).digest('base64url')}`;
  return { config: { isProd: false, nodeEnv: 'test', supabaseUrl: process.env.SUPABASE_URL === 'http://127.0.0.1:55445' ? 'http://127.0.0.1:55445' : 'http://127.0.0.1:55440', supabaseServiceKey: key } };
});

const dbUrl = process.env.FORFEIT_R1_TEST_DATABASE_URL;
const localRestUrl = process.env.SUPABASE_URL;
const enabled = (dbUrl === 'postgresql://postgres@127.0.0.1:55439/racehorse_final_r1' && localRestUrl === 'http://127.0.0.1:55440')
  || (dbUrl === 'postgresql://postgres@127.0.0.1:55439/racehorse_runtime_upgrade' && localRestUrl === 'http://127.0.0.1:55445');
const psql = process.env.PSQL_BIN || '/opt/homebrew/opt/postgresql@16/bin/psql';
function sql(query: string): string {
  assertNotProductionSupabase('forfeit R1 local PostgreSQL');
  if (!enabled) throw new Error('Refusing nonlocal forfeit test database');
  return execFileSync(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-At', dbUrl!, '-c', query], { encoding: 'utf8', timeout: 10_000 }).trim();
}
const cohort: string[] = [];
const owner = (id: string, rating: number): Profile => ({ id, username: id, glicko_rating: rating,
  glicko_rd: 200, glicko_vol: 0.06, glicko_last_period: null, ranked_games_played: 30, peak_rating: 1600, provisional: false });
async function seed(treatment: 'standard' | 'disconnect_forfeit', forfeit = true, zero: readonly boolean[] = [false, false], seats = 2) {
  const ids = [randomUUID(), randomUUID()]; cohort.push(...ids);
  sql(`insert into auth.users values ('${ids[0]}'),('${ids[1]}');
    insert into profiles(id,username,glicko_rating,glicko_rd,glicko_vol,ranked_games_played,peak_rating) values ('${ids[0]}','ctx${ids[0]!.replaceAll('-', '').slice(0, 12)}',1500,200,0.06,${zero[0] ? 0 : 30},${zero[0] ? 1500 : 1600}),('${ids[1]}','ctx${ids[1]!.replaceAll('-', '').slice(0, 12)}',${zero[1] ? 1500 : 1600},200,0.06,${zero[1] ? 0 : 30},${zero[1] ? 1500 : 1600}) on conflict(id) do update set username=excluded.username,glicko_rating=excluded.glicko_rating,glicko_rd=excluded.glicko_rd,glicko_vol=excluded.glicko_vol,ranked_games_played=excluded.ranked_games_played,peak_rating=excluded.peak_rating;`);
  const profiles = [owner(ids[0]!, 1500), owner(ids[1]!, zero[1] ? 1500 : 1600)].map((p, i) => zero[i] ? { ...p, ranked_games_played: 0, peak_rating: 1500 } : p);
  const source = randomUUID();
  const results = await Promise.all(ids.slice(0, seats).map((id, i) => insertRankedGameIdempotent({
    playerId: id, opponentId: ids[1 - i]!, playerScore: i === 0 ? 40 : 20, opponentScore: i === 0 ? 20 : 40,
    gameType: 'multiplayer', ratingBefore: profiles[i]!.glicko_rating, rdBefore: 200,
    playedAt: new Date().toISOString(), ratingTreatment: treatment,
    completionCause: treatment === 'disconnect_forfeit' ? 'disconnect_timeout' : forfeit ? 'manual_forfeit' : 'completed',
    opponentRating: profiles[1 - i]!.glicko_rating, opponentRd: 200,
    ...(forfeit ? { outcome: i === 0 ? 'loss' as const : 'win' as const } : {}),
    source: { sourceType: 'live_room', sourceMatchId: source },
  })));
  const rows = results.map((r) => { if (!r.isNew) throw new Error('Fresh fixture insertion failed'); return r.game; });
  const snapshot = () => JSON.parse(sql(`select json_agg(json_build_object('delta',delta,'rating',rating_after,'rd',rd_after) order by player_id='${ids[1]}' ) from ranked_games where player_id in ('${ids[0]}','${ids[1]}')`));
  const receipts = () => Number(sql(`select count(*) from rating_periods where user_id in ('${ids[0]}','${ids[1]}')`));
  return { ids, rows, profiles, snapshot, receipts, source,
    inline: () => processRealtimeMultiplayerGame({ playerAProfile: profiles[0]!, playerBProfile: profiles[1]!, playerAGame: rows[0]!, playerBGame: rows[1]! }) };
}
function rawCommit(profile: Profile, game: { id: string; rating_context?: unknown }, includeContext = true) {
  return supabaseFetch('/rest/v1/rpc/commit_glicko_game_update', { method: 'POST', body: JSON.stringify({
    p_profile_id: profile.id, p_glicko_rating: profile.glicko_rating + 10, p_glicko_rd: 180,
    p_glicko_vol: profile.glicko_vol, p_glicko_last_period: new Date().toISOString(), p_provisional: false,
    p_peak_rating: 1600, p_ranked_games_played: 31, p_game_id: game.id, p_delta: 10,
    p_rating_before: profile.glicko_rating, p_rd_before: profile.glicko_rd, p_vol_before: profile.glicko_vol,
    ...(includeContext ? { p_rating_context: game.rating_context ?? null } : {}),
  }) });
}

describe.skipIf(!enabled)('ranked context real Postgres/PostgREST crash matrix', () => {
  beforeAll(() => {
    const nativeFetch = globalThis.fetch;
    // Supabase's gateway strips /rest/v1; direct local PostgREST has no
    // gateway. Adapt only that prefix, retaining real network/SQL behavior.
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.origin !== localRestUrl) throw new Error('Refusing nonlocal PostgREST request');
      url.pathname = url.pathname.replace(/^\/rest\/v1/, '');
      return nativeFetch(url, init);
    });
  });
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => resetRatingCatchUpForTests());
  afterEach(() => {
    if (cohort.length) {
      const ids = cohort.splice(0).map((id) => `'${id}'`).join(',');
      sql(`delete from rating_periods where user_id in (${ids}); delete from ranked_games where player_id in (${ids});
        delete from profiles where id in (${ids}); delete from auth.users where id in (${ids})`);
    }
  });

  it('migration preserves and recovers a pre-expansion historical row at full weight', async () => {
    // A genuinely pending, NULL-context row as the pre-expansion writer left it. (It is built by insertion, not by
    // reverting an applied game: applied -> pending is forbidden by 2026-10-16_ranked_applied_state_monotonic.sql.)
    const owner = randomUUID(); cohort.push(owner);
    const game = randomUUID();
    sql(`insert into auth.users values ('${owner}');
      insert into profiles(id,username,glicko_rating,glicko_rd,glicko_vol,ranked_games_played,peak_rating) values ('${owner}','hist${owner.replaceAll('-', '').slice(0, 12)}',1500,200,0.06,30,1600)
        on conflict(id) do update set glicko_rating=1500,glicko_rd=200,glicko_vol=0.06,ranked_games_played=30,peak_rating=1600;
      insert into ranked_games(id,player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before,played_at,source_type,source_match_id)
        values ('${game}','${owner}','${FRITZ_ELITE_ID}',60,20,'fritz',1500,200,now(),'local_fritz_abandon','historical-${game}')`);
    expect(sql(`select rating_context is null and rating_after is null from ranked_games where id='${game}'`)).toBe('t');
    const expected = computeGlicko2({ rating: 1500, rd: 200, vol: 0.06, gamesPlayed: 30 },
      [{ opponent: getFritzConfig(FRITZ_ELITE_ID), result: { score: 60, opponentScore: 20 } }]);
    expect((await processAllPendingRatingGames()).processed).toBe(1);
    expect(Number(sql(`select rating_after from ranked_games where id='${game}'`))).toBeCloseTo(expected.newRating, 10);
    // and the applied historical row can no longer be reverted to a poison-looking pending row
    expect(() => sql(`update ranked_games set rating_after=null,rd_after=null,delta=null where id='${game}'`)).toThrow(/ranked_applied_state_monotonic/);
  });

  it.each([['normal', 'standard', false], ['manual forfeit', 'standard', true], ['disconnect', 'disconnect_forfeit', true]] as const)
  ('%s: durable insert → inline equals interrupted insert → catch-up for both seats', async (_name, treatment, forfeit) => {
    const baseline = await seed(treatment, forfeit); await baseline.inline();
    const expected = baseline.snapshot();
    const crashed = await seed(treatment, forfeit);
    expect((await processAllPendingRatingGames()).processed).toBe(2);
    expect(crashed.snapshot()).toEqual(expected);
    expect(crashed.receipts()).toBe(2);
    expect((await processAllPendingRatingGames()).processed).toBe(0);
    expect(crashed.receipts()).toBe(2);
  });

  const matrix = ([['zero/zero', [true, true]], ['zero/established', [true, false]], ['established/zero', [false, true]]] as const)
    .flatMap(([label, zero]) => ([['normal', 'standard', false], ['manual', 'standard', true], ['disconnect', 'disconnect_forfeit', true]] as const)
      .map(([mode, treatment, forfeit]) => ({ name: `${label} ${mode}`, zero, treatment, forfeit })));
  it.each(matrix)('$name: exact parity through insert interruption, partial commit, lost reply and overlap', async ({ zero, treatment, forfeit }) => {
    const baseline = await seed(treatment, forfeit, zero); await baseline.inline(); const expected = baseline.snapshot();
    baseline.rows.forEach((row, i) => expect((row.rating_context as { player: { rating: number } }).player.rating).toBe(zero[i] ? 800 : i === 0 ? 1500 : 1600));
    const before = await seed(treatment, forfeit, zero);
    expect((await processAllPendingRatingGames()).processed).toBe(2); expect(before.snapshot()).toEqual(expected);
    const partial = await seed(treatment, forfeit, zero); const actual = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/rpc/commit_glicko_game_update') && JSON.parse(String(init?.body)).p_profile_id === partial.ids[1]) throw Error('matrix interruption');
      return actual(input, init);
    });
    await expect(partial.inline()).rejects.toThrow('matrix interruption');
    await vi.waitFor(() => expect(partial.receipts()).toBe(1)); vi.restoreAllMocks(); resetRatingCatchUpForTests();
    expect((await processAllPendingRatingGames()).processed).toBe(1); expect(partial.snapshot()).toEqual(expected);
    const lost = await seed(treatment, forfeit, zero); const transport = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const response = await transport(input, init);
      if (String(input).includes('/rpc/commit_glicko_game_update') && JSON.parse(String(init?.body)).p_profile_id === lost.ids[0]) { await response.text(); throw Error('matrix lost reply'); }
      return response;
    });
    await expect(lost.inline()).rejects.toThrow('matrix lost reply'); await vi.waitFor(() => expect(lost.receipts()).toBe(2));
    vi.restoreAllMocks(); resetRatingCatchUpForTests(); await processAllPendingRatingGames(); expect(lost.snapshot()).toEqual(expected);
    const race = await seed(treatment, forfeit, zero);
    await Promise.all([race.inline(), processAllPendingRatingGames()]); expect(race.snapshot()).toEqual(expected); expect(race.receipts()).toBe(2);
    expect((await processAllPendingRatingGames()).processed).toBe(0); expect(race.receipts()).toBe(2);
  });

  it('crash between participant inserts preserves the other seat pre-game input after first seat applies', async () => {
    const baseline = await seed('disconnect_forfeit', true, [true, true]); await baseline.inline(); const expected = baseline.snapshot();
    const partial = await seed('disconnect_forfeit', true, [true, true], 1);
    expect((await processAllPendingRatingGames()).processed).toBe(1);
    const second = await insertRankedGameIdempotent({ playerId: partial.ids[1]!, opponentId: partial.ids[0]!,
      playerScore: 20, opponentScore: 40, gameType: 'multiplayer', ratingBefore: 1500, rdBefore: 200,
      playedAt: new Date().toISOString(), ratingTreatment: 'disconnect_forfeit', completionCause: 'disconnect_timeout',
      opponentRating: 1500, opponentRd: 200, outcome: 'win', source: { sourceType: 'live_room', sourceMatchId: partial.source } });
    expect(second.isNew).toBe(true); if (!second.isNew) throw Error('not inserted');
    expect((second.game.rating_context as { opponent: { rating: number } }).opponent.rating).toBe(800);
    expect((await processAllPendingRatingGames()).processed).toBe(1); expect(partial.snapshot()).toEqual(expected);
  });

  it('successor insertion drains its predecessor and concurrent catch-up cannot bypass ordering', async () => {
    const db = await seed('disconnect_forfeit', true, [true, true]);
    const predecessor = db.rows[0]!;
    const successor = await Promise.all([insertRankedGameIdempotent({ playerId: db.ids[0]!, opponentId: db.ids[1]!,
      playerScore: 60, opponentScore: 10, gameType: 'multiplayer', ratingBefore: 0, rdBefore: 200,
      playedAt: new Date().toISOString(), ratingTreatment: 'standard', completionCause: 'completed', opponentRating: 0, opponentRd: 200,
      source: { sourceType: 'live_room', sourceMatchId: randomUUID() } }), processAllPendingRatingGames()]);
    const result = successor[0]; expect(result.isNew).toBe(true); if (!result.isNew) throw Error('not inserted');
    const before = result.game.rating_context as { player: { rating: number; gamesPlayed: number }; opponent: { rating: number } };
    expect(before.player.gamesPlayed).toBe(1);
    expect(before.player.rating).toBe(Number(sql(`select rating_after from ranked_games where id='${predecessor.id}'`)));
    expect(before.opponent.rating).toBe(Number(sql(`select rating_after from ranked_games where id='${db.rows[1]!.id}'`)));
    expect((await processAllPendingRatingGames()).processed).toBe(1);
    expect(db.receipts()).toBe(3); expect((await processAllPendingRatingGames()).processed).toBe(0);
  });

  it('DB rejects a successor admitted without draining and fences stale decay against pending context', async () => {
    const db = await seed('disconnect_forfeit'); const row = db.rows[0]!;
    await expect(supabaseFetch('/rest/v1/ranked_games', { method: 'POST', body: JSON.stringify({ ...row, id: randomUUID(), source_match_id: randomUUID() }) })).rejects.toThrow('ranked_predecessor_pending');
    await expect(supabaseFetch('/rest/v1/rpc/commit_glicko_decay_update', { method: 'POST', body: JSON.stringify({
      p_profile_id: db.ids[0], p_new_rd: 201, p_processed_at: new Date().toISOString(), p_rating_before: 1500,
      p_rd_before: 200, p_vol_before: 0.06, p_games_before: 30,
    }) })).rejects.toThrow('ranked_state_conflict');
    expect(db.receipts()).toBe(0); expect(sql(`select glicko_rd from profiles where id='${db.ids[0]}'`)).toBe('200');
  });

  it('one committed side + process restart recovers the other with the original opponent inputs', async () => {
    const baseline = await seed('disconnect_forfeit'); await baseline.inline(); const expected = baseline.snapshot();
    const crashed = await seed('disconnect_forfeit');
    const actualFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/rpc/commit_glicko_game_update') && JSON.parse(String(init?.body)).p_profile_id === crashed.ids[1]) {
        throw new Error('simulated process interruption before second RPC');
      }
      return actualFetch(input, init);
    });
    const failure = expect(crashed.inline()).rejects.toThrow('simulated process interruption');
    await failure;
    await vi.waitFor(() => expect(crashed.receipts()).toBe(1));
    vi.restoreAllMocks(); resetRatingCatchUpForTests();
    expect((await processAllPendingRatingGames()).processed).toBe(1);
    expect(crashed.snapshot()).toEqual(expected);
    expect(crashed.receipts()).toBe(2);
  });

  it('row-locked foreground + catch-up race and duplicate recovery have one period per game', async () => {
    const db = await seed('disconnect_forfeit');
    const release = await holdPostgresRowLock(dbUrl!, `select 1 from ranked_games where id='${db.rows[0]!.id}' for update`, psql);
    const foreground = db.inline(); const catchUp = processAllPendingRatingGames();
    try { await waitForBlockedPostgresCalls(dbUrl!, 'commit_glicko_game_update', 2, psql); }
    finally { await release(); }
    await Promise.all([foreground, catchUp]);
    expect(db.receipts()).toBe(2);
    expect((await processAllPendingRatingGames()).processed).toBe(0);
    expect(db.receipts()).toBe(2);
    expect(sql(`select count(*) from profiles where id in ('${db.ids[0]}','${db.ids[1]}') and ranked_games_played=31`)).toBe('2');
  });

  it('receipt failure rolls back the profile and game writes in the actual transaction', async () => {
    const db = await seed('disconnect_forfeit');
    // Force the final statement to fail after UPDATE profiles and UPDATE game.
    sql(`insert into rating_periods(user_id,ranked_game_id,rating_before,rating_after,rd_before,rd_after) values ('${db.ids[0]}','${db.rows[0]!.id}',1500,1500,200,200)`);
    await expect(rawCommit(db.profiles[0]!, db.rows[0]!)).rejects.toThrow('duplicate key');
    expect(sql(`select glicko_rating || ',' || ranked_games_played from profiles where id='${db.ids[0]}'`)).toBe('1500,30');
    expect(sql(`select count(*) from ranked_games where id='${db.rows[0]!.id}' and rating_after is null and delta is null`)).toBe('1');
    sql(`delete from rating_periods where ranked_game_id='${db.rows[0]!.id}'`);
    expect((await processAllPendingRatingGames()).processed).toBe(2);
    expect(db.receipts()).toBe(2);
    expect((await processAllPendingRatingGames()).processed).toBe(0);
  });

  it('a response lost after the actual transaction commits causes no duplicate effect', async () => {
    const db = await seed('disconnect_forfeit'); const actualFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const response = await actualFetch(input, init);
      if (String(input).includes('/rpc/commit_glicko_game_update') && JSON.parse(String(init?.body)).p_profile_id === db.ids[0]) {
        await response.text(); throw new Error('simulated lost committed response');
      }
      return response;
    });
    await expect(db.inline()).rejects.toThrow('lost committed response');
    await vi.waitFor(() => expect(db.receipts()).toBe(2));
    vi.restoreAllMocks(); resetRatingCatchUpForTests();
    expect((await processAllPendingRatingGames()).processed).toBe(0);
    expect(db.receipts()).toBe(2);
  });

  it('old caller without context can commit a legacy row but is fenced from new contexts', async () => {
    const db = await seed('disconnect_forfeit');
    await expect(rawCommit(db.profiles[0]!, db.rows[0]!, false)).rejects.toThrow('ranked_rating_context_mismatch');
    expect(db.receipts()).toBe(0);
    const oldId = randomUUID();
    sql(`insert into ranked_games(id,player_id,opponent_id,player_score,opponent_score,game_type,rating_before,rd_before)
      values ('${oldId}','${db.ids[0]}','${db.ids[1]}',40,20,'multiplayer',1500,200)`);
    await rawCommit(db.profiles[0]!, { id: oldId }, false);
    expect(db.receipts()).toBe(1);
  });

  it('DB rejects unsupported/malformed contexts and prevents metadata/outcome mutation', async () => {
    const db = await seed('disconnect_forfeit'); const row = db.rows[0]!;
    for (const invalid of [{}, { version: 2 }, 'disconnect_forfeit',
      { ...(row.rating_context as object), treatment: 'unknown' },
      { ...(row.rating_context as object), opponent: { rating: '1500', rd: 200 } },
      { ...(row.rating_context as object), opponent: { rating: 1500, rd: 0 } },
      { ...(row.rating_context as object), cause: 'completed' },
      ...[undefined, null, { rating: 1500, rd: 200, gamesPlayed: 30, peakRating: 1600 },
        ...[NaN, Infinity, -10001, 10001].map((rating) => ({ rating, rd: 200, vol: 0.06, gamesPlayed: 30, peakRating: 1600 })),
        { rating: 1500, rd: 200, vol: 0, gamesPlayed: 30, peakRating: 1600 },
        { rating: 1500, rd: 200, vol: 0.06, gamesPlayed: -1, peakRating: 1600 },
        { rating: 1500, rd: 200, vol: 0.06, gamesPlayed: 1.5, peakRating: 1600 }]
        .map((player) => ({ ...(row.rating_context as object), player }))]) {
      await expect(supabaseFetch('/rest/v1/ranked_games', { method: 'POST', body: JSON.stringify({
        player_id: db.ids[0], opponent_id: db.ids[1], player_score: 40, opponent_score: 20,
        game_type: 'multiplayer', rating_before: 1500, rd_before: 200, outcome: 'loss', rating_context: invalid,
      }) })).rejects.toThrow('ranked_games_rating_context_valid');
    }
    await expect(supabaseFetch(`/rest/v1/ranked_games?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ rating_context: null }) })).rejects.toThrow('ranked_rating_context_immutable');
    await expect(supabaseFetch(`/rest/v1/ranked_games?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ outcome: 'win' }) })).rejects.toThrow('ranked_rating_context_immutable');
    expect(db.receipts()).toBe(0);
  });

  it('source-key retries cannot replace the first authoritative treatment', async () => {
    const db = await seed('disconnect_forfeit');
    const duplicate = await insertRankedGameIdempotent({ playerId: db.ids[0]!, opponentId: db.ids[1]!,
      playerScore: 40, opponentScore: 20, gameType: 'multiplayer', ratingBefore: 1500, rdBefore: 200,
      playedAt: new Date().toISOString(), ratingTreatment: 'standard', completionCause: 'manual_forfeit', opponentRating: 1600, opponentRd: 200,
      outcome: 'loss', source: { sourceType: 'live_room', sourceMatchId: db.source } });
    expect(duplicate.isNew).toBe(false);
    expect(sql(`select rating_context->>'treatment' from ranked_games where id='${db.rows[0]!.id}'`)).toBe('disconnect_forfeit');
  });
});
