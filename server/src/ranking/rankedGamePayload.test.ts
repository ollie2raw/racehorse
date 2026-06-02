import { afterEach, describe, expect, it } from 'vitest';
import { buildRankedGameInsertPayload } from './rankedGamePayload';

const OLD_ENV = process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;

afterEach(() => {
  if (OLD_ENV === undefined) {
    delete process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;
  } else {
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = OLD_ENV;
  }
});

describe('buildRankedGameInsertPayload', () => {
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
      sourceMatchId: 'room-match-1',
    },
  };

  it('keeps the current DB payload shape exactly when the source-column flag is off', () => {
    delete process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED;

    expect(buildRankedGameInsertPayload(baseInput)).toEqual({
      player_id: '11111111-1111-4111-8111-111111111111',
      opponent_id: '22222222-2222-4222-8222-222222222222',
      player_score: 61,
      opponent_score: 42,
      game_type: 'multiplayer',
      rating_before: 812.5,
      rd_before: 180.25,
      played_at: '2026-06-02T00:00:00.000Z',
    });
  });

  it('includes source_type and source_match_id only when the source-column flag is on', () => {
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = 'true';

    expect(buildRankedGameInsertPayload(baseInput)).toEqual({
      player_id: '11111111-1111-4111-8111-111111111111',
      opponent_id: '22222222-2222-4222-8222-222222222222',
      player_score: 61,
      opponent_score: 42,
      game_type: 'multiplayer',
      rating_before: 812.5,
      rd_before: 180.25,
      played_at: '2026-06-02T00:00:00.000Z',
      source_type: 'live_room',
      source_match_id: 'room-match-1',
    });
  });

  it('preserves rating_after null for pending single-player rating rows', () => {
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = 'true';

    expect(
      buildRankedGameInsertPayload({
        ...baseInput,
        gameType: 'fritz',
        ratingAfter: null,
        source: {
          sourceType: 'verified_single_player',
          sourceMatchId: 'verified-match-1',
        },
      }),
    ).toMatchObject({
      game_type: 'fritz',
      rating_after: null,
      source_type: 'verified_single_player',
      source_match_id: 'verified-match-1',
    });
  });

  it('does not alter score or rating fields when source metadata is enabled', () => {
    process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED = 'true';

    const payload = buildRankedGameInsertPayload({
      ...baseInput,
      playerScore: 0,
      opponentScore: 60,
      ratingBefore: 799.75,
      rdBefore: 201.5,
      source: {
        sourceType: 'local_fritz_abandon',
        sourceMatchId: 'local:abc:abandon',
      },
    });

    expect(payload).toMatchObject({
      player_score: 0,
      opponent_score: 60,
      rating_before: 799.75,
      rd_before: 201.5,
      source_type: 'local_fritz_abandon',
      source_match_id: 'local:abc:abandon',
    });
  });
});
