import { describe, expect, it } from 'vitest';
import { buildGameReviewInsertPayload, parseGameReviewRequestBody } from './gameReviewPayload';

const baseInput = {
  userId: '11111111-1111-4111-8111-111111111111',
  gameDigest: 'digest-abc123',
  reviewEngineVersion: 'review-engine-v1',
  accuracyModelVersion: 'accuracy-model-v4-calibrated-2026-09-17',
  evaluations: [{ decisionId: 'd1', evidence: { source: 'exact' } }],
  accuracyModelResult: { accuracy: 88.1, grade: 'A' },
  mode: 'pvf' as const,
};

describe('buildGameReviewInsertPayload', () => {
  it('maps camelCase input to the snake_case column payload', () => {
    const payload = buildGameReviewInsertPayload(baseInput);
    expect(payload).toEqual({
      user_id: baseInput.userId,
      game_digest: baseInput.gameDigest,
      review_engine_version: baseInput.reviewEngineVersion,
      accuracy_model_version: baseInput.accuracyModelVersion,
      evaluations: baseInput.evaluations,
      accuracy_model_result: baseInput.accuracyModelResult,
      mode: 'pvf',
    });
  });

  it('includes source_match_id only when a non-blank sourceMatchId is provided', () => {
    const withSource = buildGameReviewInsertPayload({ ...baseInput, sourceMatchId: 'match-1' });
    expect(withSource.source_match_id).toBe('match-1');

    const withoutSource = buildGameReviewInsertPayload({ ...baseInput, sourceMatchId: '  ' });
    expect(withoutSource).not.toHaveProperty('source_match_id');

    const noSourceField = buildGameReviewInsertPayload(baseInput);
    expect(noSourceField).not.toHaveProperty('source_match_id');
  });
});

describe('parseGameReviewRequestBody', () => {
  const rawBody = {
    gameDigest: baseInput.gameDigest,
    reviewEngineVersion: baseInput.reviewEngineVersion,
    accuracyModelVersion: baseInput.accuracyModelVersion,
    evaluations: baseInput.evaluations,
    accuracyModelResult: baseInput.accuracyModelResult,
    mode: 'pvf',
  };

  it('parses a well-formed body into a GameReviewInsertInput', () => {
    const result = parseGameReviewRequestBody(rawBody, baseInput.userId);
    expect(result).toEqual({ ...baseInput, sourceMatchId: null, replayArtifact: null });
  });

  it('carries a trimmed sourceMatchId through when present', () => {
    const result = parseGameReviewRequestBody({ ...rawBody, sourceMatchId: 'match-1' }, baseInput.userId);
    expect(result).toMatchObject({ sourceMatchId: 'match-1' });
  });

  it('rejects a non-object body', () => {
    expect(parseGameReviewRequestBody(null, baseInput.userId)).toEqual({
      error: 'Request body must be an object.',
    });
    expect(parseGameReviewRequestBody('nope', baseInput.userId)).toEqual({
      error: 'Request body must be an object.',
    });
  });

  it('rejects a missing/blank gameDigest', () => {
    expect(parseGameReviewRequestBody({ ...rawBody, gameDigest: '  ' }, baseInput.userId)).toEqual({
      error: 'gameDigest is required.',
    });
    const { gameDigest: _drop, ...withoutDigest } = rawBody;
    expect(parseGameReviewRequestBody(withoutDigest, baseInput.userId)).toEqual({
      error: 'gameDigest is required.',
    });
  });

  it('rejects a missing reviewEngineVersion', () => {
    expect(
      parseGameReviewRequestBody({ ...rawBody, reviewEngineVersion: '' }, baseInput.userId),
    ).toEqual({ error: 'reviewEngineVersion is required.' });
  });

  it('rejects a missing accuracyModelVersion', () => {
    expect(
      parseGameReviewRequestBody({ ...rawBody, accuracyModelVersion: '' }, baseInput.userId),
    ).toEqual({ error: 'accuracyModelVersion is required.' });
  });

  it('rejects an empty or non-array evaluations field', () => {
    expect(parseGameReviewRequestBody({ ...rawBody, evaluations: [] }, baseInput.userId)).toEqual({
      error: 'evaluations must be a non-empty array.',
    });
    expect(parseGameReviewRequestBody({ ...rawBody, evaluations: 'nope' }, baseInput.userId)).toEqual({
      error: 'evaluations must be a non-empty array.',
    });
  });

  it('rejects a missing accuracyModelResult', () => {
    expect(
      parseGameReviewRequestBody({ ...rawBody, accuracyModelResult: null }, baseInput.userId),
    ).toEqual({ error: 'accuracyModelResult is required.' });
  });

  it("rejects a mode outside the supported review modes", () => {
    expect(parseGameReviewRequestBody({ ...rawBody, mode: 'ghost' }, baseInput.userId)).toEqual({
      error: "mode must be 'pvf', 'mp', or 'multiplayer'.",
    });
  });

  it('accepts the explicit multiplayer persistence mode', () => {
    expect(parseGameReviewRequestBody({ ...rawBody, mode: 'multiplayer' }, baseInput.userId)).toMatchObject({
      mode: 'multiplayer',
      userId: baseInput.userId,
    });
  });
});
