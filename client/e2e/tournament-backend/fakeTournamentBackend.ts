/**
 * E2E-only tournament backend (Phase 3E). Run by Playwright in TOURNAMENT_E2E
 * mode (see playwright.config.ts); never part of the app or the game server.
 *
 * Why it exists: the real tournament engine persists through Supabase, and
 * tests must never touch a real Supabase project, so a full-stack tournament
 * run is not possible in CI. The server side of the flows (routes, engine,
 * dispatch, rooms, turn clock, recovery) is proven in-process by the server
 * suite (fritzCup.test.ts, tournamentTurnClock.test.ts, …). This backend lets
 * the REAL client app — routing, hooks, socket handlers, Hub, banner, HUD,
 * post-match, bracket, result, history — run the journeys end to end against
 * the same HTTP and socket shapes the server produces:
 *
 *  - GET /api/tournaments/upcoming | my | history | :id/bracket | :id/result,
 *    POST fritz-cup, POST/DELETE :id/register (with the server's error codes);
 *  - socket.io: tournament:attach_assigned_match (ack), game:action, hand:ready,
 *    state:update (masked state, legal moves, tournamentClock, serverNow), and
 *    the tournament:* lifecycle events;
 *  - real game rules (game-core); Fritz / the opponent play their legal moves.
 *
 * Tests drive what only the server's clock or other players would decide
 * (start a Live Event, decide a match, cancel) through /__e2e/* admin routes.
 */
import http from 'node:http';
import express, { type Request, type Response } from 'express';
import { Server, type Socket } from 'socket.io';
import {
  applyMove,
  canDraw,
  createInitialState,
  drawOne,
  getLegalMoves,
  startNewHand,
  type GameState,
  type Move,
} from '@racehorse/game-core';

const PORT = Number(process.env.TOURNAMENT_E2E_BACKEND_PORT ?? 3277);
const TURN_MS = 45_000;

type Kind = 'live' | 'fritz_cup';
type TStatus = 'upcoming' | 'registration_open' | 'in_progress' | 'completed' | 'cancelled';
type RegStatus = 'registered' | 'active' | 'eliminated' | 'winner' | 'withdrawn';
type OutcomeKind = 'played' | 'forfeit' | 'missed_turns' | 'no_show' | 'administrative' | 'bye' | 'bot_simulated';
type Tier = 'standard' | 'elite' | 'master';

type Tournament = {
  id: string; kind: Kind; status: TStatus; scheduled_start: string; registration_open_at: string; registration_close_at: string;
  format: string; win_target: number; max_players: number; winner_id: string | null; created_at: string; registered_count: number | null;
};
type Match = {
  id: string; tournament_id: string; round: 1 | 2 | 3; match_number: number; player1_id: string | null; player2_id: string | null;
  winner_id: string | null; room_code: string | null; status: 'waiting' | 'ready' | 'in_progress' | 'completed'; bot_tier: Tier | null;
  started_at: string | null; completed_at: string | null; player1_score: number | null; player2_score: number | null;
  outcomeKind: OutcomeKind | null; joined: boolean;
};
type Reg = { status: RegStatus; placement: number | null; seed: number | null };
type Room = { code: string; matchId: string; humanSeat: string; oppSeat: string; game: GameState; sockets: Set<string>; deadlineAt: string | null };

const iso = (ms: number) => new Date(ms).toISOString();
const isBot = (id: string | null | undefined) => Boolean(id && id.startsWith('bot:fritz:'));
const tierFor = (round: 1 | 2 | 3): Tier => (round === 3 ? 'master' : round === 2 ? 'elite' : 'standard');
const botName = (tier: Tier | null) => (tier === 'master' ? 'Master Fritz' : tier === 'elite' ? 'Elite Fritz' : 'Fritz');
const placementLabel = (p: number | null) => (p === 1 ? 'Champion' : p === 2 ? 'Runner-up' : p === 3 ? 'Semifinalist' : p === 5 ? 'Quarterfinalist' : null);

// ── state ──────────────────────────────────────────────────────────────────

let seq = 0;
let features = { tournaments: true, fritzCup: true };
const tournaments = new Map<string, Tournament>();
const regs = new Map<string, Reg>(); // tournamentId → the player's registration
const matches = new Map<string, Match>();
const rooms = new Map<string, Room>();
let nextFailure: Record<string, { status: number; body: Record<string, unknown> }> = {};
const counters = { attach: 0, myFetches: 0 };
const socketLog: string[] = [];
let userId = 'e2e-player';
let rivalName = 'rival';
let missedTurns = 0;

function reset(body: { features?: typeof features; live?: Array<{ id: string; startsInMin: number; status?: TStatus; registeredCount?: number; registered?: boolean }> }): void {
  seq = 0;
  features = body.features ?? { tournaments: true, fritzCup: true };
  tournaments.clear(); regs.clear(); matches.clear(); rooms.clear();
  nextFailure = {};
  counters.attach = 0; counters.myFetches = 0;
  rivalName = 'rival'; missedTurns = 0;
  for (const live of body.live ?? []) {
    const start = Date.now() + live.startsInMin * 60_000;
    tournaments.set(live.id, {
      id: live.id, kind: 'live', status: live.status ?? 'registration_open', scheduled_start: iso(start),
      registration_open_at: iso(start - 12 * 3_600_000), registration_close_at: iso(start - 2 * 60_000),
      format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: iso(Date.now() - 3_600_000),
      registered_count: live.registeredCount ?? 0,
    });
    if (live.registered) regs.set(live.id, { status: 'registered', placement: null, seed: null });
  }
}

const matchesOf = (tid: string) => [...matches.values()].filter((m) => m.tournament_id === tid).sort((a, b) => a.round - b.round || a.match_number - b.match_number);
const myMatch = (m: Match) => m.player1_id === userId || m.player2_id === userId;

function addMatch(tid: string, round: 1 | 2 | 3, n: number, p1: string | null, p2: string | null, over: Partial<Match> = {}): Match {
  const m: Match = {
    id: `${tid}-r${round}m${n}`, tournament_id: tid, round, match_number: n, player1_id: p1, player2_id: p2, winner_id: null,
    room_code: null, status: 'waiting', bot_tier: isBot(p1) || isBot(p2) ? tierFor(round) : null, started_at: null, completed_at: null,
    player1_score: null, player2_score: null, outcomeKind: null, joined: false, ...over,
  };
  if (m.status === 'ready' || m.status === 'in_progress') m.room_code = `T${tid.replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase()}R${round}M${n}`;
  matches.set(m.id, m);
  return m;
}

/** Quarterfinals: the player vs `opponent`; the other three decided (Fritz vs Fritz or humans). */
function seedBracket(tid: string, opponent: string): void {
  addMatch(tid, 1, 1, userId, opponent, { status: 'ready' });
  for (let n = 2; n <= 4; n += 1) {
    const a = `bot:fritz:${tid}:${n * 2 - 1}`; const b = `bot:fritz:${tid}:${n * 2}`;
    addMatch(tid, 1, n, a, b, { status: 'completed', winner_id: b, outcomeKind: 'bot_simulated', player1_score: 18, player2_score: 30, completed_at: iso(Date.now()) });
  }
}

function playable(): Record<string, unknown> | null {
  const m = [...matches.values()].find((x) => myMatch(x) && (x.status === 'ready' || x.status === 'in_progress') && tournaments.get(x.tournament_id)?.status === 'in_progress');
  if (!m) return null;
  const opp = m.player1_id === userId ? m.player2_id : m.player1_id;
  return {
    matchId: m.id, tournamentId: m.tournament_id, round: m.round, matchNumber: m.match_number, roomCode: m.room_code,
    opponentId: opp, opponentUsername: isBot(opp) ? botName(m.bot_tier) : opp === 'u-rival' ? rivalName : null,
    matchStatus: m.joined ? 'in_progress' : 'ready', readyDeadlineAt: null,
  };
}

function lastMatchOf(tid: string) {
  const mine = matchesOf(tid).filter((m) => myMatch(m) && m.winner_id).sort((a, b) => b.round - a.round)[0];
  if (!mine) return null;
  const opp = mine.player1_id === userId ? mine.player2_id : mine.player1_id;
  return { matchId: mine.id, round: mine.round, won: mine.winner_id === userId, outcomeKind: mine.outcomeKind, opponentId: opp, opponentBotTier: isBot(opp) ? mine.bot_tier : null };
}

function myTournaments() {
  return [...regs.entries()].flatMap(([tid, reg]) => {
    const t = tournaments.get(tid);
    if (!t || reg.status === 'withdrawn') return [];
    return [{ ...t, myRegistration: { status: reg.status, placement: reg.placement, placementLabel: placementLabel(reg.placement), seed: reg.seed }, myLastMatch: lastMatchOf(tid) }];
  });
}

function championFields(t: Tournament) {
  if (!t.winner_id) return { championId: null, championName: null, championIsFritz: false, championFritzTier: null };
  if (isBot(t.winner_id)) return { championId: t.winner_id, championName: 'Master Fritz', championIsFritz: true, championFritzTier: 'master' };
  return { championId: t.winner_id, championName: t.winner_id === userId ? 'e2e_daily_fritz' : 'rival', championIsFritz: false, championFritzTier: null };
}

// ── rooms / game ───────────────────────────────────────────────────────────

let io: Server;

function mask(game: GameState, seat: string): GameState {
  const reveal = game.handOver || game.gameOver;
  return {
    ...game,
    boneyard: reveal ? game.boneyard : game.boneyard.map(() => ({ high: -1, low: -1 })),
    deadTiles: reveal ? game.deadTiles : game.deadTiles.map(() => ({ high: -1, low: -1 })),
    players: Object.fromEntries(game.playerIds.map((pid) => [pid, { ...game.players[pid], hand: reveal || pid === seat ? game.players[pid].hand : [] }])),
  } as GameState;
}

function clockFor(room: Room) {
  const g = room.game;
  if (g.gameOver || !room.deadlineAt) return null;
  if (g.handOver) return { kind: 'next_hand', seatId: null, waitingSeatIds: [room.humanSeat], deadlineAt: room.deadlineAt };
  const seat = g.playerIds[g.currentPlayerIndex];
  if (isBot(seat)) return null; // the server never times a Fritz turn
  return { kind: 'turn', seatId: seat, deadlineAt: room.deadlineAt, missedTurns: seat === room.humanSeat ? missedTurns : 0, maxMissedTurns: 3 };
}

function armClock(room: Room): void {
  const g = room.game;
  const seat = g.playerIds[g.currentPlayerIndex];
  room.deadlineAt = g.gameOver || (!g.handOver && isBot(seat)) ? null : iso(Date.now() + TURN_MS);
}

function broadcast(room: Room): void {
  const handCounts = Object.fromEntries(room.game.playerIds.map((pid) => [pid, room.game.players[pid].hand.length]));
  for (const sid of room.sockets) {
    const s = io.sockets.sockets.get(sid);
    if (!s) continue;
    s.emit('state:update', {
      state: { ...mask(room.game, room.humanSeat), handCounts },
      legalMoves: room.game.playerIds[room.game.currentPlayerIndex] === room.humanSeat && !room.game.handOver ? getLegalMoves(room.game, room.humanSeat) : [],
      canDraw: !room.game.handOver && room.game.playerIds[room.game.currentPlayerIndex] === room.humanSeat ? canDraw(room.game, room.humanSeat) : false,
      you: room.humanSeat,
      matchStarted: true,
      tournamentClock: clockFor(room),
      serverNow: iso(Date.now()),
    });
  }
}

/** The non-player seat plays its first legal move (drawing when it must). */
function opponentTurns(room: Room): void {
  let guard = 0;
  while (!room.game.gameOver && !room.game.handOver && room.game.playerIds[room.game.currentPlayerIndex] === room.oppSeat && guard < 40) {
    guard += 1;
    const moves = getLegalMoves(room.game, room.oppSeat);
    if (moves.length > 0) room.game = applyMove(room.game, room.oppSeat, moves[0]!).state;
    else if (canDraw(room.game, room.oppSeat)) room.game = drawOne(room.game, room.oppSeat).state;
    else room.game = applyMove(room.game, room.oppSeat, { type: 'pass' }).state;
  }
  armClock(room);
}

function openRoom(m: Match): Room {
  const existing = m.room_code ? rooms.get(m.room_code) : undefined;
  if (existing) return existing;
  const opp = (m.player1_id === userId ? m.player2_id : m.player1_id)!;
  const humanSeat = `seat-${userId}`;
  const oppSeat = isBot(opp) ? opp : `seat-${opp}`;
  let game = createInitialState([humanSeat, oppSeat], { winningScore: 30 } as never);
  game = startNewHand(game, undefined, humanSeat);
  // The player opens (the server's opener rule is not what is under test here).
  game = { ...game, currentPlayerIndex: game.playerIds.indexOf(humanSeat) };
  const room: Room = { code: m.room_code!, matchId: m.id, humanSeat, oppSeat, game, sockets: new Set(), deadlineAt: null };
  armClock(room);
  rooms.set(room.code, room);
  return room;
}

function emitAll(event: string, payload: Record<string, unknown>): void {
  io.emit(event, { ...payload, serverNow: iso(Date.now()) });
}

/** Decide a match (what the game, a forfeit or the server's rules would). */
function decide(matchId: string, winner: 'player' | 'opponent', outcomeKind: OutcomeKind, emitReady = true): void {
  const m = matches.get(matchId);
  if (!m) throw new Error('no_match');
  const t = tournaments.get(m.tournament_id)!;
  const opp = (m.player1_id === userId ? m.player2_id : m.player1_id)!;
  const winnerId = winner === 'player' ? userId : opp;
  Object.assign(m, {
    status: 'completed', winner_id: winnerId, outcomeKind, completed_at: iso(Date.now()),
    player1_score: m.player1_id === winnerId ? 30 : 14, player2_score: m.player2_id === winnerId ? 30 : 14,
  });
  const room = m.room_code ? rooms.get(m.room_code) : undefined;
  if (room) {
    const players = Object.fromEntries(room.game.playerIds.map((pid) => [pid, { ...room.game.players[pid], score: (pid === room.humanSeat) === (winner === 'player') ? 30 : 14 }]));
    room.game = { ...room.game, players, gameOver: true, handOver: true, winnerId: winner === 'player' ? room.humanSeat : room.oppSeat, sequence: room.game.sequence + 1 } as GameState;
    room.deadlineAt = null;
    broadcast(room);
  }
  const reg = regs.get(t.id)!;
  emitAll('tournament:match_completed', { tournamentId: t.id, kind: t.kind, matchId: m.id, round: m.round, roomCode: m.room_code, winnerId });
  if (winner === 'player' && m.round < 3) {
    const next = (m.round + 1) as 2 | 3;
    const nextOpp = t.kind === 'fritz_cup' ? `bot:fritz:${t.id}:${next === 2 ? 4 : 8}` : `bot:fritz:${t.id}:${next * 3}`;
    // The other half of the bracket (Fritz) is decided at once.
    if (next === 2) addMatch(t.id, 2, 2, `bot:fritz:${t.id}:6`, `bot:fritz:${t.id}:8`, { status: 'completed', winner_id: `bot:fritz:${t.id}:8`, outcomeKind: 'bot_simulated', player1_score: 21, player2_score: 30, completed_at: iso(Date.now()) });
    const nm = addMatch(t.id, next, 1, userId, nextOpp, { status: 'ready' });
    if (emitReady) {
      io.emit('tournament:match_ready', {
        tournamentId: t.id, matchId: nm.id, round: next, matchNumber: 1, roomCode: nm.room_code, matchStatus: 'ready',
        readyAt: iso(Date.now()), readyDeadlineAt: null, opponentId: nextOpp, opponentUsername: botName(nm.bot_tier), serverNow: iso(Date.now()),
      });
    }
    return;
  }
  // Tournament over for the player.
  if (winner === 'player') {
    reg.status = 'winner'; reg.placement = 1; t.winner_id = userId;
  } else {
    reg.status = 'eliminated'; reg.placement = m.round === 3 ? 2 : m.round === 2 ? 3 : 5;
    t.winner_id = isBot(opp) && m.round === 3 ? opp : `bot:fritz:${t.id}:8`;
  }
  t.status = 'completed';
  emitAll('tournament:completed', { tournamentId: t.id, kind: t.kind, status: 'completed' });
}

// ── HTTP ───────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin ?? '*');
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] ?? '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,PUT,PATCH,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  const header = req.headers['x-e2e-daily-fritz-user'];
  if (typeof header === 'string' && header.trim()) userId = header.trim();
  next();
});

const send = (res: Response, body: Record<string, unknown>, status = 200) => res.status(status).json({ ...body, serverNow: iso(Date.now()) });
function failIfArmed(key: string, res: Response): boolean {
  const f = nextFailure[key];
  if (!f) return false;
  delete nextFailure[key];
  send(res, { ok: false, ...f.body }, f.status);
  return true;
}

app.get('/ping', (_req, res) => { res.send('pong'); });

app.get('/api/tournaments/upcoming', (_req, res) => {
  if (failIfArmed('upcoming', res)) return;
  if (!features.tournaments) { send(res, { ok: true, tournaments: [], features }); return; }
  const upcoming = [...tournaments.values()].filter((t) => t.kind === 'live' && (t.status === 'upcoming' || t.status === 'registration_open'));
  send(res, { ok: true, tournaments: upcoming, features });
});

app.get('/api/tournaments/my', (_req, res) => {
  counters.myFetches += 1;
  if (failIfArmed('my', res)) return;
  send(res, { ok: true, registrations: [], tournaments: features.tournaments ? myTournaments() : [], activeAssignedMatch: features.tournaments ? playable() : null, features });
});

app.get('/api/tournaments/history', (_req, res) => {
  if (failIfArmed('history', res)) return;
  const history = myTournaments()
    .filter((t) => t.myRegistration.placement !== null)
    .map((t) => ({
      tournamentId: t.id, kind: t.kind, scheduledStart: t.scheduled_start, format: t.format, winTarget: t.win_target,
      placement: t.myRegistration.placement, placementLabel: placementLabel(t.myRegistration.placement), ...championFields(tournaments.get(t.id)!), myLastMatch: t.myLastMatch,
    }))
    .sort((a, b) => Date.parse(b.scheduledStart) - Date.parse(a.scheduledStart));
  send(res, { ok: true, history });
});

app.post('/api/tournaments/fritz-cup', (_req, res) => {
  if (failIfArmed('fritz-cup', res)) return;
  if (!features.fritzCup) { send(res, { ok: false, error: 'tournaments_disabled' }, 403); return; }
  const active = myTournaments().find((t) => t.kind === 'fritz_cup' && (t.status === 'in_progress'));
  if (active) { send(res, { ok: true, existing: true, tournament: tournaments.get(active.id), activeAssignedMatch: playable() }); return; }
  seq += 1;
  const id = `cup-${seq}`;
  const t: Tournament = {
    id, kind: 'fritz_cup', status: 'in_progress', scheduled_start: iso(Date.now()), registration_open_at: iso(Date.now()), registration_close_at: iso(Date.now()),
    format: '7-tile', win_target: 30, max_players: 8, winner_id: null, created_at: iso(Date.now()), registered_count: null,
  };
  tournaments.set(id, t);
  regs.set(id, { status: 'active', placement: null, seed: 1 });
  seedBracket(id, `bot:fritz:${id}:2`);
  send(res, { ok: true, existing: false, tournament: t, activeAssignedMatch: playable() });
});

app.post('/api/tournaments/:id/register', (req: Request, res: Response) => {
  if (failIfArmed('register', res)) return;
  const t = tournaments.get(String(req.params.id));
  if (!t) { send(res, { ok: false, error: 'not_found' }, 404); return; }
  if (t.status !== 'registration_open') { send(res, { ok: false, error: 'registration_closed' }, 409); return; }
  if ((t.registered_count ?? 0) >= t.max_players) { send(res, { ok: false, error: 'tournament_full' }, 409); return; }
  const already = regs.get(t.id)?.status === 'registered';
  if (!already) { regs.set(t.id, { status: 'registered', placement: null, seed: null }); t.registered_count = (t.registered_count ?? 0) + 1; }
  send(res, { ok: true, alreadyRegistered: already });
});

app.delete('/api/tournaments/:id/register', (req: Request, res: Response) => {
  const t = tournaments.get(String(req.params.id));
  const reg = t ? regs.get(t.id) : undefined;
  if (!t || !reg) { send(res, { ok: false, error: 'not_registered' }, 409); return; }
  regs.delete(t.id); t.registered_count = Math.max(0, (t.registered_count ?? 1) - 1);
  send(res, { ok: true });
});

app.get('/api/tournaments/:id/bracket', (req: Request, res: Response) => {
  const t = tournaments.get(String(req.params.id));
  if (!t) { send(res, { ok: false, error: 'not_found' }, 404); return; }
  const registrations = [{ id: 'r-me', tournament_id: t.id, user_id: userId, registered_at: t.created_at, seed: 1, placement: regs.get(t.id)?.placement ?? null, status: regs.get(t.id)?.status ?? 'active', username: 'e2e_daily_fritz' }];
  send(res, { ok: true, view: { tournament: t, registrations, matches: matchesOf(t.id).map(({ joined: _j, ...m }) => m) } });
});

app.get('/api/tournaments/:id/result', (req: Request, res: Response) => {
  const t = tournaments.get(String(req.params.id));
  if (!t) { send(res, { ok: false, error: 'not_found' }, 404); return; }
  if (t.status !== 'completed') { send(res, { ok: false, error: 'not_completed' }, 409); return; }
  const reg = regs.get(t.id);
  send(res, {
    ok: true,
    result: {
      tournamentId: t.id, kind: t.kind, scheduledStart: t.scheduled_start, format: t.format, winTarget: t.win_target, ...championFields(t),
      finalOutcomeKind: matchesOf(t.id).find((m) => m.round === 3)?.outcomeKind ?? null,
      placements: reg?.placement ? [{ userId, username: 'e2e_daily_fritz', rating: null, placement: reg.placement, placementLabel: placementLabel(reg.placement), seed: 1, status: reg.status }] : [],
    },
  });
});

// Anything else the app asks for at boot is simply not here.
app.use('/api', (_req, res) => { res.status(404).json({ ok: false, error: 'not_found' }); });

// ── test admin ─────────────────────────────────────────────────────────────

app.post('/__e2e/reset', (req, res) => { reset(req.body ?? {}); res.json({ ok: true }); });
app.post('/__e2e/features', (req, res) => { features = req.body; res.json({ ok: true }); });
app.post('/__e2e/fail-next', (req, res) => { nextFailure[req.body.key] = { status: req.body.status ?? 500, body: req.body.body ?? { error: 'internal' } }; res.json({ ok: true }); });
app.get('/__e2e/state', (_req, res) => {
  res.json({ ok: true, socketLog, counters, matches: [...matches.values()], regs: Object.fromEntries(regs), tournaments: [...tournaments.values()], rooms: [...rooms.values()].map((r) => ({ code: r.code, matchId: r.matchId, sockets: r.sockets.size })) });
});
/** A registered Live Event starts: the bracket is set and the player's Quarterfinal is ready (optionally without the push, as if it was missed). */
app.post('/__e2e/live/:id/start', (req, res) => {
  const t = tournaments.get(req.params.id)!;
  t.status = 'in_progress';
  const reg = regs.get(t.id);
  if (reg) reg.status = 'active';
  seedBracket(t.id, req.body?.opponent === 'human' ? 'u-rival' : `bot:fritz:${t.id}:2`);
  const m = matchesOf(t.id).find((x) => myMatch(x))!;
  if (req.body?.emit !== false) {
    io.emit('tournament:match_ready', {
      tournamentId: t.id, matchId: m.id, round: 1, matchNumber: 1, roomCode: m.room_code, matchStatus: 'ready', readyAt: iso(Date.now()),
      readyDeadlineAt: null, opponentId: m.player2_id, opponentUsername: isBot(m.player2_id) ? 'Fritz' : 'rival', serverNow: iso(Date.now()),
    });
  }
  res.json({ ok: true, matchId: m.id });
});
/** The player had already joined this match (server-side in_progress), e.g. before the app went to the background. */
app.post('/__e2e/match/:id/joined', (req, res) => { const m = matches.get(req.params.id)!; m.joined = true; m.status = 'in_progress'; res.json({ ok: true }); });
app.post('/__e2e/match/:id/decide', (req, res) => {
  decide(req.params.id, req.body.winner, req.body.outcomeKind ?? 'played', req.body.emitReady !== false);
  res.json({ ok: true });
});
app.post('/__e2e/tournament/:id/cancel', (req, res) => {
  const t = tournaments.get(req.params.id)!;
  t.status = 'cancelled';
  emitAll('tournament:cancelled', { tournamentId: t.id, kind: t.kind, status: 'cancelled' });
  res.json({ ok: true });
});
/** The player's consecutive missed turns (what the server's turn clock counts), re-broadcast at once. */
app.post('/__e2e/missed-turns', (req, res) => {
  missedTurns = Number(req.body.count ?? 0);
  for (const room of rooms.values()) broadcast(room);
  res.json({ ok: true });
});
app.post('/__e2e/rival-name', (req, res) => { rivalName = String(req.body.name); res.json({ ok: true }); });
app.post('/__e2e/register-error', (req, res) => {
  nextFailure.register = { status: 409, body: { error: req.body.code, ...(req.body.conflict ? { conflict: req.body.conflict } : {}) } };
  res.json({ ok: true });
});

/** Seat this socket in the room and build the join/attach ack (the server's shape). */
function seatSocket(socket: Socket, room: Room): Record<string, unknown> {
  const m = matches.get(room.matchId)!;
  room.sockets.add(socket.id);
  void socket.join(room.code);
  const opp = (m.player1_id === userId ? m.player2_id : m.player1_id)!;
  const handCounts = Object.fromEntries(room.game.playerIds.map((pid) => [pid, room.game.players[pid].hand.length]));
  return {
    ok: true, tournamentId: m.tournament_id, matchId: m.id, matchStatus: 'in_progress', roomCode: room.code, you: room.humanSeat,
    players: [
      { id: room.humanSeat, username: 'e2e_daily_fritz', userId },
      { id: room.oppSeat, username: isBot(opp) ? botName(m.bot_tier) : rivalName, userId: isBot(opp) ? null : opp },
    ],
    state: { ...mask(room.game, room.humanSeat), handCounts },
    legalMoves: room.game.playerIds[room.game.currentPlayerIndex] === room.humanSeat && !room.game.handOver ? getLegalMoves(room.game, room.humanSeat) : [],
    canDraw: !room.game.handOver && room.game.playerIds[room.game.currentPlayerIndex] === room.humanSeat ? canDraw(room.game, room.humanSeat) : false,
    tournamentMatch: {
      tournamentId: m.tournament_id, matchId: m.id, round: m.round, matchNumber: m.match_number, roomCode: room.code,
      opponentUserId: opp, opponentUsername: isBot(opp) ? botName(m.bot_tier) : rivalName, opponentRating: null,
    },
    matchStarted: true,
    tournamentClock: clockFor(room),
    serverNow: iso(Date.now()),
  };
}

// ── sockets ────────────────────────────────────────────────────────────────

const httpServer = http.createServer(app);
io = new Server(httpServer, { cors: { origin: true, credentials: true } });

io.on('connection', (socket: Socket) => {
  socketLog.push(`connect ${socket.id} ${String(socket.handshake.query?.transport ?? '')}`);
  socket.onAny((event) => { if (socketLog.length < 200) socketLog.push(`event ${socket.id} ${event}`); });
  // Identifying re-seats the player's sockets in their open match room (the
  // client replaces its socket when it switches into the match screen).
  socket.on('presence:identify', (_payload: unknown, ack?: (r: unknown) => void) => {
    for (const room of rooms.values()) {
      const m = matches.get(room.matchId);
      if (m && m.status !== 'completed') {
        room.sockets.add(socket.id);
        void socket.join(room.code);
        // A re-seated socket gets the room's current state (as a rejoin does).
        setTimeout(() => broadcast(room), 0);
      }
    }
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('tournament:attach_assigned_match', (payload: { matchId?: string }, ack?: (r: unknown) => void) => {
    counters.attach += 1;
    const m = payload?.matchId ? matches.get(payload.matchId) : undefined;
    if (!m || !myMatch(m) || m.status === 'completed' || !m.room_code) { ack?.({ ok: false, error: 'match_not_attachable' }); return; }
    const room = openRoom(m);
    m.joined = true; m.status = 'in_progress'; m.started_at ??= iso(Date.now());
    ack?.(seatSocket(socket, room));
  });

  // A reconnecting client rejoins its room (as on the real server).
  socket.on('room:join', (roomCode: string, _identity: unknown, ack?: (r: unknown) => void) => {
    const room = rooms.get(String(roomCode ?? '').toUpperCase());
    if (!room) { ack?.({ ok: false, error: 'room_not_found' }); return; }
    ack?.(seatSocket(socket, room));
  });

  socket.on('game:action', (roomCode: string, action: { type: string; move?: { tile: { high: number; low: number }; position?: string; end?: string } }, ack?: (r: unknown) => void) => {
    const room = rooms.get(String(roomCode).toUpperCase());
    if (!room || room.game.playerIds[room.game.currentPlayerIndex] !== room.humanSeat || room.game.handOver) {
      socketLog.push(`action-refused ${roomCode} room=${Boolean(room)} current=${room?.game.playerIds[room.game.currentPlayerIndex]}`);
      ack?.({ ok: false, error: 'not_your_turn' }); return;
    }
    try {
      if (action.type === 'MOVE' && action.move) {
        const move: Move = { type: 'play', tile: action.move.tile, position: (action.move.position ?? action.move.end ?? 'right') as never };
        room.game = applyMove(room.game, room.humanSeat, move).state;
      } else if (action.type === 'DRAW') {
        room.game = drawOne(room.game, room.humanSeat).state;
      } else {
        room.game = applyMove(room.game, room.humanSeat, { type: 'pass' }).state;
      }
    } catch (err) {
      socketLog.push(`action-error ${roomCode} ${JSON.stringify(action)} ${err instanceof Error ? err.message : ''}`);
      ack?.({ ok: false, error: err instanceof Error ? err.message : 'invalid' });
      return;
    }
    socketLog.push(`action-ok ${room.code} ${action.type} ${JSON.stringify(action.move ?? null)} seq=${room.game.sequence} sockets=${room.sockets.size} hand=${room.game.players[room.humanSeat].hand.length}`);
    ack?.({ ok: true });
    armClock(room);
    broadcast(room);
    setTimeout(() => { opponentTurns(room); broadcast(room); }, 400);
  });

  socket.on('hand:ready', (roomCode: string, _payload: unknown, ack?: (r: unknown) => void) => {
    const room = rooms.get(String(roomCode).toUpperCase());
    if (room && room.game.handOver && !room.game.gameOver) {
      room.game = startNewHand(room.game, undefined, room.humanSeat);
      room.game = { ...room.game, currentPlayerIndex: room.game.playerIds.indexOf(room.humanSeat) };
      armClock(room);
      broadcast(room);
    }
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('disconnect', (reason) => {
    socketLog.push(`disconnect ${socket.id} ${reason}`); for (const room of rooms.values()) room.sockets.delete(socket.id); });
});

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[fake-tournament-backend] listening on ${PORT}`);
});
