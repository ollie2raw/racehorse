import { describe, expect, it } from 'vitest';
import { fritzCupErrorCopy, registrationErrorCopy } from './tournamentErrorCopy';
import { TournamentApiError } from './tournamentApi';

const NY = { timeZone: 'America/New_York' };
const EIGHT_PM_ET = '2026-10-31T00:00:00.000Z'; // 17:00 PT = 20:00 ET

describe('registration error copy', () => {
  it('overlap names a Fritz Cup, or the conflicting Live Event in local time', () => {
    expect(registrationErrorCopy(new TournamentApiError({ code: 'overlapping_tournament', conflict: { tournamentId: 'c', kind: 'fritz_cup', scheduledStart: EIGHT_PM_ET } }), NY))
      .toBe('You have a Fritz Cup in progress. Finish it first.');
    expect(registrationErrorCopy(new TournamentApiError({ code: 'overlapping_tournament', conflict: { tournamentId: 'l', kind: 'live', scheduledStart: EIGHT_PM_ET } }), NY))
      .toBe("You're already entered in the 8:00 PM Live Event, which overlaps this one.");
  });
  it('closed, full, withdraw closed, and anything else', () => {
    expect(registrationErrorCopy(new TournamentApiError({ code: 'registration_closed' }))).toBe('Registration has closed for this event.');
    expect(registrationErrorCopy(new TournamentApiError({ code: 'tournament_full' }))).toBe('This event is full.');
    expect(registrationErrorCopy(new TournamentApiError({ code: 'withdraw_closed' }))).toBe("Registration has closed, so you can't withdraw now.");
    expect(registrationErrorCopy(new TournamentApiError({ code: 'internal' }))).toBe("Couldn't update your registration. Try again.");
    expect(registrationErrorCopy(new TournamentApiError({ code: 'network' }))).toBe("Couldn't update your registration. Try again.");
    expect(registrationErrorCopy(new Error('relation "x" does not exist'))).toBe("Couldn't update your registration. Try again.");
  });
});

describe('Fritz Cup error copy', () => {
  it('rate limit / cooldown / daily limit with the retry time', () => {
    expect(fritzCupErrorCopy(new TournamentApiError({ code: 'rate_limited', retryAfterMs: 9_001 }))).toBe('Too many attempts. Try again in 10s.');
    expect(fritzCupErrorCopy(new TournamentApiError({ code: 'fritz_cup_cooldown', retryAfterMs: 41_000, reason: 'cooldown' }))).toBe('You just started a Cup. Try again in 41s.');
    expect(fritzCupErrorCopy(new TournamentApiError({ code: 'fritz_cup_cooldown', retryAfterMs: 999_000, reason: 'daily_limit' }))).toBe("That's today's Fritz Cup limit. Try again later.");
  });
  it('overlap with a Live Event in local time; disabled hides; auth; internal', () => {
    expect(fritzCupErrorCopy(new TournamentApiError({ code: 'overlapping_tournament', conflict: { tournamentId: 'l', kind: 'live', scheduledStart: EIGHT_PM_ET } }), NY))
      .toBe("You're entered in a Live Event at 8:00 PM. A Fritz Cup now would overlap it.");
    expect(fritzCupErrorCopy(new TournamentApiError({ code: 'tournaments_disabled' }))).toBeNull();
    expect(fritzCupErrorCopy(new TournamentApiError({ code: 'not_authenticated' }))).toBe('Sign in to play.');
    expect(fritzCupErrorCopy(new TournamentApiError({ code: 'internal' }))).toBe("Couldn't start the Fritz Cup. Try again.");
  });
});
