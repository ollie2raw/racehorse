/**
 * Test support for terminal-completion recovery (real local PostgreSQL/PostgREST). Seeds terminal
 * sessions through the PRODUCTION snapshot writer (`persistLiveRoomSessionNow`), so the durable row a
 * restart sees is byte-for-byte what a real room would have left behind.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { GameState } from '../game/types';
import type { RoomMatchEvent } from '../roomEvents';
import { createReservedRoom, deleteRoom, type Room } from '../rooms';
import { setRoomRoster, type RoomPlayer } from './roomSession';
import {
  configureLiveRoomPersistence,
  persistLiveRoomSessionNow,
  resetLiveRoomPersistenceForTests,
} from './roomLivePersistence';
import type { ForfeitReason } from './terminalCompletion';

export const TERMINAL_DB_URL = 'postgresql://postgres@127.0.0.1:55439/racehorse_terminal_r1';
export const TERMINAL_POSTGREST_URL = 'http://127.0.0.1:55440';

export function terminalDbEnabled(): boolean {
  return (
    process.env.TERMINAL_R1_TEST_DATABASE_URL === TERMINAL_DB_URL &&
    process.env.TERMINAL_R1_POSTGREST_URL === TERMINAL_POSTGREST_URL
  );
}

export function localSql(query: string): string {
  if (!terminalDbEnabled()) throw new Error('Refusing nonlocal terminal-completion test database');
  return execFileSync(process.env.PSQL_BIN || 'psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', TERMINAL_DB_URL, '-c', query], {
    encoding: 'utf8',
    timeout: 15_000,
  }).trim();
}

export function truncateCompletionTables(): void {
  localSql(
    'truncate public.room_live_sessions, public.room_match_logs, public.ranked_games, public.rating_periods, public.matches, public.activity_feed, public.bot_match_pending cascade',
  );
}

export function seedAccount(prefix: string, rating = 1500): string {
  const id = randomUUID();
  const name = `${prefix}${id.replace(/-/g, '').slice(0, 8)}`;
  localSql(`insert into auth.users(id,email,raw_user_meta_data) values ('${id}','${name}@racehorse-test.invalid','{"username":"${name}"}')`);
  localSql(`update public.profiles set glicko_rating=${rating}, glicko_rd=200, glicko_vol=0.06, ranked_games_played=30, provisional=false, peak_rating=${rating} where id='${id}'`);
  return id;
}

const t = (low: number, high: number) => ({ low: Math.min(low, high), high: Math.max(low, high) });

export function mkTerminalGameState(
  seatA: string,
  seatB: string,
  scores: { a: number; b: number },
  overrides: Partial<GameState> = {},
): GameState {
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
    playerIds: [seatA, seatB],
    players: {
      [seatA]: { id: seatA, hand: [t(6, 5)], score: scores.a },
      [seatB]: { id: seatB, hand: [t(4, 4)], score: scores.b },
    },
    board: null,
    boneyard: [t(6, 6), t(5, 4)],
    deadTiles: [t(0, 0), t(1, 1)],
    currentPlayerIndex: 0,
    handNumber: 3,
    handOpen: true,
    handOver: false,
    gameOver: true,
    winnerId: scores.a >= scores.b ? seatA : seatB,
    consecutivePasses: 0,
    sequence: 21,
    ...overrides,
  } as GameState;
}

export type SeedKind = 'game_over' | 'forfeit';
export type SeedOptions = {
  kind?: SeedKind;
  roomCode?: string;
  seatA?: { seatId?: string; userId: string | null; username?: string };
  seatB?: { seatId?: string; userId: string | null; username?: string };
  scores?: { a: number; b: number };
  forfeitReason?: ForfeitReason;
  /** userId of the leaver for kind=forfeit (defaults to seat A). */
  abandonerUserId?: string | null;
  matchmakingMatchId?: string;
  fritzTier?: string;
  /** Leave the row in a non-terminal state (crash BEFORE the terminal snapshot). */
  nonTerminal?: boolean;
  /** Persist with matchLogged=true (completion already durably logged). */
  matchLogged?: boolean;
  sourceType?: 'private' | 'matchmaking' | 'tournament';
};

export type SeededSession = {
  code: string;
  matchId: string;
  seatA: string;
  seatB: string;
  roster: RoomPlayer[];
};

let nextCode = 0;
const rosterByCode = new Map<string, RoomPlayer[]>();

/** The production wiring (`initRoomSession`) installs this resolver once; tests mirror it. */
function configureRosterResolver(): void {
  configureLiveRoomPersistence({
    resolveRoster: (roomCode) =>
      (rosterByCode.get(roomCode) ?? []).map((p) => ({ seatId: p.id, userId: p.userId, username: p.username })),
  });
}

export function seedTerminalSession(options: SeedOptions = {}): Promise<SeededSession> {
  configureRosterResolver();
  return seed(options);
}

async function seed(options: SeedOptions): Promise<SeededSession> {
  const code = options.roomCode ?? `TC${String(++nextCode).padStart(4, '0')}${randomUUID().slice(0, 2).toUpperCase()}`;
  const seatA = options.seatA?.seatId ?? `seat-a-${code}`;
  const seatB = options.seatB?.seatId ?? `seat-b-${code}`;
  const scores = options.scores ?? { a: 60, b: 42 };
  const room: Room = createReservedRoom(code, {
    winningScore: 60,
    ...(options.fritzTier ? { fritzTier: options.fritzTier } : {}),
  });
  room.matchId = randomUUID();
  room.players = [seatA, seatB];
  room.eventLogVersion = 1;
  room.eventSequence = 1;
  room.events = [
    {
      id: randomUUID(),
      version: 1,
      matchId: room.matchId,
      roomCode: code,
      sequence: 1,
      type: 'match_started',
      timestamp: new Date().toISOString(),
      handNumber: 1,
      stateSequence: 1,
      actorSocketId: 'sock-a',
      actorUserId: options.seatA?.userId ?? null,
      payload: {},
    } as RoomMatchEvent,
  ];
  if (options.matchmakingMatchId) room.matchmakingMatchId = options.matchmakingMatchId;
  const gameOver = options.kind !== 'forfeit' && !options.nonTerminal;
  room.state = mkTerminalGameState(seatA, seatB, scores, {
    gameOver,
    handOver: !gameOver ? false : false,
    winnerId: gameOver ? (scores.a >= scores.b ? seatA : seatB) : null,
  });
  room.matchLogged = options.matchLogged === true;
  room.leadTracker = { aId: seatA, bId: seatB, maxLeadA: 7, maxLeadB: 3 };
  if (options.kind === 'forfeit') {
    room.abandonedAt = new Date().toISOString();
    room.abandonedByUserId = options.abandonerUserId ?? options.seatA?.userId ?? null;
    room.abandonedReason = 'forfeit';
    room.abandonedForfeitReason = options.forfeitReason ?? 'manual';
  }
  const roster: RoomPlayer[] = [
    { id: seatA, socketId: '', username: options.seatA?.username ?? 'Alice', userId: options.seatA?.userId ?? null },
    { id: seatB, socketId: '', username: options.seatB?.username ?? 'Bob', userId: options.seatB?.userId ?? null },
  ];
  rosterByCode.set(code, roster);
  setRoomRoster(code, roster);
  const ok = await persistLiveRoomSessionNow(
    room,
    roster.map((p) => ({ seatId: p.id, userId: p.userId, username: p.username })),
  );
  if (!ok) throw new Error('seed: terminal snapshot was not durable');
  if (options.sourceType && options.sourceType !== 'private') {
    localSql(`update public.room_live_sessions set source_type='${options.sourceType}' where room_code='${code}'`);
  }
  // The "process" dies: nothing of this room survives in memory.
  deleteRoom(code);
  resetLiveRoomPersistenceForTests();
  configureRosterResolver();
  return { code, matchId: room.matchId, seatA, seatB, roster };
}
