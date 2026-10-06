import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../game/types';
import type { GhostMoveLogEntry } from '../ghost/service';
import type { RoomMatchEvent } from '../roomEvents';
import { peekRoom, resetLiveRoomPersistHookForTests, resetRoomRuntimeForTests, type Room } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { createInitialRoomDurabilityState, markRoomDurabilityPending } from './roomDurability';
import {
  buildLogEntriesSince,
  deleteLiveRoomSession,
  ensureRoomHydrated,
  LOG_ENTRIES_UNAVAILABLE_RETRY_MS,
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
} from './roomLivePersistence';
import { resetRoomSessionStoresForTests } from './roomSession';

/**
 * S1: with LIVE_SESSION_LOG_ENTRIES=true, room_live_sessions rows carry no
 * events / ghostMoveLogs; the entries go to room_live_session_entries through
 * persist_room_live_session, and hydration rebuilds them.
 *
 * The fake below models the two tables and the RPC's semantics: upsert the
 * row, then upsert each entry on (room_code, stream, idx).
 */
const db = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, unknown>>(),
  entries: new Map<string, { stream: string; idx: number; entry: unknown }>(),
  rpcCalls: [] as Array<{ session: Record<string, unknown>; entries: Array<{ stream: string; idx: number; entry: unknown }> }>,
  fullRowPosts: 0,
  rpcMissing: false,
  failNextRpc: false,
}));

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (path === '/rest/v1/rpc/persist_room_live_session' && method === 'POST') {
      if (db.rpcMissing) {
        throw new Error('Supabase request failed: 404 {"code":"PGRST202","message":"Could not find the function public.persist_room_live_session"}');
      }
      if (db.failNextRpc) {
        db.failNextRpc = false;
        throw new Error('Supabase request failed: 503 upstream');
      }
      const body = JSON.parse(String(init?.body)) as { p_session: Record<string, unknown>; p_entries: Array<{ stream: string; idx: number; entry: unknown }> };
      db.rpcCalls.push({ session: body.p_session, entries: body.p_entries });
      const code = String(body.p_session.room_code);
      db.sessions.set(code, body.p_session);
      for (const e of body.p_entries) db.entries.set(`${code}|${e.stream}|${e.idx}`, { ...e });
      return undefined;
    }
    if (path.startsWith('/rest/v1/room_live_sessions') && method === 'POST') {
      db.fullRowPosts += 1;
      for (const row of JSON.parse(String(init?.body)) as Array<Record<string, unknown>>) {
        db.sessions.set(String(row.room_code), row);
      }
      return undefined;
    }
    if (path.startsWith('/rest/v1/room_live_sessions') && method === 'GET') {
      const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '');
      const row = db.sessions.get(code);
      return row ? [structuredClone(row)] : [];
    }
    if (path.startsWith('/rest/v1/room_live_sessions') && method === 'DELETE') {
      const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '');
      db.sessions.delete(code);
      for (const key of [...db.entries.keys()]) if (key.startsWith(`${code}|`)) db.entries.delete(key);
      return undefined;
    }
    if (path.startsWith('/rest/v1/room_live_session_entries') && method === 'GET') {
      const code = decodeURIComponent(path.match(/room_code=eq\.([^&]+)/)?.[1] ?? '');
      return [...db.entries.entries()]
        .filter(([key]) => key.startsWith(`${code}|`))
        .map(([, value]) => structuredClone(value))
        .sort((a, b) => a.stream.localeCompare(b.stream) || a.idx - b.idx);
    }
    if (path.includes('/room_command_receipts') && method === 'GET') return [];
    if (path.includes('/mp_authority_events')) return undefined;
    throw new Error(`unexpected supabaseFetch call: ${method} ${path}`);
  }),
}));

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });
const SEATS = ['seat-a', 'seat-b'];
const roster = [
  { seatId: 'seat-a', userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'A' },
  { seatId: 'seat-b', userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'B' },
];

function mkGameState(sequence: number): GameState {
  return {
    config: {
      maxPips: 6,
      tilesPerPlayer: 7,
      deadTileCount: 2,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 60,
    },
    playerIds: [...SEATS],
    players: {
      'seat-a': { id: 'seat-a', hand: [t(6, 5), t(3, 1)], score: 12 },
      'seat-b': { id: 'seat-b', hand: [t(4, 4), t(2, 0)], score: 8 },
    },
    board: null,
    boneyard: [t(6, 6), t(5, 4), t(1, 0)],
    deadTiles: [t(0, 0), t(1, 1)],
    currentPlayerIndex: 0,
    handNumber: 2,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence,
  } as GameState;
}

function ghostEntry(turn: number): GhostMoveLogEntry {
  return { turn, actor: 'you', board_state: `b${turn}`, tile_played: '1|1', branch: 'left', hand_before: ['1|1'], score_delta: 0 } as GhostMoveLogEntry;
}

function event(sequence: number): RoomMatchEvent {
  return { sequence, type: 'tile_played', timestamp: '2026-10-05T00:00:00.000Z', payload: { n: sequence } } as unknown as RoomMatchEvent;
}

function mkRoom(code: string, moves: number): Room {
  const room = {
    code,
    players: [...SEATS],
    state: mkGameState(moves),
    config: { winningScore: 60 },
    asyncStateVersion: 1,
    nextHandReady: new Set(),
    rematchReady: new Set(),
    matchStartReady: new Set(),
    lastHandEndedNotifiedHand: null,
    lastHandEndedAtMs: null,
    lastBroadcastScores: {},
    ghostMoveLogs: { 'seat-a': [] as GhostMoveLogEntry[], 'seat-b': [] as GhostMoveLogEntry[] },
    ghostTurnIndex: 0,
    matchId: '11111111-1111-4111-8111-111111111111',
    matchLogged: false,
    leadTracker: null,
    eventLogVersion: 1,
    eventSequence: 0,
    events: [] as RoomMatchEvent[],
  } as unknown as Room;
  for (let i = 0; i < moves; i += 1) play(room, false);
  room.durability = createInitialRoomDurabilityState({
    asyncStateVersion: room.asyncStateVersion,
    state: room.state,
    eventSequence: room.eventSequence,
  });
  return room;
}

/** One move: an event, a ghost entry for the mover, sequence +1. */
function play(room: Room, bumpState = true): void {
  room.eventSequence += 1;
  room.events.push(event(room.eventSequence));
  const seat = SEATS[(room.ghostTurnIndex ?? 0) % 2]!;
  room.ghostMoveLogs[seat] = [...(room.ghostMoveLogs[seat] ?? []), ghostEntry(room.ghostTurnIndex)];
  room.ghostTurnIndex += 1;
  if (bumpState && room.state) room.state = { ...room.state, sequence: room.state.sequence + 1 };
  // What the live-persist hook does after every committed mutation.
  if (room.durability) markRoomDurabilityPending(room);
}

beforeEach(() => {
  process.env.LIVE_SESSION_LOG_ENTRIES = 'true';
  resetLiveRoomPersistenceForTests();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  resetLiveRoomPersistHookForTests();
  db.sessions.clear();
  db.entries.clear();
  db.rpcCalls.length = 0;
  db.fullRowPosts = 0;
  db.rpcMissing = false;
  db.failNextRpc = false;
  vi.mocked(supabaseFetch).mockClear();
});

afterEach(() => {
  delete process.env.LIVE_SESSION_LOG_ENTRIES;
  vi.useRealTimers();
});

describe('buildLogEntriesSince', () => {
  it('sends only what follows the last confirmed entry while the log is only appended to', () => {
    const room = mkRoom('APPEND', 3);
    const first = buildLogEntriesSince(room, undefined);
    expect(first.entries).toHaveLength(6);
    play(room);
    const next = buildLogEntriesSince(room, first.confirmed);
    expect(next.entries.map((e) => `${e.stream}:${e.idx}`)).toEqual(['events:3', 'ghost:seat-b:1']);
  });

  it('resends a log from index 0 once it was replaced (rollback / rematch), even if it grew back', () => {
    const room = mkRoom('SHRINK', 4);
    const confirmed = buildLogEntriesSince(room, undefined).confirmed;
    room.events = structuredClone(room.events).slice(0, 2); // a rollback restores clones
    room.events.push(event(99));
    room.events.push(event(100));
    const { entries } = buildLogEntriesSince(room, confirmed);
    expect(entries.filter((e) => e.stream === 'events').map((e) => e.idx)).toEqual([0, 1, 2, 3]);
    expect(entries.filter((e) => e.stream !== 'events')).toEqual([]);
  });
});

describe('LIVE_SESSION_LOG_ENTRIES=true', () => {
  it('writes the row without logs, with their counts, plus every entry on the first write', async () => {
    const room = mkRoom('ENTR1', 3);
    await persistLiveRoomSessionNow(room, roster);

    expect(db.fullRowPosts).toBe(0);
    expect(db.rpcCalls).toHaveLength(1);
    const { session, entries } = db.rpcCalls[0]!;
    expect(session.events).toEqual([]);
    const shell = session.room_shell as Record<string, unknown>;
    expect(shell.ghostMoveLogs).toEqual({});
    expect(shell.logStorage).toBe('entries');
    expect(shell.eventCount).toBe(3);
    expect(shell.ghostMoveLogCounts).toEqual({ 'seat-a': 2, 'seat-b': 1 });
    expect(entries.map((e) => `${e.stream}:${e.idx}`).sort()).toEqual(
      ['events:0', 'events:1', 'events:2', 'ghost:seat-a:0', 'ghost:seat-a:1', 'ghost:seat-b:0'].sort(),
    );
  });

  it('later writes send only the entries added since the last confirmed write', async () => {
    const room = mkRoom('ENTR2', 3);
    await persistLiveRoomSessionNow(room, roster);
    play(room);
    await persistLiveRoomSessionNow(room, roster);

    expect(db.rpcCalls[1]!.entries.map((e) => `${e.stream}:${e.idx}`)).toEqual(['events:3', 'ghost:seat-b:1']);
  });

  it('after a failed write, the next write resends everything since the last confirmed one', async () => {
    const room = mkRoom('ENTR3', 2);
    await persistLiveRoomSessionNow(room, roster);
    play(room);
    db.failNextRpc = true;
    expect(await persistLiveRoomSessionNow(room, roster)).toBe(false);
    play(room);
    await persistLiveRoomSessionNow(room, roster);

    expect(db.rpcCalls.at(-1)!.entries.map((e) => `${e.stream}:${e.idx}`)).toEqual([
      'events:2',
      'events:3',
      'ghost:seat-a:1',
      'ghost:seat-b:1',
    ]);
  });

  it('a rematch reset rewrites entries from index 0 and hydration reads only the new match', async () => {
    const room = mkRoom('REMATCH', 4);
    await persistLiveRoomSessionNow(room, roster);
    room.events = [];
    room.eventSequence += 1;
    room.ghostMoveLogs = { 'seat-a': [], 'seat-b': [] };
    room.ghostTurnIndex = 0;
    markRoomDurabilityPending(room);
    play(room);
    await persistLiveRoomSessionNow(room, roster);

    const peers = [...db.entries.values()].filter((e) => e.stream === 'events');
    expect(peers).toHaveLength(4); // stale tail stays in the table…
    resetRoomRuntimeForTests();
    const hydrated = await ensureRoomHydrated('REMATCH');
    expect(hydrated.kind).toBe('hydrated');
    const back = peekRoom('REMATCH')!;
    expect(back.events).toHaveLength(1); // …but only the snapshot's count is read
    expect(back.events[0]).toEqual(room.events[0]);
    expect(back.ghostMoveLogs).toEqual(room.ghostMoveLogs);
  });

  it('hydration rebuilds both logs exactly, and the next write sends only new entries', async () => {
    const room = mkRoom('HYD1', 5);
    await persistLiveRoomSessionNow(room, roster);
    resetRoomRuntimeForTests();

    const hydrated = await ensureRoomHydrated('HYD1');
    expect(hydrated.kind).toBe('hydrated');
    const back = peekRoom('HYD1')!;
    expect(back.events).toEqual(room.events);
    expect(back.ghostMoveLogs).toEqual(room.ghostMoveLogs);

    play(back);
    await persistLiveRoomSessionNow(back, roster);
    expect(db.rpcCalls.at(-1)!.entries.map((e) => `${e.stream}:${e.idx}`)).toEqual(['events:5', 'ghost:seat-b:2']);
  });

  it('a missing entry makes the snapshot invalid instead of hydrating a short log', async () => {
    const room = mkRoom('HOLE1', 3);
    await persistLiveRoomSessionNow(room, roster);
    db.entries.delete('HOLE1|ghost:seat-a|1');
    resetRoomRuntimeForTests();

    expect(await ensureRoomHydrated('HOLE1')).toEqual({ kind: 'snapshot_invalid', error: 'snapshot_log_entries_missing' });
  });

  it('still hydrates a full row written before the flag was on', async () => {
    delete process.env.LIVE_SESSION_LOG_ENTRIES;
    const room = mkRoom('OLD1', 3);
    await persistLiveRoomSessionNow(room, roster);
    expect(db.fullRowPosts).toBe(1);
    process.env.LIVE_SESSION_LOG_ENTRIES = 'true';
    resetRoomRuntimeForTests();

    expect((await ensureRoomHydrated('OLD1')).kind).toBe('hydrated');
    expect(peekRoom('OLD1')!.ghostMoveLogs).toEqual(room.ghostMoveLogs);
  });

  it('an entries-mode row still hydrates after the flag is turned off again', async () => {
    const room = mkRoom('OFF1', 3);
    await persistLiveRoomSessionNow(room, roster);
    delete process.env.LIVE_SESSION_LOG_ENTRIES;
    resetRoomRuntimeForTests();

    expect((await ensureRoomHydrated('OFF1')).kind).toBe('hydrated');
    expect(peekRoom('OFF1')!.events).toEqual(room.events);
  });

  it('falls back to full rows when the RPC is missing, and retries it after the wait', async () => {
    vi.useFakeTimers();
    db.rpcMissing = true;
    const room = mkRoom('NORPC', 2);
    expect(await persistLiveRoomSessionNow(room, roster)).toBe(true);
    expect(db.fullRowPosts).toBe(1);

    db.rpcMissing = false;
    play(room);
    await persistLiveRoomSessionNow(room, roster);
    expect(db.fullRowPosts).toBe(2);
    expect(db.rpcCalls).toHaveLength(0);

    vi.advanceTimersByTime(LOG_ENTRIES_UNAVAILABLE_RETRY_MS + 1);
    play(room);
    await persistLiveRoomSessionNow(room, roster);
    expect(db.rpcCalls).toHaveLength(1);
    // After a full-row write nothing is assumed confirmed: every entry goes again.
    expect(db.rpcCalls[0]!.entries.filter((e) => e.stream === 'events')).toHaveLength(4);
  });

  it('deleting the room forgets its confirmed lengths', async () => {
    const room = mkRoom('DEL1', 2);
    await persistLiveRoomSessionNow(room, roster);
    await deleteLiveRoomSession('DEL1');
    await persistLiveRoomSessionNow(room, roster);
    expect(db.rpcCalls.at(-1)!.entries).toHaveLength(4);
  });
});

describe('LIVE_SESSION_LOG_ENTRIES unset', () => {
  it('keeps writing full rows exactly as before', async () => {
    delete process.env.LIVE_SESSION_LOG_ENTRIES;
    const room = mkRoom('FULL1', 3);
    await persistLiveRoomSessionNow(room, roster);
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.fullRowPosts).toBe(1);
    const row = db.sessions.get('FULL1')!;
    expect(row.events).toHaveLength(3);
    expect((row.room_shell as Record<string, unknown>).logStorage).toBeUndefined();
  });
});
