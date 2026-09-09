import { describe, expect, it } from 'vitest';
import { tournamentErrorCopy } from './tournamentErrorCopy';

describe('tournamentErrorCopy', () => {
  it('turns a missing / bad tournament into human copy, never the raw code', () => {
    for (const code of ['invalid_tournament_id', 'not_found']) {
      const copy = tournamentErrorCopy(code);
      expect(copy).toMatch(/could not be found/i);
      expect(copy).not.toContain(code);
    }
  });

  it('explains an unfinished tournament distinctly', () => {
    expect(tournamentErrorCopy('not_completed')).toMatch(/has not finished/i);
  });

  it('falls back to a generic message for unknown / empty codes without echoing them', () => {
    expect(tournamentErrorCopy('some_internal_thing')).toMatch(/something went wrong/i);
    expect(tournamentErrorCopy('some_internal_thing')).not.toContain('some_internal_thing');
    expect(tournamentErrorCopy(null)).toMatch(/something went wrong/i);
    expect(tournamentErrorCopy('')).toMatch(/something went wrong/i);
  });
});
