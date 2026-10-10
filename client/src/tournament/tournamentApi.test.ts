import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
}));
vi.mock('../api/client', () => http);

import * as api from './tournamentApi';
import { TournamentApiError } from './tournamentApi';
import { estimatedServerNowMs, hasTournamentServerClock, resetTournamentClockForTests } from './tournamentClock';

const NOW = '2026-10-31T00:00:00.000Z';
const ok = <T,>(data: T) => ({ data, error: null, status: 200 });
const fail = (status: number | undefined, body?: Record<string, unknown>) => ({
  data: null,
  error: typeof body?.error === 'string' ? body.error : 'Network error',
  ...(body ? { errorData: body } : {}),
  ...(status !== undefined ? { status } : {}),
});

let mono = 0;
beforeEach(() => {
  mono = 5_000;
  resetTournamentClockForTests(() => mono);
  for (const fn of Object.values(http)) fn.mockReset();
});

async function caught(p: Promise<unknown>): Promise<TournamentApiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(TournamentApiError);
    return err as TournamentApiError;
  }
  throw new Error('expected a TournamentApiError');
}

describe('tournament API: structured errors and the server clock', () => {
  it('overlap keeps status, code and the conflicting tournament', async () => {
    http.apiPost.mockResolvedValue(fail(409, {
      ok: false, error: 'overlapping_tournament', serverNow: NOW,
      conflict: { tournamentId: 't-9', kind: 'fritz_cup', scheduledStart: '2026-10-31T01:00:00.000Z' },
    }));
    const err = await caught(api.registerForTournament('t-1'));
    expect(err).toMatchObject({
      code: 'overlapping_tournament', message: 'overlapping_tournament', status: 409, serverNow: NOW,
      conflict: { tournamentId: 't-9', kind: 'fritz_cup', scheduledStart: '2026-10-31T01:00:00.000Z' },
    });
  });

  it('cooldown and rate limit keep retryAfterMs and reason', async () => {
    http.apiPost.mockResolvedValueOnce(fail(429, { ok: false, error: 'fritz_cup_cooldown', retryAfterMs: 41_235, reason: 'cooldown', serverNow: NOW }));
    expect(await caught(api.startFritzCup())).toMatchObject({ code: 'fritz_cup_cooldown', status: 429, retryAfterMs: 41_235, reason: 'cooldown' });
    http.apiPost.mockResolvedValueOnce(fail(429, { ok: false, error: 'fritz_cup_cooldown', retryAfterMs: 3_600_000, reason: 'daily_limit', serverNow: NOW }));
    expect(await caught(api.startFritzCup())).toMatchObject({ reason: 'daily_limit' });
    http.apiPost.mockResolvedValueOnce(fail(429, { ok: false, error: 'rate_limited', retryAfterMs: 9_000, serverNow: NOW }));
    expect(await caught(api.startFritzCup())).toMatchObject({ code: 'rate_limited', retryAfterMs: 9_000 });
  });

  it('never surfaces raw backend text: odd error strings, network failures and auth become stable codes', async () => {
    http.apiGet.mockResolvedValueOnce(fail(500, { error: 'relation "x" does not exist' }));
    expect((await caught(api.fetchMy())).code).toBe('internal');
    http.apiGet.mockResolvedValueOnce(fail(undefined));
    expect((await caught(api.fetchMy())).code).toBe('network');
    http.apiGet.mockResolvedValueOnce({ data: null, error: 'Sign in to continue.', errorCode: 'auth_required', status: 401 });
    expect((await caught(api.fetchMy())).code).toBe('not_authenticated');
    http.apiDelete.mockResolvedValueOnce(fail(409, { ok: false, error: 'withdraw_closed', serverNow: NOW }));
    expect((await caught(api.withdrawFromTournament('t-1'))).code).toBe('withdraw_closed');
  });

  it('success and error bodies both feed the clock from the request round trip', async () => {
    http.apiGet.mockImplementationOnce(async () => { mono = 5_200; return ok({ ok: true, tournaments: [], features: { tournaments: true, fritzCup: true }, serverNow: NOW }); });
    const up = await api.fetchUpcoming();
    expect(up.features).toEqual({ tournaments: true, fritzCup: true });
    expect(hasTournamentServerClock()).toBe(true);
    expect(estimatedServerNowMs()).toBe(Date.parse(NOW) + 100);

    resetTournamentClockForTests(() => mono);
    http.apiPost.mockImplementationOnce(async () => { mono = 5_300; return fail(409, { ok: false, error: 'tournament_full', serverNow: NOW }); });
    mono = 5_200;
    await caught(api.registerForTournament('t-1'));
    expect(estimatedServerNowMs()).toBe(Date.parse(NOW) + 50);
  });

  it('/my returns tournaments, the playable match and features; a pre-3B body degrades safely', async () => {
    http.apiGet.mockResolvedValueOnce(ok({
      ok: true, registrations: [], serverNow: NOW,
      tournaments: [{ id: 'c', kind: 'fritz_cup' }],
      activeAssignedMatch: { matchId: 'm', tournamentId: 'c', matchStatus: 'ready' },
      features: { tournaments: true, fritzCup: false },
    }));
    const my = await api.fetchMy();
    expect(my).toMatchObject({ tournaments: [{ id: 'c' }], activeAssignedMatch: { matchId: 'm' }, features: { tournaments: true, fritzCup: false } });

    http.apiGet.mockResolvedValueOnce(ok({ ok: true, registrations: [] }));
    expect(await api.fetchMy()).toEqual({ registrations: [], tournaments: [], activeAssignedMatch: null, features: { tournaments: true, fritzCup: false } });
    http.apiGet.mockResolvedValueOnce(ok({ ok: true, disabled: true, tournaments: [] }));
    expect((await api.fetchUpcoming()).features).toEqual({ tournaments: false, fritzCup: false });
  });

  it('register reports alreadyRegistered as success', async () => {
    http.apiPost.mockResolvedValueOnce(ok({ ok: true, alreadyRegistered: true, serverNow: NOW }));
    expect(await api.registerForTournament('t-1')).toEqual({ alreadyRegistered: true });
    http.apiPost.mockResolvedValueOnce(ok({ ok: true, serverNow: NOW }));
    expect(await api.registerForTournament('t-1')).toEqual({ alreadyRegistered: false });
  });
});
