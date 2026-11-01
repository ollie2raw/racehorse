import { describe, expect, it } from 'vitest';
import { playerFacingErrorMessage } from './playerFacingError';

const FALLBACK = 'Could not start your match. Please try again.';

describe('playerFacingErrorMessage', () => {
  it('replaces a raw JSON response body', () => {
    expect(playerFacingErrorMessage(new Error('{"ok":false,"error":"NOT_FOUND"}'), FALLBACK)).toBe(FALLBACK);
    expect(playerFacingErrorMessage(new Error('[{"code":1}]'), FALLBACK)).toBe(FALLBACK);
  });

  it('replaces bare error codes', () => {
    expect(playerFacingErrorMessage(new Error('NOT_FOUND'), FALLBACK)).toBe(FALLBACK);
    expect(playerFacingErrorMessage(new Error('rate_limited'), FALLBACK)).toBe(FALLBACK);
    expect(playerFacingErrorMessage('not_found', FALLBACK)).toBe(FALLBACK);
  });

  it('replaces transport noise', () => {
    expect(playerFacingErrorMessage(new Error('Failed to fetch'), FALLBACK)).toBe(FALLBACK);
    expect(playerFacingErrorMessage(new Error('HTTP 502'), FALLBACK)).toBe(FALLBACK);
    expect(playerFacingErrorMessage(new Error('Request failed with status code 404'), FALLBACK)).toBe(FALLBACK);
  });

  it('keeps messages that already read like sentences', () => {
    const sentence = 'The match start did not return a deal. Please try again.';
    expect(playerFacingErrorMessage(new Error(sentence), FALLBACK)).toBe(sentence);
  });

  it('falls back for empty and non-error values', () => {
    expect(playerFacingErrorMessage(new Error('   '), FALLBACK)).toBe(FALLBACK);
    expect(playerFacingErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
    expect(playerFacingErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });
});
