import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  estimatedServerNowMs,
  hasTournamentServerClock,
  msUntil,
  observeTournamentPush,
  observeTournamentRequest,
  resetTournamentClockForTests,
  SAMPLE_MAX_AGE_MS,
  SOCKET_SAMPLE_GRACE_MS,
} from './tournamentClock';

let mono = 0;
const iso = (ms: number) => new Date(ms).toISOString();
const SERVER = Date.parse('2026-10-31T00:00:00.000Z');

beforeEach(() => {
  mono = 1_000;
  resetTournamentClockForTests(() => mono);
});
afterEach(() => {
  vi.useRealTimers();
  resetTournamentClockForTests();
});

describe('tournament server clock', () => {
  it('a request sample maps the round-trip midpoint to serverNow', () => {
    // sent at mono 1000, received at 1200; the server stamped SERVER at the midpoint (1100).
    observeTournamentRequest(1_000, 1_200, iso(SERVER));
    mono = 1_200;
    expect(estimatedServerNowMs()).toBe(SERVER + 100);
    mono = 61_200;
    expect(estimatedServerNowMs()).toBe(SERVER + 60_100);
    expect(hasTournamentServerClock()).toBe(true);
  });

  it('changing the device clock does not move the estimate', () => {
    vi.useFakeTimers();
    vi.setSystemTime(SERVER - 5 * 60 * 60_000);       // device 5 h behind
    observeTournamentRequest(1_000, 1_200, iso(SERVER));
    mono = 2_000;
    const before = estimatedServerNowMs();
    vi.setSystemTime(SERVER + 3 * 24 * 60 * 60_000);  // device jumps 3 days ahead
    expect(estimatedServerNowMs()).toBe(before);
    expect(before).toBe(SERVER + 900);
  });

  it('keeps the lowest round trip while it is fresh; a newer sample replaces it once it is old', () => {
    observeTournamentRequest(1_000, 1_100, iso(SERVER));          // rtt 100: offset SERVER - 1050
    observeTournamentRequest(2_000, 2_800, iso(SERVER + 5_000));  // rtt 800: worse, ignored
    mono = 3_000;
    expect(estimatedServerNowMs()).toBe(SERVER + 1_950);
    observeTournamentRequest(3_000, 3_050, iso(SERVER + 1_975));  // rtt 50: better, taken
    mono = 4_000;
    expect(estimatedServerNowMs()).toBe(SERVER + 2_950);
    // An old best sample is replaced by any newer one.
    const later = 3_050 + SAMPLE_MAX_AGE_MS + 1;
    observeTournamentRequest(later, later + 900, iso(SERVER + 99_000));
    mono = later + 900;
    expect(estimatedServerNowMs()).toBe(SERVER + 99_000 + 450);
  });

  it('a socket serverNow is a fallback only: used with no request sample, ignored while one is fresh, never backward', () => {
    observeTournamentPush(iso(SERVER), 1_000);
    mono = 1_500;
    expect(estimatedServerNowMs()).toBe(SERVER + 500);
    // a later socket sample that would move time backward is ignored
    observeTournamentPush(iso(SERVER - 10_000), 2_000);
    mono = 2_000;
    expect(estimatedServerNowMs()).toBe(SERVER + 1_000);
    // a request sample always beats a socket sample
    observeTournamentRequest(2_000, 2_100, iso(SERVER + 900));
    mono = 3_000;
    expect(estimatedServerNowMs()).toBe(SERVER + 1_850);
    // …and while it is fresh, a socket sample (even a forward one) is ignored
    observeTournamentPush(iso(SERVER + 60_000), 3_000);
    expect(estimatedServerNowMs()).toBe(SERVER + 1_850);
    // once the request sample is old, a forward socket sample may refresh it
    mono = 2_100 + SOCKET_SAMPLE_GRACE_MS + 1;
    const expected = estimatedServerNowMs() + 5_000;
    observeTournamentPush(iso(expected), mono);
    expect(estimatedServerNowMs()).toBe(expected);
  });

  it('a resume refetch re-syncs (a better or fresher request sample replaces the old one)', () => {
    observeTournamentRequest(1_000, 1_400, iso(SERVER));
    // the page was backgrounded; the server moved on more than the monotonic clock did
    mono = 1_000_000;
    observeTournamentRequest(1_000_000, 1_000_100, iso(SERVER + 5_000_000));
    mono = 1_000_100;
    expect(estimatedServerNowMs()).toBe(SERVER + 5_000_050);
  });

  it('countdowns clamp at zero and ignore invalid times', () => {
    observeTournamentRequest(1_000, 1_000, iso(SERVER));
    expect(msUntil(iso(SERVER + 90_000))).toBe(90_000);
    expect(msUntil(iso(SERVER - 5_000))).toBe(0);
    expect(msUntil('not a time')).toBeNull();
    expect(msUntil(null)).toBeNull();
  });

  it('ignores samples without a usable serverNow', () => {
    observeTournamentRequest(1_000, 1_100, undefined);
    observeTournamentRequest(1_000, 1_100, 'garbage');
    observeTournamentPush(undefined);
    expect(hasTournamentServerClock()).toBe(false);
  });
});
