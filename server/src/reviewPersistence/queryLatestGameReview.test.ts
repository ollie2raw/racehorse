import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryLatestGameReview, toGameReviewReadResult, type GameReviewRow } from './queryLatestGameReview';
import { supabaseFetch } from '../supabaseUtils';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

const mockedSupabaseFetch = vi.mocked(supabaseFetch);

const row: GameReviewRow = {
  id: 'review-1',
  user_id: '11111111-1111-4111-8111-111111111111',
  game_digest: 'digest-abc123',
  review_engine_version: 'review-engine-v1',
  accuracy_model_version: 'accuracy-model-v4-calibrated-2026-09-17',
  evaluations: [{ decisionId: 'd1', evidence: { source: 'exact' } }],
  accuracy_model_result: { accuracy: 88.1, grade: 'A' },
  mode: 'pvf',
  source_match_id: null,
  created_at: '2026-09-18T00:00:00.000Z',
};

beforeEach(() => {
  mockedSupabaseFetch.mockReset();
});

describe('queryLatestGameReview', () => {
  it('filters by user_id and game_digest explicitly -- E0d: mirrors getDailyFritzAttemptById, never relies on RLS', async () => {
    mockedSupabaseFetch.mockResolvedValue([row]);

    const result = await queryLatestGameReview(row.user_id, row.game_digest);

    expect(result).toEqual(row);
    expect(mockedSupabaseFetch).toHaveBeenCalledTimes(1);
    const [path, init] = mockedSupabaseFetch.mock.calls[0]!;
    expect(path).toBe(
      `/rest/v1/game_reviews?user_id=eq.${row.user_id}&game_digest=eq.${row.game_digest}&order=created_at.desc&limit=1`,
    );
    expect(init?.method).toBe('GET');
  });

  it('orders by created_at desc with limit 1 -- the latest row per digest, not full history', async () => {
    mockedSupabaseFetch.mockResolvedValue([row]);
    await queryLatestGameReview(row.user_id, row.game_digest);
    const [path] = mockedSupabaseFetch.mock.calls[0]!;
    expect(path).toContain('order=created_at.desc');
    expect(path).toContain('limit=1');
  });

  it('returns null when no row exists for that user+digest', async () => {
    mockedSupabaseFetch.mockResolvedValue([]);
    const result = await queryLatestGameReview(row.user_id, 'no-such-digest');
    expect(result).toBeNull();
  });

  it('URI-encodes userId/gameDigest so an unusual digest cannot break the query', async () => {
    mockedSupabaseFetch.mockResolvedValue([]);
    await queryLatestGameReview('user id/weird', 'digest&weird=1');
    const [path] = mockedSupabaseFetch.mock.calls[0]!;
    expect(path).toContain(encodeURIComponent('user id/weird'));
    expect(path).toContain(encodeURIComponent('digest&weird=1'));
  });
});

describe('toGameReviewReadResult', () => {
  it('camelCases the row and stamps source: client-asserted -- E0d trust-boundary marker', () => {
    expect(toGameReviewReadResult(row)).toEqual({
      gameDigest: row.game_digest,
      reviewEngineVersion: row.review_engine_version,
      accuracyModelVersion: row.accuracy_model_version,
      evaluations: row.evaluations,
      accuracyModelResult: row.accuracy_model_result,
      mode: row.mode,
      sourceMatchId: row.source_match_id,
      createdAt: row.created_at,
      source: 'client-asserted',
    });
  });

  it('carries a non-null sourceMatchId through when present', () => {
    const withSource = { ...row, source_match_id: 'match-1' };
    expect(toGameReviewReadResult(withSource).sourceMatchId).toBe('match-1');
  });
});
