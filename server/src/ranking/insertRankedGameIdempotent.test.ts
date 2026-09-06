import { beforeEach, describe, expect, it, vi } from 'vitest';
import { insertRankedGameIdempotent } from './insertRankedGameIdempotent';
import { supabaseFetch } from '../supabaseUtils';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

const mockedSupabaseFetch = vi.mocked(supabaseFetch);

const baseInput = {
  playerId: '11111111-1111-4111-8111-111111111111',
  opponentId: '22222222-2222-4222-8222-222222222222',
  playerScore: 61,
  opponentScore: 42,
  gameType: 'multiplayer',
  ratingBefore: 812.5,
  rdBefore: 180.25,
  playedAt: '2026-06-02T00:00:00.000Z',
  source: {
    sourceType: 'live_room' as const,
    sourceMatchId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  },
};

const insertedRow = {
  id: 'game-row-1',
  player_id: baseInput.playerId,
  opponent_id: baseInput.opponentId,
  player_score: 61,
  opponent_score: 42,
  played_at: baseInput.playedAt,
  rating_after: null,
  source_type: 'live_room',
  source_match_id: baseInput.source.sourceMatchId,
};

beforeEach(() => {
  mockedSupabaseFetch.mockReset();
});

describe('insertRankedGameIdempotent', () => {
  it('posts with on_conflict and ignore-duplicates when the input carries a sourceMatchId', async () => {
    mockedSupabaseFetch.mockResolvedValue([insertedRow]);

    const result = await insertRankedGameIdempotent(baseInput);

    expect(result).toEqual({ isNew: true, game: insertedRow });
    expect(mockedSupabaseFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mockedSupabaseFetch.mock.calls[0]!;
    expect(path).toBe('/rest/v1/ranked_games?on_conflict=player_id,source_match_id');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Prefer: 'return=representation,resolution=ignore-duplicates',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      player_id: baseInput.playerId,
      source_type: 'live_room',
      source_match_id: baseInput.source.sourceMatchId,
    });
  });

  it('returns isNew false when ignore-duplicates yields no row (duplicate source)', async () => {
    mockedSupabaseFetch.mockResolvedValue([]);

    const result = await insertRankedGameIdempotent(baseInput);

    expect(result).toEqual({ isNew: false, game: null });
  });

  it('RK-8: the deleted RANKED_GAMES_SOURCE_COLUMNS_ENABLED env var has no effect — still takes the on_conflict path', async () => {
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = 'false';
    mockedSupabaseFetch.mockResolvedValue([insertedRow]);
    try {
      await insertRankedGameIdempotent(baseInput);

      const [path, init] = mockedSupabaseFetch.mock.calls[0]!;
      // The old escape hatch is gone: =false must NOT drop back to a bare POST.
      expect(path).toBe('/rest/v1/ranked_games?on_conflict=player_id,source_match_id');
      expect(init?.headers).toMatchObject({
        Prefer: 'return=representation,resolution=ignore-duplicates',
      });
    } finally {
      delete process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;
    }
  });

  it('falls back to a plain POST when the input carries no sourceMatchId (completeGhostGame null-matchId path)', async () => {
    mockedSupabaseFetch.mockResolvedValue([{ ...insertedRow, source_type: null, source_match_id: null }]);

    const result = await insertRankedGameIdempotent({ ...baseInput, source: null });

    expect(result.isNew).toBe(true);
    const [path, init] = mockedSupabaseFetch.mock.calls[0]!;
    expect(path).toBe('/rest/v1/ranked_games');
    expect(init?.headers).toMatchObject({ Prefer: 'return=representation' });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('source_match_id');
  });

  it('returns isNew false when a source-less plain insert returns no row', async () => {
    mockedSupabaseFetch.mockResolvedValue([]);

    const result = await insertRankedGameIdempotent({ ...baseInput, source: null });

    expect(result).toEqual({ isNew: false, game: null });
  });
});
