/**
 * Exact terminal-result recovery across crashes (Phase 1.3). A tournament game
 * that really finished must be recorded with its real result, promptly (boot
 * recovery or the next reconcile tick, never only at the cap), from whatever
 * persisted copy survives:
 *
 *   game over → live session written `game_over` (the commit) → tournament
 *   result (game-over persist) … room cleanup: room_match_logs archive, then
 *   the live session deleted, then the room dropped from memory.
 *
 * Each case stops the process (restart()) at one boundary of that sequence.
 * Real: rooms, roster, the live-session writer/loader, the room_match_logs
 * archiver (persistRoomMatchLog → finalizeAndDeleteLiveRoomSession), boot
 * recovery, the reconcile tick, the finalizer, the in-memory port of
 * complete_tournament_match. Faked: `supabaseFetch` (in-memory
 * room_live_sessions and room_match_logs tables).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/node';

type Row = Record<string, any>;
const h = vi.hoisted(() => ({
  liveSessions: new Map<string, Record<string, unknown>>(),
  matchLogs: [] as Array<Record<string, any>>,
}));

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
    if (path.startsWith('/rest/v1/room_match_logs')) {
      if (method === 'POST') {
        for (const row of JSON.parse(init!.body!) as Array<Record<string, any>>) {
          h.matchLogs = h.matchLogs.filter((r) => r.match_id !== row.match_id);
          h.matchLogs.push(structuredClone(row));
        }
        return [];
      }
      const code = decodeURIComponent(/room_code=eq\.([^&]+)/.exec(path)?.[1] ?? '');
      return h.matchLogs
        .filter((r) => r.room_code === code)
        .sort((a, b) => Date.parse(b.archived_at) - Date.parse(a.archived_at))
        .slice(0, Number(/limit=(\d+)/.exec(path)?.[1] ?? 1))
        .map((r) => structuredClone(r));
    }
    return [];
  }),
}));

import {
  createReservedRoom,
  getRoom,
  joinRoom,
  peekRoom,
  resetLiveRoomPersistHookForTests,
  resetRoomRuntimeForTests,
  startGameUnlocked,
} from '../rooms';
import { getRoomRoster, initRoomSession, resetRoomSessionStoresForTests, setRoomRoster } from '../multiplayer/roomSession';
import { persistLiveRoomSessionNow, resetLiveRoomPersistenceForTests } from '../multiplayer/roomLivePersistence';
import { persistRoomMatchLog, resetRoomMatchLogPersistenceForTests } from '../multiplayer/roomMatchLogPersistence';
import { resetTournamentTurnClockForTests } from '../multiplayer/tournamentTurnClock';
import { seatSyntheticBotInRoom } from '../multiplayer/botSeating';
import { reconcileExpiredReadyMatches } from './engine';
import { recoverTournamentMatches } from './recovery';
import { resetAlertThrottleForTests } from './tournamentAlerts';
import { inMemoryMatchRpcForArrayStore } from './inMemoryMatchRpc.testkit';
import type { EnginePersistence } from './persistenceInterface';
import { restoreOrCreateTournamentRoom } from './tournamentRoomRestore';
import { TOURNAMENT_MATCH_CAP_MS_DEFAULT } from './tournamentTimeouts';

const T = '3e000000-0000-4000-8000-000000000001';
const U1 = '3e000000-0000-4000-8000-0000000000a1';
const U2 = '3e000000-0000-4000-8000-0000000000a2';
const U3 = '3e000000-0000-4000-8000-0000000000a3';
const BOT = `bot:fritz:${T}:8`;
const CAP = TOURNAMENT_MATCH_CAP_MS_DEFAULT;
/** Well under the cap: recovery must not wait for it. */
const AGE = 6 * 60_000;

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
  resetRoomMatchLogPersistenceForTests();
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

function makePersistence(store: Store): EnginePersistence & { applied: () => number } {
  const rpc = () => inMemoryMatchRpcForArrayStore(store as any);
  let applied = 0;
  return {
    applied: () => applied,
    fetchTournamentById: async (id: string) => (id === T ? structuredClone(store.tournament) : null),
    fetchTournamentsByStatus: async () => [structuredClone(store.tournament)],
    fetchMatches: async () => structuredClone(store.matches),
    fetchMatchById: async (id: string) => structuredClone(store.matches.find((m) => m.id === id) ?? null),
    fetchMatchByRoomCode: async (code: string) => structuredClone(store.matches.find((m) => m.room_code === code) ?? null),
    fetchRegistrations: async () => structuredClone(store.regs),
    fetchRegistrationsWithProfile: async () => [],
    updateMatch: async (id: string, patch: Row) => { Object.assign(store.matches.find((m) => m.id === id)!, patch); },
    completeTournamentMatch: async (params: any) => {
      const result = await rpc().completeTournamentMatch(params);
      if (result.applied) applied += 1;
      return result;
    },
    promoteTournamentMatch: (...args: any[]) => (rpc().promoteTournamentMatch as any)(...args),
    generateTournamentBracket: async () => { throw new Error('not expected'); },
    updateRegistrationPlacement: async () => {},
    updateTournamentStatus: async () => {},
    createReservedRoom,
    getRoom,
    restoreOrCreateRoom: restoreOrCreateTournamentRoom,
  } as unknown as EnginePersistence & { applied: () => number };
}

let seq = 0;
const seatIdOf = (player: string) => (player.startsWith('bot:') ? player : `seat-${player.slice(-2)}`);

type Seeded = { store: Store; roomCode: string; matchId: string; persistence: ReturnType<typeof makePersistence> };

/**
 * A semifinal in progress (started AGE ago) whose room game is live in
 * memory, seated in `joinOrder`, with the live session written. With
 * `winner`, the game then ends (scores as given) and the game-over commit's
 * live-session write happens — but no tournament result is recorded.
 */
async function seed(opts: {
  p1?: string; p2?: string; joinOrder?: string[]; scores: Record<string, number>; winner?: string;
  seeds?: Record<string, number>; final?: boolean;
}): Promise<Seeded> {
  seq += 1;
  const p1 = opts.p1 ?? U1;
  const p2 = opts.p2 ?? U2;
  const round = opts.final ? 3 : 1;
  const roomCode = `T3E00${(0x10 + seq).toString(16).toUpperCase()}R${round}M1`;
  const matchId = `crash-${seq}`;
  const nowMs = Date.now();
  const startedAt = new Date(nowMs - AGE).toISOString();
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
    player2_joined_at: p2 === BOT ? null : startedAt, bot_tier: p2 === BOT || p1 === BOT ? 'standard' : null,
  }));

  const room = createReservedRoom(roomCode, { winningScore: 30 });
  room.scheduledTournamentMatchId = matchId;
  room.scheduledTournamentId = T;
  for (const player of opts.joinOrder ?? [p1, p2]) {
    if (player === BOT) {
      seatSyntheticBotInRoom(roomCode, BOT, 'Fritz');
    } else {
      joinRoom(roomCode, seatIdOf(player));
      setRoomRoster(roomCode, [...getRoomRoster(roomCode), { id: seatIdOf(player), socketId: '', username: player.slice(-2), userId: player }]);
    }
  }
  await startGameUnlocked(roomCode, makeIo());
  const live = getRoom(roomCode);
  live.state = {
    ...live.state!,
    players: Object.fromEntries(Object.entries(live.state!.players).map(([seat, ps]) => {
      const player = [p1, p2].find((p) => seatIdOf(p) === seat)!;
      return [seat, { ...ps, score: opts.scores[player] ?? 0 }];
    })),
  };
  if (opts.winner) {
    live.state = { ...live.state!, gameOver: true, handOver: true, winnerId: seatIdOf(opts.winner) };
  }
  expect(await persistLiveRoomSessionNow(live, rosterOf(roomCode))).toBe(true);
  return { store, roomCode, matchId, persistence: makePersistence(store) };
}

const rosterOf = (roomCode: string) =>
  getRoomRoster(roomCode).map((p) => ({ seatId: p.id, userId: p.userId, username: p.username }));

const tick = (s: Seeded) =>
  reconcileExpiredReadyMatches(makeIo(), new Date(), s.persistence, [structuredClone(s.store.tournament) as any]);
const boot = (s: Seeded) => recoverTournamentMatches(makeIo(), s.persistence);
const matchOf = (s: Seeded) => s.store.matches.find((m) => m.id === s.matchId)!;

/** Room cleanup as scheduleRoomCleanup runs it: archive, terminal live row, delete. */
async function cleanup(roomCode: string) {
  await persistRoomMatchLog(getRoom(roomCode), 'completed');
}

const anomalyAlerts = (kind: string) =>
  vi.mocked(Sentry.captureMessage).mock.calls.filter(([message]) => message === `[tournament] ${kind}`).length;

beforeEach(() => {
  h.liveSessions.clear();
  h.matchLogs = [];
  vi.mocked(Sentry.captureMessage).mockClear();
  resetAlertThrottleForTests();
  restart();
});
afterEach(() => { restart(); });

describe('a finished tournament game is recovered exactly, across crashes', () => {
  it('case 1: terminal live session written, result never recorded, process dies → boot recovery records the real result once', async () => {
    const s = await seed({ scores: { [U1]: 31, [U2]: 12 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    expect(h.liveSessions.get(s.roomCode)).toMatchObject({ status: 'game_over' });
    restart();

    await boot(s);

    expect(matchOf(s)).toMatchObject({
      status: 'completed', winner_id: U1, winner_source: 'game_over', status_reason: null, player1_score: 31, player2_score: 12,
    });
    expect(s.store.matches.find((m) => m.id === 'sf1')?.player1_id).toBe(U1);
    expect(s.persistence.applied()).toBe(1);
    // Not resurrected: no room was restored or created for the finished game.
    expect(peekRoom(s.roomCode)).toBeUndefined();
    // Later ticks and another boot are no-ops.
    expect(await tick(s)).toBe(0);
    await boot(s);
    expect(s.persistence.applied()).toBe(1);
  });

  it('case 1 (no boot pass): the next ordinary reconcile tick records it, far under the cap', async () => {
    const s = await seed({ scores: { [U1]: 9, [U2]: 30 }, winner: U2 });
    restart();
    expect(Date.now() - Date.parse(matchOf(s).started_at)).toBeLessThan(CAP);

    expect(await tick(s)).toBe(1);

    expect(matchOf(s)).toMatchObject({ status: 'completed', winner_id: U2, player1_score: 9, player2_score: 30 });
    expect(await tick(s)).toBe(0);
    expect(s.persistence.applied()).toBe(1);
  });

  it('case 2: archived and live session deleted (room cleanup ran), still in_progress → the real result comes from the archive, not seed', async () => {
    // U2 is the higher seed; U1 actually won.
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    await cleanup(s.roomCode);
    expect(h.liveSessions.has(s.roomCode)).toBe(false);
    expect(h.matchLogs).toHaveLength(1);
    restart();

    expect(await tick(s)).toBe(1);

    expect(matchOf(s)).toMatchObject({
      status: 'completed', winner_id: U1, winner_source: 'game_over', status_reason: null, player1_score: 30, player2_score: 25,
    });
    expect(anomalyAlerts('missing_live_session')).toBe(0);
    expect(s.persistence.applied()).toBe(1);
  });

  it('case 2: the same, without a restart (cleanup dropped the room while the result was still unrecorded)', async () => {
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1 });
    getRoom(s.roomCode).gameOverPersistStatus = 'failed';
    await cleanup(s.roomCode);
    resetRoomRuntimeForTests(); // scheduleRoomCleanup's deleteRoom

    await boot(s);

    expect(matchOf(s)).toMatchObject({ status: 'completed', winner_id: U1, player1_score: 30, player2_score: 25 });
  });

  it('case 2: an archive that is not this match\'s game (same slot code, other players) is never used; at the cap the loss is alerted and decided by seed', async () => {
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    await cleanup(s.roomCode);
    // The only archive under this room code is another tournament's game between other players
    // (a legacy archive, written before archives recorded their tournament match id).
    h.matchLogs = h.matchLogs.map((r) => ({
      ...r,
      summary: { ...r.summary, scheduledTournamentMatchId: undefined },
      participants: r.participants.map((p: Row) => (p.userId === U2 ? { ...p, userId: U3 } : p)),
      participant_user_ids: [U1, U3],
    }));
    restart();

    expect(await tick(s)).toBe(0);
    expect(matchOf(s).status).toBe('in_progress');

    matchOf(s).started_at = new Date(Date.now() - CAP - 60_000).toISOString();
    expect(await tick(s)).toBe(1);

    expect(matchOf(s)).toMatchObject({ status: 'completed', winner_id: U2, status_reason: 'match_cap_missing_session_higher_seed' });
    expect(anomalyAlerts('missing_live_session')).toBe(1);
  });

  it('case 3: result recorded, process dies before room cleanup → no duplicate result; cleanup can still run afterwards', async () => {
    const s = await seed({ scores: { [U1]: 31, [U2]: 12 }, winner: U1 });
    expect(await tick(s)).toBe(1); // the result commits (from the live room)
    restart(); // …and the process dies before cleanup

    await boot(s);
    expect(await tick(s)).toBe(0);
    expect(s.persistence.applied()).toBe(1);
    expect(peekRoom(s.roomCode)).toBeUndefined();
    expect(h.liveSessions.get(s.roomCode)).toMatchObject({ status: 'game_over' }); // left for the retention reaper

    // Variant: the result commits and cleanup does run (archive, delete) before a later restart.
    const s2 = await seed({ scores: { [U1]: 31, [U2]: 12 }, winner: U1 });
    expect(await tick(s2)).toBe(1);
    await cleanup(s2.roomCode);
    restart();
    await boot(s2);
    expect(await tick(s2)).toBe(0);
    expect(s2.persistence.applied()).toBe(1);
    expect(matchOf(s2)).toMatchObject({ status: 'completed', winner_id: U1 });
  });

  it('case 4: a Fritz win is recovered as a Fritz win (from the live session and from the archive)', async () => {
    const live = await seed({ p2: BOT, joinOrder: [BOT, U1], scores: { [U1]: 11, [BOT]: 30 }, winner: BOT });
    restart();
    await boot(live);
    expect(matchOf(live)).toMatchObject({ status: 'completed', winner_id: BOT, winner_source: 'game_over', player1_score: 11, player2_score: 30 });
    expect(live.store.regs.find((r) => r.user_id === U1)?.status).toBe('eliminated');

    const archived = await seed({ p2: BOT, joinOrder: [BOT, U1], scores: { [U1]: 14, [BOT]: 33 }, winner: BOT });
    await cleanup(archived.roomCode);
    restart();
    await tick(archived);
    expect(matchOf(archived)).toMatchObject({ status: 'completed', winner_id: BOT, player1_score: 14, player2_score: 33 });
  });

  it('case 5: seats reversed relative to the match row keep their orientation (live session and archive)', async () => {
    const live = await seed({ joinOrder: [U2, U1], scores: { [U1]: 8, [U2]: 30 }, winner: U2 });
    restart();
    await boot(live);
    expect(matchOf(live)).toMatchObject({ winner_id: U2, player1_score: 8, player2_score: 30 });

    const archived = await seed({ joinOrder: [U2, U1], final: true, scores: { [U1]: 30, [U2]: 21 }, winner: U1 });
    await cleanup(archived.roomCode);
    restart();
    await tick(archived);
    expect(matchOf(archived)).toMatchObject({ winner_id: U1, player1_score: 30, player2_score: 21 });
    // The final: tournament completed with placements.
    expect(archived.store.tournament).toMatchObject({ status: 'completed', winner_id: U1 });
    expect(archived.store.regs.find((r) => r.user_id === U1)).toMatchObject({ status: 'winner', placement: 1 });
  });

  it('case 6: a corrupt terminal state fails loudly and takes only the approved unrecoverable path, once', async () => {
    // Stored session says game_over, but its state is not a finished game.
    const s = await seed({ scores: { [U1]: 31, [U2]: 12 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    const stored = h.liveSessions.get(s.roomCode)! as Row;
    stored.game_state = { ...stored.game_state, gameOver: false };
    restart();

    await boot(s);

    expect(matchOf(s)).toMatchObject({
      status: 'completed', winner_id: U2, status_reason: 'match_cap_unrecoverable_result_higher_seed',
    });
    expect(anomalyAlerts('terminal_result_unrecoverable')).toBe(1);
    expect(await tick(s)).toBe(0);

    // An archive whose winner is not one of its seats.
    const a = await seed({ scores: { [U1]: 31, [U2]: 12 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    await cleanup(a.roomCode);
    h.matchLogs = h.matchLogs.map((r) => (r.room_code === a.roomCode ? { ...r, state_snapshot: { ...r.state_snapshot, winnerId: 'seat-zz' } } : r));
    restart();
    await tick(a);
    expect(matchOf(a)).toMatchObject({ status: 'completed', winner_id: U2, status_reason: 'match_cap_unrecoverable_result_higher_seed' });
    expect(a.persistence.applied()).toBe(1);
  });

  it('case 7: a saved game still in progress restores normally and is not recorded', async () => {
    const s = await seed({ scores: { [U1]: 20, [U2]: 10 } });
    const before = structuredClone(getRoom(s.roomCode).state!);
    restart();

    await boot(s);
    expect(await tick(s)).toBe(0);

    expect(matchOf(s)).toMatchObject({ status: 'in_progress', winner_id: null });
    const restored = peekRoom(s.roomCode)!;
    expect(restored.state).toEqual(before);
    expect(s.persistence.applied()).toBe(0);
  });
});

describe('archive identity: the exact tournament match id is authoritative (Phase 2A)', () => {
  const archiveOf = (roomCode: string) => h.matchLogs.find((r) => r.room_code === roomCode)!;
  const capTick = async (s: Seeded) => {
    matchOf(s).started_at = new Date(Date.now() - CAP - 60_000).toISOString();
    return tick(s);
  };

  it('a new archive records the exact tournament match id', async () => {
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1 });
    await cleanup(s.roomCode);
    expect(archiveOf(s.roomCode).summary).toMatchObject({ scheduledTournamentMatchId: s.matchId });
  });

  it('an archive naming this match recovers it', async () => {
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    await cleanup(s.roomCode);
    restart();

    expect(await tick(s)).toBe(1);
    expect(matchOf(s)).toMatchObject({ status: 'completed', winner_id: U1, status_reason: null, player1_score: 30, player2_score: 25 });
  });

  it('an archive naming another match is ignored; with nothing else, the cap takes the missing-session path (never "corrupt")', async () => {
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    await cleanup(s.roomCode);
    archiveOf(s.roomCode).summary.scheduledTournamentMatchId = 'some-other-match';
    archiveOf(s.roomCode).participants = archiveOf(s.roomCode).participants.map((p: Row) => (p.userId === U2 ? { ...p, userId: U3 } : p));
    restart();

    expect(await tick(s)).toBe(0);
    expect(await capTick(s)).toBe(1);
    expect(matchOf(s)).toMatchObject({ status: 'completed', winner_id: U2, status_reason: 'match_cap_missing_session_higher_seed' });
    expect(anomalyAlerts('terminal_result_unrecoverable')).toBe(0);
  });

  it('same players, same room code, archived after the start, but another explicit match id: still ignored', async () => {
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    await cleanup(s.roomCode);
    archiveOf(s.roomCode).summary.scheduledTournamentMatchId = 'some-other-match';
    restart();

    expect(await tick(s)).toBe(0);
    expect(matchOf(s).status).toBe('in_progress');
    expect(s.persistence.applied()).toBe(0);
  });

  it('a newer foreign archive under the same code does not hide this match\'s own archive', async () => {
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1 });
    await cleanup(s.roomCode);
    const own = archiveOf(s.roomCode);
    h.matchLogs.push({
      ...structuredClone(own), match_id: 'foreign-room-match', archived_at: new Date(Date.now() + 1_000).toISOString(),
      summary: { ...own.summary, scheduledTournamentMatchId: 'some-other-match' },
      state_snapshot: { ...own.state_snapshot, winnerId: seatIdOf(U2) },
    });
    restart();

    expect(await tick(s)).toBe(1);
    expect(matchOf(s)).toMatchObject({ winner_id: U1, player1_score: 30, player2_score: 25 });
  });

  it('a legacy archive (no match id) still recovers through the compatibility identity checks', async () => {
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1 });
    await cleanup(s.roomCode);
    delete archiveOf(s.roomCode).summary.scheduledTournamentMatchId;
    restart();

    expect(await tick(s)).toBe(1);
    expect(matchOf(s)).toMatchObject({ status: 'completed', winner_id: U1, status_reason: null });
  });

  it('reversed seating recovers with row-ordered scores from an id-bearing archive', async () => {
    const s = await seed({ joinOrder: [U2, U1], scores: { [U1]: 12, [U2]: 31 }, winner: U2 });
    await cleanup(s.roomCode);
    restart();

    await tick(s);
    expect(matchOf(s)).toMatchObject({ winner_id: U2, player1_score: 12, player2_score: 31 });
  });

  it('a Fritz win recovers from an id-bearing archive', async () => {
    const s = await seed({ p2: BOT, joinOrder: [BOT, U1], scores: { [U1]: 20, [BOT]: 32 }, winner: BOT });
    await cleanup(s.roomCode);
    restart();

    await tick(s);
    expect(matchOf(s)).toMatchObject({ winner_id: BOT, winner_source: 'game_over', player1_score: 20, player2_score: 32 });
  });
});

describe('a foreign live session under the room code (Phase 2A)', () => {
  const FOREIGN = 'foreign-tournament-match';
  /** Put another match's in-progress live session under this room code. */
  function plantForeignLiveSession(roomCode: string, template: Record<string, unknown>) {
    const foreign = structuredClone(template) as Row;
    foreign.scheduled_tournament_match_id = FOREIGN;
    foreign.match_id = '3e000000-0000-4000-8000-00000000f00d';
    foreign.status = 'playing';
    foreign.game_state = { ...foreign.game_state, gameOver: false, handOver: false, winnerId: null };
    h.liveSessions.set(roomCode, foreign);
    return structuredClone(foreign);
  }
  const foreignAlerts = () => anomalyAlerts('tournament_foreign_live_session');

  it('foreign live row + this match\'s archive: the archive wins', async () => {
    const s = await seed({ scores: { [U1]: 30, [U2]: 25 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    const template = structuredClone(h.liveSessions.get(s.roomCode)!);
    await cleanup(s.roomCode);
    plantForeignLiveSession(s.roomCode, template);
    restart();

    expect(await tick(s)).toBe(1);

    expect(matchOf(s)).toMatchObject({ status: 'completed', winner_id: U1, status_reason: null, player1_score: 30, player2_score: 25 });
    expect(foreignAlerts()).toBe(1);
  });

  it('foreign live row + no archive: not recorded under the cap; at the cap the missing-session path, never seeded as corrupt', async () => {
    const s = await seed({ scores: { [U1]: 20, [U2]: 10 }, seeds: { [U1]: 2, [U2]: 1 } });
    const planted = plantForeignLiveSession(s.roomCode, h.liveSessions.get(s.roomCode)!);
    restart();

    expect(await tick(s)).toBe(0);
    expect(matchOf(s).status).toBe('in_progress');

    matchOf(s).started_at = new Date(Date.now() - CAP - 60_000).toISOString();
    expect(await tick(s)).toBe(1);

    expect(matchOf(s)).toMatchObject({ status: 'completed', winner_id: U2, status_reason: 'match_cap_missing_session_higher_seed' });
    expect(anomalyAlerts('missing_live_session')).toBe(1);
    expect(anomalyAlerts('terminal_result_unrecoverable')).toBe(0);
    // Never hydrated into this match, never overwritten.
    expect(peekRoom(s.roomCode)).toBeUndefined();
    expect(h.liveSessions.get(s.roomCode)).toEqual(planted);
  });

  it('a foreign terminal live row is never recorded as this match\'s result', async () => {
    const s = await seed({ scores: { [U1]: 31, [U2]: 12 }, winner: U1, seeds: { [U1]: 2, [U2]: 1 } });
    const stored = h.liveSessions.get(s.roomCode)! as Row;
    stored.scheduled_tournament_match_id = FOREIGN; // a finished game of another match
    const before = structuredClone(stored);
    restart();

    await boot(s);
    expect(await tick(s)).toBe(0);

    expect(matchOf(s)).toMatchObject({ status: 'in_progress', winner_id: null });
    expect(s.persistence.applied()).toBe(0);
    expect(h.liveSessions.get(s.roomCode)).toEqual(before);
    expect(peekRoom(s.roomCode)?.state ?? null).toBeNull();
  });

  it('the anomaly is logged on every look but sent once per match (rate-limited), with the foreign match id', async () => {
    const s = await seed({ scores: { [U1]: 20, [U2]: 10 } });
    plantForeignLiveSession(s.roomCode, h.liveSessions.get(s.roomCode)!);
    restart();

    await tick(s);
    await tick(s);
    await tick(s);

    expect(foreignAlerts()).toBe(1);
    const [, context] = vi.mocked(Sentry.captureMessage).mock.calls.find(([m]) => m === '[tournament] tournament_foreign_live_session')!;
    expect((context as any).tags).toMatchObject({ match_id: s.matchId, room_code: s.roomCode });
    expect((context as any).extra).toMatchObject({ foreignMatchId: FOREIGN });
  });

  it('a live row that is this match\'s own still restores normally', async () => {
    const s = await seed({ scores: { [U1]: 20, [U2]: 10 } });
    const before = structuredClone(getRoom(s.roomCode).state!);
    restart();

    await boot(s);

    expect(peekRoom(s.roomCode)!.state).toEqual(before);
    expect(foreignAlerts()).toBe(0);
    expect(matchOf(s).status).toBe('in_progress');
  });
});
