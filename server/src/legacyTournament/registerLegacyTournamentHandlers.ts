import type { Server, Socket } from 'socket.io';
import {
  makeCode,
  makeId,
  initStandings,
  buildRoundRobinMatches,
  sortedStandings,
  applyResult,
  type Tournament,
  type TournamentPlayer,
} from '../tournament/tournament';
import { createRoom, joinRoom, type Room } from '../rooms';
import {
  allocatePlayerSeatId,
  joinSocketToRoom,
  setRoomRoster,
  type AckFn,
} from '../multiplayer/roomSession';

declare global {
  // eslint-disable-next-line no-var
  var __tournamentsById: Map<string, Tournament> | undefined;
  // eslint-disable-next-line no-var
  var __tournamentsByCode: Map<string, string> | undefined;
}

export type LegacyTournamentHandlerDeps = {
  io: Server;
  normalizeUsername: (value: unknown) => string;
  normalizeUserId: (value: unknown) => string | null;
};

export function getLegacyTournamentStorage(): {
  tournamentsById: Map<string, Tournament>;
  tournamentsByCode: Map<string, string>;
} {
  const tournamentsById = (globalThis.__tournamentsById ??= new Map<string, Tournament>());
  const tournamentsByCode = (globalThis.__tournamentsByCode ??= new Map<string, string>());
  return { tournamentsById, tournamentsByCode };
}

export function createEmitTournament(io: Server) {
  return (t: Tournament) => {
    const standings = sortedStandings(t.standings);
    io.to(`tourn:${t.id}`).emit('tournament:state', {
      id: t.id,
      hostSocketId: t.hostSocketId,
      lobbyCode: t.lobbyCode,
      status: t.status,
      players: t.players,
      matches: t.matches,
      currentMatchIndex: t.currentMatchIndex,
      activeMatchId: t.activeMatchId ?? null,
      activeRoomCode: t.activeRoomCode ?? null,
      standings,
    });
  };
}

export function createStartNextMatch(io: Server, emitTournament: (t: Tournament) => void) {
  return (t: Tournament) => {
    // advance to next pending match
    while (t.currentMatchIndex < t.matches.length && t.matches[t.currentMatchIndex].status === 'done') {
      t.currentMatchIndex += 1;
    }
    if (t.currentMatchIndex >= t.matches.length) {
      t.status = 'complete';
      t.activeMatchId = null;
      t.activeRoomCode = null;
      emitTournament(t);
      return;
    }

    const m = t.matches[t.currentMatchIndex];
    m.status = 'active';
    t.activeMatchId = m.id;

    // Create a normal 2-player room for this match with a 30-point winning score.
    // Attach tournament metadata so we can record results later on gameOver.
    const seatA = allocatePlayerSeatId();
    const seatB = allocatePlayerSeatId();
    const room = createRoom(seatA, {
      winningScore: 30,
      tournamentId: t.id,
      tournamentMatchId: m.id,
      tournamentMode: 'round_robin',
    });

    m.roomCode = room.code;
    t.activeRoomCode = room.code;

    // Join the second player in the engine + socket room
    joinRoom(room.code, seatB);
    joinSocketToRoom(m.a, room.code, ['tourn:']);
    joinSocketToRoom(m.b, room.code, ['tourn:']);

    // Room roster for UI
    const pa = t.players.find((p) => p.socketId === m.a);
    const pb = t.players.find((p) => p.socketId === m.b);
    const roomPlayers = [
      { id: seatA, socketId: m.a, username: pa?.username ?? 'Player', userId: pa?.userId ?? null },
      { id: seatB, socketId: m.b, username: pb?.username ?? 'Player', userId: pb?.userId ?? null },
    ];
    setRoomRoster(room.code, roomPlayers);
    io.to(room.code).emit('room:update', { players: roomPlayers });

    // Announce active match (players + spectators)
    io.to(`tourn:${t.id}`).emit('tournament:match:assigned', {
      matchId: m.id,
      roomCode: room.code,
      a: m.a,
      b: m.b,
      aName: roomPlayers[0].username,
      bName: roomPlayers[1].username,
    });

    // Deal is broadcast after both seated clients emit player:ready (see player:ready handler).
    emitTournament(t);
  };
}

export function createMaybeFinalizeTournamentMatch(
  tournamentsById: Map<string, Tournament>,
  emitTournament: (t: Tournament) => void,
  startNextMatch: (t: Tournament) => void,
) {
  return (room: Room) => {
    if (!room?.state?.gameOver) return;

    const cfg = room.config;
    const tid = cfg.tournamentId;
    const mid = cfg.tournamentMatchId;
    if (!tid || !mid) return;

    const t = tournamentsById.get(tid);
    if (!t) return;

    const match = t.matches.find((mm) => mm.id === mid);
    if (!match || match.status === 'done') return;
    if (t.activeMatchId && t.activeMatchId !== mid) {
      console.warn('[tournament] ignoring stale gameOver for non-active match', {
        tournamentId: tid,
        activeMatchId: t.activeMatchId,
        reportedMatchId: mid,
      });
      return;
    }

    const a = match.a;
    const b = match.b;
    const scoreA = room.state.players[a]?.score ?? 0;
    const scoreB = room.state.players[b]?.score ?? 0;
    const winner = scoreA >= scoreB ? a : b;

    applyResult(t, mid, winner, scoreA, scoreB);

    // advance (one match at a time)
    t.currentMatchIndex += 1;
    t.activeMatchId = null;
    t.activeRoomCode = null;

    emitTournament(t);
    startNextMatch(t);
  };
}

/**
 * Registers legacy ad-hoc tournament socket handlers (gated by ENABLE_LEGACY_TOURNAMENTS in index.ts).
 * Returns maybeFinalizeTournamentMatch for assignment to the module-level finalizeTournamentMatchHook.
 */
export function registerLegacyTournamentHandlers(
  socket: Socket,
  deps: LegacyTournamentHandlerDeps,
): (room: Room) => void {
  const { io, normalizeUsername, normalizeUserId } = deps;
  const { tournamentsById } = getLegacyTournamentStorage();

  const emitTournament = createEmitTournament(io);
  const startNextMatch = createStartNextMatch(io, emitTournament);
  const maybeFinalizeTournamentMatch = createMaybeFinalizeTournamentMatch(
    tournamentsById,
    emitTournament,
    startNextMatch,
  );

  const getTournamentForSocket = (): Tournament | null => {
    const tid = (socket.data?.tournamentId as string | undefined) ?? undefined;
    if (!tid) return null;
    return tournamentsById.get(tid) ?? null;
  };

  // TOURNAMENT_HANDLERS
  socket.on('tournament:create', (arg1?: unknown, arg2?: unknown) => {
    const config = (
      arg1 && typeof arg1 === 'object' && !Array.isArray(arg1) ? arg1 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg1 === 'function' ? arg1 : arg2) as AckFn | undefined;
    try {
      const username = normalizeUsername(config.username ?? socket.data?.username);
      const userId = normalizeUserId(config.userId ?? socket.data?.userId);
      socket.data.username = username;
      socket.data.userId = userId;

      const id = makeId('t');
      const lobbyCode = makeCode(4);

      const players: TournamentPlayer[] = [{
        socketId: socket.id,
        username,
        userId,
      }];

      const t: Tournament = {
        id,
        lobbyCode,
        hostSocketId: socket.id,
        status: 'lobby',
        players,
        matches: [],
        currentMatchIndex: 0,
        standings: initStandings(players),
        activeMatchId: null,
        activeRoomCode: null,
      };

      globalThis.__tournamentsById!.set(id, t);
      globalThis.__tournamentsByCode!.set(lobbyCode, id);

      socket.data.tournamentId = id;
      socket.join(`tourn:${id}`);

      cb?.({ ok: true, id, lobbyCode });
      // broadcast lobby state
      io.to(`tourn:${id}`).emit('tournament:lobby:update', { players: t.players, lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'create_failed';
      console.warn('[tournament:create] failed', e);
      cb?.({ ok: false, error: message });
    }
  });

  socket.on('tournament:join', (argCode: unknown, arg2?: unknown, arg3?: unknown) => {
    const lobbyCode = String(argCode ?? '');
    const config = (
      arg2 && typeof arg2 === 'object' && !Array.isArray(arg2) ? arg2 : {}
    ) as { username?: unknown; userId?: unknown };
    const cb = (typeof arg2 === 'function' ? arg2 : arg3) as AckFn | undefined;
    try {
      const code = String(lobbyCode ?? '').trim().toUpperCase();
      const tid = getLegacyTournamentStorage().tournamentsByCode.get(code);
      if (!tid) return cb?.({ ok: false, error: 'not_found' });

      const t = getLegacyTournamentStorage().tournamentsById.get(tid);
      if (!t) return cb?.({ ok: false, error: 'not_found' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });

      if (!t.players.some((p) => p.socketId === socket.id)) {
        const username = normalizeUsername(config.username ?? socket.data?.username);
        const userId = normalizeUserId(config.userId ?? socket.data?.userId);
        socket.data.username = username;
        socket.data.userId = userId;
        t.players.push({ socketId: socket.id, username, userId });
        t.standings[socket.id] = {
          socketId: socket.id,
          username,
          played: 0,
          wins: 0,
          losses: 0,
          pointsFor: 0,
          pointsAgainst: 0,
        };
      }

      socket.data.tournamentId = tid;
      socket.join(`tourn:${tid}`);

      cb?.({ ok: true, id: tid, lobbyCode: t.lobbyCode });
      io.to(`tourn:${tid}`).emit('tournament:lobby:update', { players: t.players, lobbyCode: t.lobbyCode, hostSocketId: t.hostSocketId });
    } catch (e) {
      cb?.({ ok: false, error: 'join_failed' });
    }
  });

  socket.on('tournament:add_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

  socket.on('tournament:remove_bot', (arg1?: unknown, arg2?: unknown) => {
    const cb = (typeof arg2 === 'function' ? arg2 : typeof arg1 === 'function' ? arg1 : undefined) as AckFn | undefined;
    cb?.({ ok: false, error: 'bots_disabled' });
  });

  socket.on('tournament:start', (cb?: AckFn) => {
    try {
      const t = getTournamentForSocket();
      if (!t) return cb?.({ ok: false, error: 'no_tournament' });
      if (socket.id != t.hostSocketId) return cb?.({ ok: false, error: 'not_host' });
      if (t.status !== 'lobby') return cb?.({ ok: false, error: 'already_started' });
      // Tournament bots are disabled; prune any stale bot entries before start.
      const humanPlayers = t.players.filter(
        (p) => !p.isBot && !p.socketId.startsWith('bot:fritz:') && !p.username.startsWith('Fritz'),
      );
      t.players = humanPlayers;
      t.standings = Object.fromEntries(
        Object.entries(t.standings).filter(([socketId]) =>
          humanPlayers.some((player) => player.socketId === socketId),
        ),
      ) as typeof t.standings;

      if (t.players.length < 2) return cb?.({ ok: false, error: 'need_2' });

      t.status = 'running';
      t.matches = buildRoundRobinMatches(t.players);
      t.currentMatchIndex = 0;
      t.activeMatchId = null;
      t.activeRoomCode = null;

      emitTournament(t);
      startNextMatch(t);

      cb?.({ ok: true });
    } catch (e) {
      cb?.({ ok: false, error: 'start_failed' });
    }
  });

  return maybeFinalizeTournamentMatch;
}

export const __legacyTournamentTestUtils = {
  getLegacyTournamentStorage,
  createEmitTournament,
  createStartNextMatch,
  createMaybeFinalizeTournamentMatch,
};