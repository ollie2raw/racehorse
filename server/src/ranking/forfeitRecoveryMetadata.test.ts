import { afterEach, describe, expect, it, vi } from 'vitest';
import { supabaseFetch } from '../supabaseUtils';
import { processAllPendingRatingGames, processRealtimeMultiplayerGame, resetRatingCatchUpForTests, type Profile } from './periodService';
import { buildRankedGameInsertPayload } from './rankedGamePayload';
import { readRankedRatingContext } from './ratingContext';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));
const fetchMock = vi.mocked(supabaseFetch);
const profile = (id: string): Profile => ({ id, username: id, glicko_rating: id === 'u1' ? 1500 : 1600,
  glicko_rd: 200, glicko_vol: 0.06, glicko_last_period: null, ranked_games_played: 30, peak_rating: 1600, provisional: false });
function install(treatment: 'standard' | 'disconnect_forfeit', forfeit = true) {
  resetRatingCatchUpForTests();
  const profiles = new Map(['u1', 'u2'].map((id) => [id, profile(id)]));
  const rows = ['u1', 'u2'].map((id, index) => ({
    ...buildRankedGameInsertPayload({ playerId: id, opponentId: index === 0 ? 'u2' : 'u1',
      playerScore: index === 0 ? 40 : 20, opponentScore: index === 0 ? 20 : 40, gameType: 'multiplayer',
      ratingTreatment: treatment, opponentRating: profile(index === 0 ? 'u2' : 'u1').glicko_rating, opponentRd: 200,
      ratingBefore: profile(id).glicko_rating, rdBefore: 200, playedAt: '2026-10-01T00:00:00.000Z',
      ...(forfeit ? { outcome: index === 0 ? 'loss' as const : 'win' as const } : {}),
    }), id: `g${index}`, rating_after: null as number | null, delta: null as number | null,
  }));
  const periods = new Map<string, number>();
  let failSide: string | undefined;
  let loseResponse: string | undefined;
  fetchMock.mockImplementation(async (path, init) => {
    if (path.startsWith('/rest/v1/profiles')) {
      const id = new URL(path, 'https://local.invalid').searchParams.get('id')!.slice(3);
      return [{ ...profiles.get(id)! }] as never;
    }
    if (path.startsWith('/rest/v1/ranked_games')) return rows.filter((r) => r.rating_after === null) as never;
    if (path.includes('/rpc/commit_glicko_game_update')) {
      const body = JSON.parse(String(init?.body));
      const row = rows.find((r) => r.id === body.p_game_id)!;
      const owner = profiles.get(row.player_id)!;
      if (row.rating_after !== null) throw new Error('ranked_already_processed');
      if (body.p_profile_id === failSide) { failSide = undefined; throw new Error('Supabase request failed: 503 unavailable'); }
      if (body.p_rating_before !== owner.glicko_rating || body.p_ranked_games_played !== owner.ranked_games_played + 1) throw new Error('ranked_state_conflict');
      expect(body.p_rating_context).toEqual(row.rating_context ?? null);
      row.rating_after = body.p_glicko_rating;
      row.delta = body.p_delta;
      periods.set(row.id, (periods.get(row.id) ?? 0) + 1);
      profiles.set(owner.id, { ...owner, glicko_rating: body.p_glicko_rating, glicko_rd: body.p_glicko_rd,
        glicko_vol: body.p_glicko_vol, ranked_games_played: body.p_ranked_games_played });
      if (body.p_profile_id === loseResponse) { loseResponse = undefined; throw new Error('Supabase request timed out after commit'); }
      return undefined as never;
    }
    throw new Error(`Unexpected local request: ${path}`);
  });
  return { rows, profiles, periods, fail: (side: string) => { failSide = side; },
    lose: (side: string) => { loseResponse = side; },
    inline: () => processRealtimeMultiplayerGame({ playerAProfile: profile('u1'), playerBProfile: profile('u2'),
      playerAGame: rows[0]!, playerBGame: rows[1]! }) };
}
afterEach(() => { vi.unstubAllEnvs(); fetchMock.mockReset(); resetRatingCatchUpForTests(); });

describe('durable ranked treatment crash matrix', () => {
  it.each([
    ['normal completion', 'standard', false], ['ordinary forfeit', 'standard', true],
    ['disconnect forfeit', 'disconnect_forfeit', true],
  ] as const)('%s: inline and restarted catch-up have identical results for both seats', async (_name, treatment, forfeit) => {
    const inline = install(treatment, forfeit);
    await inline.inline();
    const expected = inline.rows.map((r) => ({ rating: r.rating_after, delta: r.delta }));
    const crashed = install(treatment, forfeit); // only durable inserts survive
    expect((await processAllPendingRatingGames()).processed).toBe(2);
    expect(crashed.rows.map((r) => ({ rating: r.rating_after, delta: r.delta }))).toEqual(expected);
    expect((await processAllPendingRatingGames()).processed).toBe(0);
    expect([...crashed.periods.values()]).toEqual([1, 1]);
  });

  it('disconnect treatment halves only delta, while preserving RD/volatility policy', async () => {
    const standard = install('standard'); await standard.inline();
    const expected = standard.rows.map((r) => r.delta!);
    const reduced = install('disconnect_forfeit'); await reduced.inline();
    reduced.rows.forEach((r, index) => expect(r.delta).toBeCloseTo(expected[index]! * 0.5, 10));
    expect(reduced.profiles.get('u1')!.glicko_rd).toBe(standard.profiles.get('u1')!.glicko_rd);
    expect(reduced.profiles.get('u1')!.glicko_vol).toBe(standard.profiles.get('u1')!.glicko_vol);
  });

  it('one side committed before interruption: restart recovers the other from the original opponent snapshot', async () => {
    const baseline = install('disconnect_forfeit'); await baseline.inline();
    const expected = baseline.rows.map((r) => r.delta);
    const interrupted = install('disconnect_forfeit'); interrupted.fail('u2');
    await expect(interrupted.inline()).rejects.toThrow('503');
    expect(interrupted.periods.size).toBe(1);
    resetRatingCatchUpForTests();
    expect((await processAllPendingRatingGames()).processed).toBe(1);
    expect(interrupted.rows.map((r) => r.delta)).toEqual(expected);
    expect([...interrupted.periods.values()]).toEqual([1, 1]);
  });

  it('lost response after commit cannot double-apply the first seat on recovery', async () => {
    const db = install('disconnect_forfeit'); db.lose('u1');
    await expect(db.inline()).rejects.toThrow('timed out');
    resetRatingCatchUpForTests();
    expect((await processAllPendingRatingGames()).processed).toBe(0);
    expect([...db.periods.values()]).toEqual([1, 1]);
  });

  it('a concurrent foreground completion and catch-up produce one receipt per seat', async () => {
    const db = install('disconnect_forfeit');
    await Promise.all([db.inline(), processAllPendingRatingGames()]);
    expect([...db.periods.values()]).toEqual([1, 1]);
    expect(db.profiles.get('u1')!.ranked_games_played).toBe(31);
    expect(db.profiles.get('u2')!.ranked_games_played).toBe(31);
  });

  it('new writes do not depend on the retired outcome flag', () => {
    vi.stubEnv('RANKED_GAMES_OUTCOME_COLUMN_ENABLED', 'false');
    expect(install('disconnect_forfeit').rows[0]).toMatchObject({ outcome: 'loss', rating_context: { outcome: 'loss', treatment: 'disconnect_forfeit' } });
  });

  it.each([{}, { version: 2 }, 'disconnect_forfeit', { version: 1, treatment: 'unsupported' },
    { version: 1, treatment: 'standard', outcome: 'loss', opponent: { rating: 1500, rd: 0 } },
  ])('malformed context %j fails instead of silently becoming standard', (raw) => {
    expect(() => readRankedRatingContext(raw)).toThrow('Invalid ranked rating context');
  });

  it('catch-up isolates malformed persisted metadata, performs no normal fallback, and backs it off', async () => {
    const db = install('disconnect_forfeit');
    db.rows[0]!.rating_context = { version: 999 } as never;
    const first = await processAllPendingRatingGames();
    expect(first).toMatchObject({ processed: 1, failed: 1 });
    expect(db.periods.has('g0')).toBe(false);
    expect((await processAllPendingRatingGames())).toMatchObject({ processed: 0, skipped: 1 });
    expect(db.profiles.get('u1')!.ranked_games_played).toBe(30);
  });

  it('historical missing/NULL contexts retain full-weight interpretation', async () => {
    const db = install('standard');
    db.rows[0]!.rating_context = null as never;
    db.rows[1]!.rating_context = undefined as never;
    await db.inline();
    expect(db.periods.size).toBe(2);
    expect(readRankedRatingContext(null)).toBeNull();
    expect(readRankedRatingContext(undefined)).toBeNull();
  });
});
