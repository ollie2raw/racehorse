import { describe, expect, it } from 'vitest';
import { isGameReviewCohortUser, parseGameReviewCohortUserIds } from './gameReviewCohort';

describe('game review cohort allowlist', () => {
  it('treats an empty allowlist as disabled', () => {
    expect(parseGameReviewCohortUserIds('')).toEqual(new Set());
    expect(isGameReviewCohortUser('user-a', '')).toBe(false);
  });

  it('matches a single configured user', () => {
    expect(isGameReviewCohortUser('user-a', 'user-a')).toBe(true);
  });

  it('matches any member of a multiple-user allowlist', () => {
    expect(isGameReviewCohortUser('user-b', 'user-a,user-b,user-c')).toBe(true);
  });

  it('trims whitespace and ignores empty entries', () => {
    expect(parseGameReviewCohortUserIds(' user-a, , user-b ,')).toEqual(
      new Set(['user-a', 'user-b']),
    );
  });

  it('rejects a non-member', () => {
    expect(isGameReviewCohortUser('user-z', 'user-a,user-b')).toBe(false);
  });

  it('fails closed when authentication is missing', () => {
    expect(isGameReviewCohortUser(null, 'user-a')).toBe(false);
    expect(isGameReviewCohortUser(undefined, 'user-a')).toBe(false);
  });
});
