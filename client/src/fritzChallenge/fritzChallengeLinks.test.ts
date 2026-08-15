import { describe, expect, it } from 'vitest';
import {
  buildFritzChallengeShareUrl,
  normalizeFritzChallengeCode,
  readFritzChallengeCodeFromHash,
} from './fritzChallengeLinks';

describe('Fritz Challenge links', () => {
  it('normalizes readable challenge codes and rejects ambiguous values', () => {
    expect(normalizeFritzChallengeCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(normalizeFritzChallengeCode('ABCD0FGH')).toBeNull();
  });

  it('reads a challenge code from the HashRouter path', () => {
    expect(readFritzChallengeCodeFromHash('#/fritz/challenge/abcd-efgh')).toBe('ABCDEFGH');
    expect(readFritzChallengeCodeFromHash('#/solo')).toBeNull();
  });

  it('builds a deployment-safe hash link', () => {
    expect(buildFritzChallengeShareUrl('ABCDEFGH', {
      origin: 'https://playracehorse.com',
      pathname: '/',
    } as Location)).toBe('https://playracehorse.com/#/fritz/challenge/ABCDEFGH');
  });
});
