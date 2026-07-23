import { describe, expect, it } from 'vitest';
import { resolveTranscriptDrawLogCount } from './dailyFritzDrawTranscript.ts';

describe('resolveTranscriptDrawLogCount', () => {
  it('expands each drawn tile for Daily Fritz verification', () => {
    expect(resolveTranscriptDrawLogCount(true, 3)).toBe(3);
    expect(resolveTranscriptDrawLogCount(true, 1)).toBe(1);
  });

  it('collapses multi-draws for non-Daily modes', () => {
    expect(resolveTranscriptDrawLogCount(false, 3)).toBe(1);
    expect(resolveTranscriptDrawLogCount(false, 1)).toBe(1);
  });

  it('returns zero when nothing was drawn', () => {
    expect(resolveTranscriptDrawLogCount(true, 0)).toBe(0);
    expect(resolveTranscriptDrawLogCount(false, 0)).toBe(0);
  });
});
