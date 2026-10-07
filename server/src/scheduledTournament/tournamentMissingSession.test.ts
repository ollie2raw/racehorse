/**
 * Lost live session at the match cap (Phase 1.1 §3): an in-progress match
 * whose live game is gone even after a restore attempt is still decided (by
 * seed, scores 0–0 as recorded), but under its own status_reason
 * `match_cap_missing_session_higher_seed`, never as a tied score, and with a
 * rate-limited alert naming the tournament, match and room. A room stuck in the
 * pre-game draw is labelled `match_cap_pregame_higher_seed` likewise. A
 * session that restores is not an incident.
 *
 * Real and faked pieces as in tournamentMatchCap.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({ liveSessions: new Map<string, Record<string, unknown>>() }));

vi.mock('@sentry/node', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));
vi.mock('../social/activityWriter', () => ({
  writeTournamentActivity: vi.fn().mockResolvedValue(undefined),
  writeMatchActivity: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../supabaseUtils', () => ({
  isSupabaseTimeoutError: () => false,
  supabaseFetch: vi.fn(async (path: string, init?: { method?: string; body?: string }) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path.startsWith('/rest/v1/room_live_sessions')) {
      if (method === 'POST') {
        for (const row of JSON.parse(init!.body!) as Array<Record<string, unknown>>) {
          h.liveSessions.set(String(row.room_code), structuredClone(row));
        }
        return [];
      }
      const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)![1]);
      if (method === 'DELETE') {
        h.liveSessions.delete(code);
        return [];
      }
      const row = h.liveSessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    return [];
  }),
}));

import {
  createReservedRoom,
  getRoom,
  initiatePregameDrawOrStartUnlocked,
  joinRoom,
  peekRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
  startGameUnlocked,
} from '../rooms';
import { getRoomRoster, initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from '../multiplayer/roomSession';
import { persistLiveRoomSessionNow, resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import { getArmedTournamentTurn, resetTournamentTurnClockForTests } from '../multiplayer/tournamentTurnClock';
import { seatSyntheticBotInRoom } from '../multiplayer/botSeating';
import { reconcileExpiredReadyMatches } from './engine';
import { alertTournamentAnomaly, resetAlertThrottleForTests } from './tournamentAlerts';
import { inMemoryMatchRpcForArrayStore } from './inMemoryMatchRpc.testkit';
import type { EnginePersistence } from './persistenceInterface';
import { restoreOrCreateTournamentRoom } from './tournamentRoomRestore';
import { TOURNAMENT_MATCH_CAP_MS_DEFAULT } from './tournamentTimeouts';

const T = '3f000000-0000-4000-8000-000000000001';
const U1 = '3f000000-0000-4000-8000-0000000000a1';
const U2 = '3f000000-0000-4000-8000-0000000000a2';
const BOT = `bot:fritz:${T}:8`;
const CAP = TOURNAMENT_MATCH_CAP_MS_DEFAULT;

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: () => ({ emit: vi.fn() }),
    emit: vi.fn(),
  } as any;
}

function initSession() {
  initRoomSession(makeIo(), {
    resolveSocketIdentity: async () => ({ username: 'Player', userId: null }),
    normalizeUsername: (value: unknown) => (typeof value === 'string' ? value : 'Guest'),
    normalizeUserId: (value: unknown) => (typeof value === 'string' ? value : null),
    tryHydrateMatchmakingRoomShell: async () => 'skipped',
    waitUntilMatchmakingRoomSocketsReady: async () => undefined,
    onAfterMatchStarted: async () => undefined,
    notifyRoomPlayersInGame: () => undefined,
    maybeFinalizeTournamentMatch: () => undefined,
    persistRoomMatchLog: async () => undefined,
    onGameOver: () => null,
    finalizeTournamentMatch: () => undefined,
  } as any);
}

/** Everything a process restart loses. */
function restart() {
  resetTournamentTurnClockForTests();
  resetLiveRoomPersistenceForTests();
  resetLiveRoomPersistHookForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  initSession();
}

function matchRow(id: string, round: number, matchNumber: number, roomCode: string, p1: string | null, p2: string | null, partial: Row = {}): Row {
  return {
    id, tournament_id: T, round, match_number: matchNumber, player1_id: p1, player2_id: p2,
    winner_id: null, room_code: roomCode, status: 'waiting', ready_at: null, ready_deadline_at: null,
    started_at: null, completed_at: null, player1_joined_at: null, player2_joined_at: null,
    winner_source: null, status_reason: null, forfeit_user_id: null, no_show_user_id: null,
    bot_tier: null, player1_score: null, player2_score: null, ...partial,
  };
}

type Store = { tournament: Row; matches: Row[]; regs: Row[] };

function makePersistence(store: Store): EnginePersistence {
  const rpc = () => inMemoryMatchRpcForArrayStore(store as any);
  return {
    fetchTournamentById: async (id: string) => (id === T ? structuredClone(store.tournament) : null),
    fetchTournamentsByStatus: async () => [structuredClone(store.tournament)],
    fetchMatches: async () => structuredClone(store.matches),
    fetchMatchById: async (id: string) => structuredClone(store.matches.find((m) => m.id === id) ?? null),
    fetchMatchByRoomCode: async (code: string) => structuredClone(store.matches.find((m) => m.room_code === code) ?? null),
    fetchRegistrations: async () => structuredClone(store.regs),
    fetchRegistrationsWithProfile: async () => [],
    updateMatch: async (id: string, patch: Row) => { Object.assign(store.matches.find((m) => m.id === id)!, patch); },
    completeTournamentMatch: (params: any) => rpc().completeTournamentMatch(params),
    promoteTournamentMatch: (...args: any[]) => (rpc().promoteTournamentMatch as any)(...args),
    generateTournamentBracket: async () => { throw new Error('not expected'); },
    updateRegistrationPlacement: async () => {},
    updateTournamentStatus: async () => {},
    createReservedRoom,
    getRoom,
    restoreOrCreateRoom: restoreOrCreateTournamentRoom,
  } as unknown as EnginePersistence;
}

let seq = 0;

/**
 * A match in progress whose game was started `ageMs` ago (by `started_at`),
 * seats joined in `joinOrder`, live scores set per player. `seeds` gives each
 * human's tournament seed. With `final`, the match is the final of a bracket
 * whose other rows are done.
 */
async function seed(opts: {
  p1?: string; p2?: string; joinOrder?: string[]; scores: Record<string, number>;
  seeds?: Record<string, number>; ageMs?: number; final?: boolean;
}): Promise<{ store: Store; roomCode: string; matchId: string; persistence: EnginePersistence }> {
  seq += 1;
  const p1 = opts.p1 ?? U1;
  const p2 = opts.p2 ?? U2;
  const round = opts.final ? 3 : 1;
  const roomCode = `T3F00${(0x10 + seq).toString(16).toUpperCase()}R${round}M1`;
  const matchId = `cap-${seq}`;
  const nowMs = Date.now();
  const startedAt = new Date(nowMs - (opts.ageMs ?? CAP + 60_000)).toISOString();
  const seeds = opts.seeds ?? { [U1]: 1, [U2]: 2 };
  const store: Store = {
    tournament: {
      id: T, scheduled_start: new Date(nowMs - 30 * 60_000).toISOString(), registration_open_at: '', registration_close_at: '',
      status: 'in_progress', format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: '',
    },
    matches: [],
    regs: [U1, U2].map((u) => ({ id: `r-${u}`, tournament_id: T, user_id: u, registered_at: '', seed: seeds[u] ?? null, placement: null, status: 'active' })),
  };
  if (opts.final) {
    const done = { status: 'completed', completed_at: startedAt };
    store.matches.push(
      matchRow('qf1', 1, 1, '', U1, `bot:fritz:${T}:7`, { ...done, winner_id: U1 }),
      matchRow('qf2', 1, 2, '', `bot:fritz:${T}:4`, `bot:fritz:${T}:5`, { ...done, winner_id: `bot:fritz:${T}:4` }),
      matchRow('qf3', 1, 3, '', U2, `bot:fritz:${T}:6`, { ...done, winner_id: U2 }),
      matchRow('qf4', 1, 4, '', `bot:fritz:${T}:2`, `bot:fritz:${T}:3`, { ...done, winner_id: `bot:fritz:${T}:2` }),
      matchRow('sf1', 2, 1, '', U1, `bot:fritz:${T}:4`, { ...done, winner_id: U1 }),
      matchRow('sf2', 2, 2, '', U2, `bot:fritz:${T}:2`, { ...done, winner_id: U2 }),
    );
  } else {
    store.matches.push(matchRow('sf1', 2, 1, '', null, null));
  }
  store.matches.push(matchRow(matchId, round, 1, roomCode, p1, p2, {
    status: 'in_progress', started_at: startedAt, ready_at: startedAt, player1_joined_at: startedAt,
    player2_joined_at: p2 === BOT ? null : startedAt, bot_tier: p2 === BOT ? 'standard' : null,
  }));

  const room = createReservedRoom(roomCode, { winningScore: 30 });
  room.scheduledTournamentMatchId = matchId;
  room.scheduledTournamentId = T;
  const seatOf: Record<string, string> = {};
  for (const player of opts.joinOrder ?? [p1, p2]) {
    if (player === BOT) {
      seatSyntheticBotInRoom(roomCode, BOT, 'Fritz');
      seatOf[BOT] = BOT;
    } else {
      seatOf[player] = `seat-${player.slice(-2)}`;
      joinRoom(roomCode, seatOf[player]);
      setRoomRoster(roomCode, [...getRoomRoster(roomCode), { id: seatOf[player], socketId: '', username: player.slice(-2), userId: player }]);
    }
  }
  await startGameUnlocked(roomCode, makeIo());
  const live = getRoom(roomCode);
  live.state = {
    ...live.state!,
    players: Object.fromEntries(Object.entries(live.state!.players).map(([seat, ps]) => {
      const player = Object.keys(seatOf).find((p) => seatOf[p] === seat)!;
      return [seat, { ...ps, score: opts.scores[player] ?? 0 }];
    })),
  };
  return { store, roomCode, matchId, persistence: makePersistence(store) };
}

const tick = (persistence: EnginePersistence, store: Store) =>
  reconcileExpiredReadyMatches(makeIo(), new Date(), persistence, [structuredClone(store.tournament) as any]);

const anomalyAlerts = (kind: string) =>
  vi.mocked(Sentry.captureMessage).mock.calls.filter(([message]) => message === `[tournament] ${kind}`);

beforeEach(() => {
  h.liveSessions.clear();
  vi.mocked(Sentry.captureMessage).mockClear();
  resetAlertThrottleForTests();
  restart();
});
afterEach(() => {
  restart();
});

describe('match cap: lost live session', () => {
  it('a live game lost with no stored session is decided by seed under its own reason, and alerted', async () => {
    const { store, roomCode, matchId, persistence } = await seed({ scores: { [U1]: 9, [U2]: 24 }, seeds: { [U1]: 4, [U2]: 3 } });
    // The process restarted and the stored session is gone too.
    restart();
    h.liveSessions.delete(roomCode);

    expect(await tick(persistence, store)).toBe(1);

    expect(store.matches.find((m) => m.id === matchId)).toMatchObject({
      status: 'completed', winner_id: U2, winner_source: 'game_over',
      status_reason: 'match_cap_missing_session_higher_seed', player1_score: 0, player2_score: 0,
    });
    const alerts = anomalyAlerts('missing_live_session');
    expect(alerts).toHaveLength(1);
    expect(alerts[0][1]).toMatchObject({
      tags: { tournament_alert: 'missing_live_session', tournament_id: T, match_id: matchId, room_code: roomCode },
    });
    // The fresh room the restore attempt created is closed, not left to start a new game.
    expect(getRoom(roomCode).abandonedAt).toBeTruthy();
  });

  it('a session that restores is decided by its live score and is not an incident', async () => {
    const { store, roomCode, matchId, persistence } = await seed({ scores: { [U1]: 22, [U2]: 7 } });
    const roster = getRoomRoster(roomCode).map((p) => ({ seatId: p.id, userId: p.userId, username: p.username }));
    expect(await persistLiveRoomSessionNow(getRoom(roomCode), roster)).toBe(true);
    restart();

    await tick(persistence, store);

    expect(store.matches.find((m) => m.id === matchId)?.status_reason).toBe('match_cap_higher_score');
    expect(anomalyAlerts('missing_live_session')).toHaveLength(0);
  });

  it('a room still in the pre-game draw at the cap is decided by seed under its own reason, and alerted', async () => {
    const { store, roomCode, matchId, persistence } = await seed({ p2: BOT, joinOrder: [BOT, U1], scores: {} });
    const room = getRoom(roomCode);
    room.state = null;
    await initiatePregameDrawOrStartUnlocked(roomCode, makeIo());
    expect(room.preGameDraw).toBeTruthy();

    await tick(persistence, store);

    expect(store.matches.find((m) => m.id === matchId)).toMatchObject({
      status: 'completed', winner_id: U1, status_reason: 'match_cap_pregame_higher_seed',
    });
    expect(anomalyAlerts('pregame_never_completed')).toHaveLength(1);
    expect(anomalyAlerts('missing_live_session')).toHaveLength(0);
  });

  it('the anomaly alert is rate-limited per match (logged every time)', () => {
    const subject = { tournamentId: T, matchId: 'm-x', roomCode: 'ROOMX' };
    alertTournamentAnomaly('missing_live_session', subject);
    alertTournamentAnomaly('missing_live_session', subject);
    alertTournamentAnomaly('missing_live_session', { ...subject, matchId: 'm-y' });

    expect(anomalyAlerts('missing_live_session')).toHaveLength(2);
  });
});
