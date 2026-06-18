import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertRankedGameIdempotent } from './insertRankedGameIdempotent';
import { supabaseFetch } from '../supabaseUtils';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

const mockedSupabaseFetch = vi.mocked(supabaseFetch);

const OLD_ENV = process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;

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

afterEach(() => {
  if (OLD_ENV === undefined) {
    delete process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;
  } else {
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = OLD_ENV;
  }
});

describe('insertRankedGameIdempotent', () => {
  it('posts with on_conflict and ignore-duplicates when source columns are enabled', async () => {
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = 'true';
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
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = 'true';
    mockedSupabaseFetch.mockResolvedValue([]);

    const result = await insertRankedGameIdempotent(baseInput);

    expect(result).toEqual({ isNew: false, game: null });
  });

  it('uses plain insert without on_conflict when the source-column flag is off', async () => {
    delete process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;
    mockedSupabaseFetch.mockResolvedValue([
      {
        ...insertedRow,
        source_type: undefined,
        source_match_id: undefined,
      },
    ]);

    const result = await insertRankedGameIdempotent(baseInput);

    expect(result.isNew).toBe(true);
    const [path, init] = mockedSupabaseFetch.mock.calls[0]!;
    expect(path).toBe('/rest/v1/ranked_games');
    expect(init?.headers).toMatchObject({ Prefer: 'return=representation' });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('source_match_id');
  });

  it('returns isNew false when legacy plain insert returns no row', async () => {
    delete process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;
    mockedSupabaseFetch.mockResolvedValue([]);

    const result = await insertRankedGameIdempotent(baseInput);

    expect(result).toEqual({ isNew: false, game: null });
  });
});
