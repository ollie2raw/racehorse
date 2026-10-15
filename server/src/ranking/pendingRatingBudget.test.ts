import { beforeEach, describe, expect, it, vi } from 'vitest';
import { supabaseFetch } from '../supabaseUtils';
import { processAllPendingRatingGames, resetRatingCatchUpForTests, type Profile } from './periodService';
import { FRITZ_STANDARD_ID } from './glicko2';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));
const fetchMock = vi.mocked(supabaseFetch);
const profile = (id: string): Profile => ({ id, username: id, glicko_rating: 1000, glicko_rd: 200,
  glicko_vol: 0.06, glicko_last_period: null, ranked_games_played: 30, peak_rating: 1100, provisional: false });
const game = (i: number, player = 'user') => ({ id: String(i).padStart(4, '0'), player_id: player,
  opponent_id: FRITZ_STANDARD_ID, player_score: 60, opponent_score: 20,
  played_at: '2026-10-01T00:00:00.000Z', rating_after: null as number | null });

function database(rows: ReturnType<typeof game>[], missingOpponent?: string) {
  const profiles = new Map<string, Profile>();
  fetchMock.mockImplementation(async (path, init) => {
    const url = new URL(path, 'https://local.invalid');
    if (url.pathname === '/rest/v1/ranked_games') {
      expect(url.searchParams.get('select')).not.toBe('*');
      expect(url.searchParams.get('limit')).toBe('100');
      expect(url.searchParams.has('offset')).toBe(false);
      const after = url.searchParams.get('or')?.match(/played_at.gt.([^,]+),and\(played_at.eq.[^,]+,id.gt.([^)]*)/);
      return rows.filter((r) => r.rating_after === null && (!after || r.played_at > after[1]!
        || (r.played_at === after[1] && r.id > after[2]!)))
        .sort((a, b) => a.played_at.localeCompare(b.played_at) || a.id.localeCompare(b.id)).slice(0, 100) as never;
    }
    if (url.pathname === '/rest/v1/profiles') {
      const id = url.searchParams.get('id')!.slice(3);
      if (id === missingOpponent) return [] as never;
      if (!profiles.has(id)) profiles.set(id, profile(id));
      return [{ ...profiles.get(id)! }] as never;
    }
    if (url.pathname === '/rest/v1/rpc/commit_glicko_game_update') {
      const body = JSON.parse(String(init?.body));
      const row = rows.find((r) => r.id === body.p_game_id)!;
      if (row.rating_after !== null) throw new Error('ranked_already_processed');
      row.rating_after = body.p_glicko_rating;
      profiles.set(body.p_profile_id, { ...profiles.get(body.p_profile_id)!,
        glicko_rating: body.p_glicko_rating, glicko_rd: body.p_glicko_rd,
        glicko_vol: body.p_glicko_vol, ranked_games_played: body.p_ranked_games_played });
      return undefined as never;
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  return { profiles };
}

beforeEach(() => { fetchMock.mockReset(); resetRatingCatchUpForTests(); });

describe('pending ranking catch-up request budgets', () => {
  it('zero work costs one GET and no profiles or RPCs', async () => {
    database([]);
    expect(await processAllPendingRatingGames()).toMatchObject({ scanned: 0, processed: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('one recoverable Fritz game costs three requests and is never applied twice', async () => {
    database([game(1)]);
    expect(await processAllPendingRatingGames()).toMatchObject({ processed: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // scan, player profile, atomic commit
    fetchMock.mockClear();
    expect(await processAllPendingRatingGames()).toMatchObject({ processed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('100 distinct players cost 201 calls, with zero per-player game reads', async () => {
    database(Array.from({ length: 100 }, (_, i) => game(i, `u-${i}`)));
    expect(await processAllPendingRatingGames()).toMatchObject({ scanned: 100, processed: 100, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(201); // old path: 301
    expect(fetchMock.mock.calls.filter(([p]) => p.startsWith('/rest/v1/ranked_games'))).toHaveLength(1);
  });

  it('100 new-context human games cost 201 calls with no mutable opponent reads', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...game(i, `u-${i}`), opponent_id: `opponent-${i}`, outcome: 'win' as const,
      rating_context: { version: 1, cause: 'completed', treatment: 'standard', outcome: 'win',
        player: { rating: 1000, rd: 200, vol: 0.06, gamesPlayed: 30, peakRating: 1100 }, opponent: { rating: 1500, rd: 200 } } }));
    database(rows);
    expect(await processAllPendingRatingGames()).toMatchObject({ processed: 100, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(201);
    expect(fetchMock.mock.calls.filter(([path]) => path.includes('id=eq.opponent-'))).toHaveLength(0);
  });

  it('100 no-op poison games cost three reads, back off, and cannot starve a later game', async () => {
    const rows = [...Array.from({ length: 100 }, (_, i) => ({ ...game(i), opponent_id: 'deleted-opponent' })), game(100)];
    const before = structuredClone(rows.slice(0, 100));
    database(rows, 'deleted-opponent');
    expect(await processAllPendingRatingGames()).toMatchObject({ scanned: 100, processed: 0, failed: 100 });
    expect(fetchMock).toHaveBeenCalledTimes(3); // one scan + one player + one missing opponent
    fetchMock.mockClear();
    expect(await processAllPendingRatingGames()).toMatchObject({ processed: 1, paged: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockClear();
    expect(await processAllPendingRatingGames()).toMatchObject({ scanned: 100, skipped: 100, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no repeated profile lookup during backoff
    expect(rows.slice(0, 100)).toEqual(before);
  });

  it('uses the full chronological keyset even when a later game has a lower id', async () => {
    const old = Array.from({ length: 100 }, (_, i) => ({ ...game(i), id: `z-${i}`, opponent_id: 'gone' }));
    const later = { ...game(0), played_at: '2026-10-02T00:00:00.000Z' };
    database([...old, later], 'gone');
    await processAllPendingRatingGames();
    expect(await processAllPendingRatingGames()).toMatchObject({ scanned: 1, processed: 1, paged: true });
    expect(later.rating_after).not.toBeNull();
  });

  it('isolates a missing player profile from other users', async () => {
    database([game(0, 'missing-player'), game(1, 'alive')], 'missing-player');
    expect(await processAllPendingRatingGames()).toMatchObject({ processed: 1, failed: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('an inline foreground commit wins without applying the rating twice', async () => {
    const row = game(1);
    const { profiles } = database([row]);
    const run = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (path, init) => {
      if (path.includes('/rpc/')) {
        row.rating_after = 1100;
        profiles.set('user', { ...profile('user'), glicko_rating: 1100, ranked_games_played: 31 });
      }
      return run(path, init);
    });
    expect(await processAllPendingRatingGames()).toMatchObject({ processed: 0, skipped: 1, failed: 0 });
    expect(profiles.get('user')!.ranked_games_played).toBe(31);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('isolates malformed persisted input and still processes the later valid game', async () => {
    const malformed = { ...game(0), player_score: { valueOf: 'broken' } };
    database([malformed as unknown as ReturnType<typeof game>, game(1)]);
    expect(await processAllPendingRatingGames()).toMatchObject({ processed: 1, failed: 1 });
    expect(malformed.player_score).toEqual({ valueOf: 'broken' });
    expect(fetchMock.mock.calls.filter(([p]) => p.includes('/rpc/commit_glicko_game_update'))).toHaveLength(1);
  });

  it('an RPC failure is isolated from the next game and retries after backoff', async () => {
    vi.useFakeTimers();
    try {
      database([game(0), game(1)]);
      const run = fetchMock.getMockImplementation()!;
      let fail = true;
      fetchMock.mockImplementation(async (path, init) => {
        if (path.includes('/rpc/') && JSON.parse(String(init?.body)).p_game_id === '0000' && fail) {
          fail = false;
          throw new Error('ranked_game_not_found');
        }
        return run(path, init);
      });
      expect(await processAllPendingRatingGames()).toMatchObject({ processed: 1, failed: 1 });
      expect(await processAllPendingRatingGames()).toMatchObject({ processed: 0, skipped: 1 });
      vi.advanceTimersByTime(30 * 60_000);
      expect(await processAllPendingRatingGames()).toMatchObject({ processed: 1, failed: 0 });
    } finally { vi.useRealTimers(); }
  });

  it.each([401, 403, 404, 429, 503])('stops on infrastructure failure %s instead of issuing one failed RPC per row', async (status) => {
    database(Array.from({ length: 100 }, (_, i) => game(i)));
    const run = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (path, init) => {
      if (path.includes('/rpc/')) throw new Error(`Supabase request failed: ${status} upstream`);
      return run(path, init);
    });
    await expect(processAllPendingRatingGames()).rejects.toThrow(String(status));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockImplementation(run);
    expect(await processAllPendingRatingGames()).toMatchObject({ processed: 100, paged: false });
  });

  it('holds single flight through latency, releases it after failure, and retains the cursor', async () => {
    database(Array.from({ length: 100 }, (_, i) => ({ ...game(i), opponent_id: 'gone' })), 'gone');
    await processAllPendingRatingGames();
    const run = fetchMock.getMockImplementation()!;
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementationOnce(async () => { await hold; throw new Error('scan unavailable'); });
    const first = processAllPendingRatingGames();
    expect(await processAllPendingRatingGames()).toMatchObject({ alreadyRunning: true, scanned: 0 });
    release();
    await expect(first).rejects.toThrow('scan unavailable');
    fetchMock.mockImplementation(run);
    expect(await processAllPendingRatingGames()).toMatchObject({ paged: true, scanned: 0 });
    const last = fetchMock.mock.calls.at(-1)![0];
    expect(last).toContain('id.gt.0099');
  });
});
