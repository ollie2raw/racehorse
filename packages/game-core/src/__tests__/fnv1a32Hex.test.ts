import { describe, expect, it } from 'vitest';
import { createInitialState } from '../engine';
import { fnv1a32Hex, getReviewAuthorityStateDigest } from '../reviewContracts';

const INITIAL_TEST_STATE = createInitialState(['you', 'bot']);

describe('fnv1a32Hex', () => {
  it('is deterministic -- same input always hashes to the same 8-hex-char output', () => {
    expect(fnv1a32Hex('hello')).toBe(fnv1a32Hex('hello'));
    expect(fnv1a32Hex('hello')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces different hashes for different inputs (no trivial collision)', () => {
    expect(fnv1a32Hex('hello')).not.toBe(fnv1a32Hex('world'));
  });

  it('hashes the empty string without throwing', () => {
    expect(fnv1a32Hex('')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('getReviewAuthorityStateDigest -- unchanged output after the fnv1a32Hex extraction', () => {
  it('still returns the review-state-v<N>:<hex> format', () => {
    const digest = getReviewAuthorityStateDigest(INITIAL_TEST_STATE);
    expect(digest).toMatch(/^review-state-v\d+:[0-9a-f]{8}$/);
  });

  it('is deterministic for the same state', () => {
    expect(getReviewAuthorityStateDigest(INITIAL_TEST_STATE)).toBe(
      getReviewAuthorityStateDigest(INITIAL_TEST_STATE),
    );
  });
});
