/**
 * M2 (Phase 2D): a Live Event's registration opens 12 hours before its start
 * and closes 2 minutes before. The lifecycle is driven by the stored
 * timestamps, so the real scheduler tick → engine.openRegistration →
 * persistence.openRegistrationIfDue (PATCH …&status=eq.upcoming
 * &registration_open_at=lte.now) opens it 12 h early and closes it at T−2 min,
 * with no 30-minute assumption anywhere. Only supabaseFetch is replaced: it
 * serves one tournament row and applies the conditional writes as PostgREST
 * would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  row: null as null | Record<string, unknown>,
  calls: [] as string[],
}));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('./recovery', () => ({ recoverTournamentMatches: vi.fn(async () => ({ readyRecovered: 0, inProgressRecovered: 0 })) }));
vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    db.calls.push(`${method} ${path.split('?')[0]}`);
    const row = db.row!;
    const param = (name: string) => decodeURIComponent(new URL(`http://x${path}`).searchParams.get(name) ?? '');
    if (path.startsWith('/rest/v1/rpc/ensure_tournament_seed_window')) return 0;
    if (path.startsWith('/rest/v1/rpc/cancel_tournament_if_no_entrants')) {
      const ok = (row.status === 'upcoming' || row.status === 'registration_open') && Date.now() >= Date.parse(String(row.registration_close_at));
      if (ok) Object.assign(row, { status: 'cancelled', cancel_reason: 'not_enough_players' });
      return { cancelled: ok };
    }
    if (path.startsWith('/rest/v1/scheduled_tournaments?') && method === 'PATCH') {
      // openRegistrationIfDue: id=eq.X & status=eq.upcoming & registration_open_at=lte.<now>
      const due = param('registration_open_at').replace(/^lte\./, '');
      const matches = param('id') === `eq.${row.id}` && param('status') === `eq.${row.status}` &&
        Date.parse(String(row.registration_open_at)) <= Date.parse(due);
      if (!matches) return [];
      Object.assign(row, JSON.parse(init!.body!));
      return [{ id: row.id }];
    }
    if (path.startsWith('/rest/v1/scheduled_tournaments?select=id,status,registration_open_at,registration_close_at')) {
      // fetchDueLifecycleTournaments: upcoming whose registration_open_at <= now, or registration_open.
      const now = Date.parse(decodeURIComponent(path.match(/registration_open_at\.lte\.([^),]+)/)![1]));
      const due = (row.status === 'upcoming' && Date.parse(String(row.registration_open_at)) <= now) || row.status === 'registration_open';
      return due ? [row] : [];
    }
    if (path.startsWith('/rest/v1/scheduled_tournament_registrations')) return [];
    if (path.startsWith('/rest/v1/scheduled_tournaments?') && param('id') === `eq.${row.id}`) return [row];
    return [];
  }),
}));

import { ownedLease } from './orchestratorLease.testkit';
import { runOrchestrationTick, startTournamentScheduler, stopTournamentScheduler, whenOrchestrationIdle } from './scheduler';

// 2026-11-01 17:00 PST (the day Pacific time falls back), as M2 seeds it.
const START = Date.parse('2026-11-02T01:00:00.000Z');
const OPEN = START - 12 * 60 * 60_000;   // 2026-11-01 05:00 PST
const CLOSE = START - 2 * 60_000;        // 16:58 PST
const io = { emit: vi.fn() } as any;

async function tickAt(ms: number) {
  vi.setSystemTime(ms);
  await whenOrchestrationIdle();
  await runOrchestrationTick();
  await whenOrchestrationIdle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(OPEN - 60 * 60_000);
  vi.clearAllMocks();
  db.calls = [];
  db.row = {
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'live',
    owner_user_id: null,
    scheduled_start: new Date(START).toISOString(),
    registration_open_at: new Date(OPEN).toISOString(),
    registration_close_at: new Date(CLOSE).toISOString(),
    status: 'upcoming',
    format: '7-tile',
    win_target: 30,
    max_players: 8,
    winner_id: null,
  };
});
afterEach(() => {
  stopTournamentScheduler();
  vi.useRealTimers();
});

describe('M2: a 12-hour registration window through the real lifecycle tick', () => {
  it('stays upcoming until 12 h before, opens then, stays open for 12 h, closes at T−2 min', async () => {
    startTournamentScheduler(io, { lease: ownedLease() });
    await whenOrchestrationIdle();

    await tickAt(OPEN - 60_000);                       // 04:59 PST
    expect(db.row!.status).toBe('upcoming');
    expect(db.calls.filter((c) => c.startsWith('PATCH'))).toHaveLength(0);

    await tickAt(OPEN + 1_000);                        // 05:00:01 PST — 11 h 59 m before start
    expect(db.row!.status).toBe('registration_open');
    expect(io.emit).toHaveBeenCalledWith('tournament:registration_open', { tournamentId: db.row!.id, kind: 'live', serverNow: expect.any(String) });

    for (const ms of [OPEN + 60 * 60_000, START - 30 * 60_000, START - 3 * 60_000]) {
      await tickAt(ms);                                // hours later, 30 min, 3 min before: still open
      expect(db.row!.status).toBe('registration_open');
    }
    expect(db.calls.some((c) => c.includes('cancel_tournament_if_no_entrants'))).toBe(false);

    await tickAt(CLOSE);                               // 16:58 PST: closes (nobody registered → cancelled)
    expect(db.calls.some((c) => c.includes('cancel_tournament_if_no_entrants'))).toBe(true);
    expect(db.row!.status).toBe('cancelled');
  });

  it('a normalized row whose new open time has already passed is opened by the next ordinary tick', async () => {
    // M2 leaves such a row `upcoming`; nothing else is needed.
    vi.setSystemTime(START - 7 * 60 * 60_000);         // 10:00 PST: 5 h after its new open time
    startTournamentScheduler(io, { lease: ownedLease() });
    await whenOrchestrationIdle();
    expect(db.row!.status).toBe('registration_open');
    expect(db.calls.filter((c) => c.startsWith('PATCH'))).toHaveLength(1);
  });
});
