import { childLogger } from '../logger';
import type { Server } from 'socket.io';
import { supabaseFetch } from '../supabaseUtils';
import { writeTournamentActivity } from '../social/activityWriter';
import { QF_SEED_PAIRS } from './bracket';
import { defaultEnginePersistence, type EnginePersistence } from './persistenceInterface';
import type { ScheduledTournamentRow } from './types';
import {
  TOURNAMENT_MATCH_READY_WINDOW_MS,
  allHumanPlayersJoined,
  dispatchTournamentMatch,
  isBotOnlyMatch,
  isBotUserId,
} from './matchDispatch';
import type { MatchRow, SeededPlayer } from './types';

const log = childLogger('tournament:engine');

const MIN_HUMANS_TO_START = 1;
const BOT_ID_PREFIX = 'bot:fritz:';
type BotTier = NonNullable<MatchRow['bot_tier']>;
type TournamentEntrant = SeededPlayer & { isBot?: boolean; botTier?: BotTier };

/** Roughly 800 = Glicko default for players without a profile rating. */
const DEFAULT_RATING = 800;

function botTierForRound(round: 1 | 2 | 3): BotTier {
  if (round === 3) return 'master';
  if (round === 2) return 'elite';
  return 'standard';
}

function matchBotTier(round: 1 | 2 | 3, player1Id: string | null, player2Id: string | null): BotTier | null {
  return isBotUserId(player1Id) || isBotUserId(player2Id) ? botTierForRound(round) : null;
}

function buildBotEntrants(tournamentId: string, count: number): TournamentEntrant[] {
  return Array.from({ length: count }, (_, idx) => ({
    userId: `${BOT_ID_PREFIX}${tournamentId}:${idx + 1}`,
    username: 'Fritz',
    rating: 0,
    isBot: true,
    botTier: 'standard',
  }));
}

function buildOrderedEntrants(
  tournamentId: string,
  maxPlayers: number,
  registrations: Array<{ user_id: string; username: string | null; rating: number | null }>,
): TournamentEntrant[] {
  const humans = registrations
    .map((r, idx) => ({
      userId: r.user_id,
      username: r.username ?? r.user_id.slice(0, 6),
      rating: r.rating ?? DEFAULT_RATING,
      _origIdx: idx,
    }))
    .sort((a, b) => b.rating - a.rating || a._origIdx - b._origIdx)
    .map(({ _origIdx, ...entry }) => entry);
  return [...humans, ...buildBotEntrants(tournamentId, Math.max(0, maxPlayers - humans.length))];
}

function seedBracketFromOrderedEntrants(entrants: TournamentEntrant[]) {
  if (entrants.length < 4) {
    throw new Error('Tournament requires at least 4 entrants');
  }
  if (entrants.length > 8) {
    throw new Error('Tournament caps at 8 players');
  }
  const padded: Array<TournamentEntrant | null> = [...entrants];
  while (padded.length < 8) padded.push(null);
  return QF_SEED_PAIRS.map(([s1, s2], i) => ({
    matchNumber: i + 1,
    player1: padded[s1 - 1],
    player2: padded[s2 - 1],
  }));
}

export function placementLabelForRank(placement: number | null): string | null {
  if (placement == null) return null;
  if (placement === 1) return 'Champion';
  if (placement === 2) return 'Runner-up';
  if (placement === 3) return 'Semifinalist';
  if (placement === 5) return 'Quarterfinalist';
  const mod10 = placement % 10;
  const mod100 = placement % 100;
  let suffix = 'th';
  if (mod10 === 1 && mod100 !== 11) suffix = 'st';
  else if (mod10 === 2 && mod100 !== 12) suffix = 'nd';
  else if (mod10 === 3 && mod100 !== 13) suffix = 'rd';
  return `${placement}${suffix} Place`;
}

function emitToUserIds(io: Server, userIds: Array<string | null | undefined>, event: string, payload: unknown): void {
  const targets = new Set(userIds.filter((userId): userId is string => Boolean(userId) && !isBotUserId(userId)));
  if (targets.size === 0) return;
  for (const sock of io.sockets.sockets.values()) {
    const userId: string | undefined = (sock.data as { userId?: string }).userId;
    if (!userId || !targets.has(userId)) continue;
    sock.emit(event, payload);
  }
}

async function selectHigherSeedWinner(
  tournamentId: string,
  player1Id: string,
  player2Id: string,
  persistence: EnginePersistence,
): Promise<string> {
  const regs = await persistence.fetchRegistrations(tournamentId);
  const player1Seed = regs.find((reg) => reg.user_id === player1Id)?.seed ?? Number.POSITIVE_INFINITY;
  const player2Seed = regs.find((reg) => reg.user_id === player2Id)?.seed ?? Number.POSITIVE_INFINITY;
  return player1Seed <= player2Seed ? player1Id : player2Id;
}

function playerNoShowReason(match: MatchRow, noShowUserId: string | null): string {
  if (!noShowUserId) return 'double_no_show';
  if (match.player1_id === noShowUserId) return 'player1_no_show';
  if (match.player2_id === noShowUserId) return 'player2_no_show';
  return 'no_show';
}

function isTournamentPlayable(
  tournament: { scheduled_start: string },
  now: Date = new Date(),
): boolean {
  return Date.parse(tournament.scheduled_start) <= now.getTime();
}

/**
 * A round-N match is fed by exactly two round-(N-1) matches: numbers 2M-1 and
 * 2M, where M is this match's number (SF1 ← QF1+QF2, SF2 ← QF3+QF4, F ← SF1+SF2).
 *
 * This is the bracket-exact gate (invariant T-INV-6). It is deliberately NOT
 * "the whole previous round is done" — SF1 may resolve while QF3/QF4 still play.
 * For human matches this is already how advancement works (a target reaches
 * `ready` only once both its slots are filled); this function applies the same
 * rule to bot-only auto-simulation, where there is no advancement trigger.
 */
async function areFeederMatchesComplete(
  tournamentId: string,
  round: 1 | 2 | 3,
  matchNumber: number,
  persistence: EnginePersistence,
): Promise<boolean> {
  if (round <= 1) return true;
  const feederNumbers = [matchNumber * 2 - 1, matchNumber * 2];
  const matches = await persistence.fetchMatches(tournamentId);
  const feeders = matches.filter(
    (m) => m.round === round - 1 && feederNumbers.includes(m.match_number),
  );
  if (feeders.length < 2) return false;
  return feeders.every((m) => m.status === 'completed' || m.status === 'bye');
}

/** Bot-vs-bot matches only auto-resolve after scheduled_start and once both feeder matches have finished. */
async function canAutoSimulateBotOnlyMatch(
  match: MatchRow,
  persistence: EnginePersistence,
  now: Date = new Date(),
): Promise<boolean> {
  const tournament = await persistence.fetchTournamentById(match.tournament_id);
  if (!tournament) return false;
  if (!isTournamentPlayable(tournament, now)) return false;
  if (!match.player1_id || !match.player2_id) return false;
  if (!isBotOnlyMatch(match)) return false;
  return areFeederMatchesComplete(
    match.tournament_id,
    match.round as 1 | 2 | 3,
    match.match_number,
    persistence,
  );
}

async function resolveBotOnlyMatch(
  io: Server,
  match: MatchRow,
  persistence: EnginePersistence,
  now: Date = new Date(),
): Promise<boolean> {
  if (!(await canAutoSimulateBotOnlyMatch(match, persistence, now))) return false;
  if (!match.player1_id || !match.player2_id) return false;
  if (!isBotOnlyMatch(match)) {
    if (isBotUserId(match.player1_id) || isBotUserId(match.player2_id)) {
      log.info({
        matchId: match.id,
        player1Id: match.player1_id,
        player2Id: match.player2_id,
      }, 'skipped auto-resolve because human participant exists');
    }
    return false;
  }
  if (match.status === 'completed' || match.status === 'bye') return false;
  const tournament = await persistence.fetchTournamentById(match.tournament_id);
  if (!tournament) return false;

  const winnerId = await selectHigherSeedWinner(
    match.tournament_id,
    match.player1_id,
    match.player2_id,
    persistence,
  );
  log.info({
    matchId: match.id,
    winnerId,
  }, 'auto-resolved bot-vs-bot');

  // `complete_tournament_match` only accepts a match in `ready`/`in_progress`
  // (state-machine transition T-f). A bot pair may still be `waiting` when a
  // reconcile/dispatch tick reaches it — promote it first.
  if (match.status === 'waiting') {
    await persistence.promoteTournamentMatch(match.id, 'ready', {
      readyAt: now.toISOString(),
      actor: 'bot_simulated',
    });
  }

  await applyMatchResult(io, {
    matchId: match.id,
    winnerId,
    player1Score: match.player1_id === winnerId ? tournament.win_target : 0,
    player2Score: match.player2_id === winnerId ? tournament.win_target : 0,
    winnerSource: 'game_over',
    statusReason: 'bot_simulated',
  }, persistence);
  return true;
}

async function writeTournamentCompletionActivity(
  tournamentId: string,
  placements: Array<{ userId: string; placement: number }>,
): Promise<void> {
  await Promise.all(
    placements.map(({ userId, placement }) =>
      writeTournamentActivity({
        userId,
        placement: placementLabelForRank(placement) ?? 'Tournament result',
        tournamentId,
      }),
    ),
  );
}

/**
 * Generate the full bracket for a tournament that's just hit start time.
 *
 *  1. Fetch registrations + profile ratings
 *  2. Seed players (highest rating = seed 1)
 *  3. Create 4 QF rows + 2 SF rows + 1 Final row (all rooms reserved)
 *  4. Auto-advance any QF that has a bye (player vs null) → the human wins by walkover
 *  5. Update tournament status to in_progress; emit bracket_generated
 *
 * `persistence` is injectable for tests; production passes nothing and gets
 * the real Supabase + in-memory rooms implementation.
 */
export async function generateBracket(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
  providedEntrants?: TournamentEntrant[],
): Promise<MatchRow[]> {
  const tournament = await persistence.fetchTournamentById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');

  const existingMatches = await persistence.fetchMatches(tournamentId);
  if (existingMatches.length > 0) {
    return existingMatches;
  }

  const registrations = await persistence.fetchRegistrationsWithProfile(tournamentId);
  const eligible = registrations.filter((r) => r.status === 'registered');
  if (eligible.length < MIN_HUMANS_TO_START) {
    throw new Error('Not enough players to start');
  }

  const seedInput = providedEntrants ?? buildOrderedEntrants(tournamentId, tournament.max_players, eligible);
  const qfSlots = seedBracketFromOrderedEntrants(seedInput);

  // Pre-create all 7 match rows so the bracket is consistent from t=0.
  const insertedQf: MatchRow[] = [];
  for (const slot of qfSlots) {
    const initialStatus =
      slot.player1 === null || slot.player2 === null ? 'bye' : 'waiting';
    const row = await persistence.insertMatch({
      tournamentId,
      round: 1,
      matchNumber: slot.matchNumber,
      player1Id: slot.player1?.userId ?? null,
      player2Id: slot.player2?.userId ?? null,
      roomCode: '',
      status: initialStatus,
      botTier: matchBotTier(1, slot.player1?.userId ?? null, slot.player2?.userId ?? null),
    });
    insertedQf.push(row);
  }

  // Empty SF and Final rows (slots fill as winners advance).
  for (let m = 1; m <= 2; m++) {
    await persistence.insertMatch({
      tournamentId, round: 2, matchNumber: m,
      player1Id: null, player2Id: null, roomCode: '', status: 'waiting', botTier: null,
    });
  }
  {
    await persistence.insertMatch({
      tournamentId, round: 3, matchNumber: 1,
      player1Id: null, player2Id: null, roomCode: '', status: 'waiting', botTier: null,
    });
  }

  // Mark all registered players "active".
  for (const [idx, reg] of eligible.entries()) {
    await persistence.updateRegistrationStatus(tournamentId, reg.user_id, 'active', idx + 1);
  }

  await persistence.updateTournamentStatus(tournamentId, 'in_progress');

  // Auto-walkover any bye QFs (player vs null).
  for (const qf of insertedQf) {
    if (qf.status !== 'bye') continue;
    const winnerId = qf.player1_id ?? qf.player2_id;
    if (!winnerId) continue;
    await applyMatchResult(io, {
      matchId: qf.id,
      winnerId,
      player1Score: qf.player1_id === winnerId ? tournament.win_target : 0,
      player2Score: qf.player2_id === winnerId ? tournament.win_target : 0,
      byeWalkover: true,
    }, persistence);
  }

  // Broadcast — rooms dispatch at scheduled_start (humans) or immediately for bot-only pairs.
  io.emit('tournament:bracket_generated', { tournamentId });

  return persistence.fetchMatches(tournamentId);
}

/**
 * At scheduled_start, resolve bot-only quarterfinals that do not involve humans.
 * Later-round bot-only matches wait until the previous round is fully complete.
 */
export async function resolveWaitingBotOnlyQuarterfinals(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
  now: Date = new Date(),
): Promise<number> {
  const tournament = await persistence.fetchTournamentById(tournamentId);
  if (!tournament || !isTournamentPlayable(tournament, now)) return 0;

  const matches = await persistence.fetchMatches(tournamentId);
  let resolved = 0;
  for (const match of matches) {
    if (match.round !== 1) continue;
    if (match.status === 'completed' || match.status === 'bye') continue;
    if (!isBotOnlyMatch(match)) continue;
    const fresh = await persistence.fetchMatchById(match.id);
    if (fresh && (await resolveBotOnlyMatch(io, fresh, persistence, now))) {
      resolved += 1;
    }
  }
  if (resolved > 0) {
    log.info({
      tournamentId,
      resolved,
    }, 'resolved waiting quarterfinal bot pairs');
  }
  return resolved;
}

function matchHasHuman(match: Pick<MatchRow, 'player1_id' | 'player2_id'>): boolean {
  return !isBotOnlyMatch(match);
}

/**
 * At scheduled_start, dispatch waiting matches that involve at least one human.
 * Idempotent: skips matches already ready/in_progress/completed.
 */
export async function dispatchScheduledStartMatches(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
  now: Date = new Date(),
): Promise<number> {
  const tournament = await persistence.fetchTournamentById(tournamentId);
  if (!tournament || tournament.status !== 'in_progress') return 0;
  if (Date.parse(tournament.scheduled_start) > now.getTime()) return 0;

  const matches = await persistence.fetchMatches(tournamentId);
  let dispatched = 0;
  for (const match of matches) {
    if (!match.player1_id || !match.player2_id) continue;
    if (match.status === 'completed' || match.status === 'bye') continue;
    if (!matchHasHuman(match)) continue;
    if (match.status === 'ready' || match.status === 'in_progress') continue;
    if (match.status !== 'waiting') continue;
    await dispatchTournamentMatch(io, match.id, { reason: 'bracket_generated', now }, persistence);
    if (isBotUserId(match.player1_id) || isBotUserId(match.player2_id)) {
      log.info({
        tournamentId,
        matchId: match.id,
      }, 'human-vs-bot playable match ready');
    }
    dispatched += 1;
    const updated = await persistence.fetchMatchById(match.id);
    if (updated) {
      await resolveBotOnlyMatch(io, updated, persistence, now);
    }
  }
  const botResolved = await resolveWaitingBotOnlyQuarterfinals(io, tournamentId, persistence, now);
  if (dispatched > 0 || botResolved > 0) {
    log.info({ tournamentId, dispatched, botResolved }, 'scheduled_start batch');
  }
  return dispatched;
}

/**
 * Record a tournament-match result and propagate the winner forward.
 *
 * All of the state change — completion, participant + score validation, loser
 * elimination, bracket advancement, and (for the final) tournament completion —
 * happens inside ONE Postgres transaction via `complete_tournament_match`,
 * which locks the match row `FOR UPDATE`. Concurrent producers for the same
 * match therefore serialise at the DB: the first writes, the rest come back
 * with `applied: false`. This function is now just: call the RPC, then emit
 * sockets / dispatch the advanced match from its structured result.
 *
 * Idempotent: re-submitting the same winner on a completed match is a no-op.
 * A *different* winner on a completed match returns `conflict: true`; we accept
 * the recorded outcome and log it (should be impossible — see T-INV-2 / D-3).
 */
export async function applyMatchResult(
  io: Server,
  params: {
    matchId: string;
    winnerId: string;
    player1Score: number;
    player2Score: number;
    byeWalkover?: boolean;
    winnerSource?: 'game_over' | 'no_show' | 'forfeit';
    statusReason?: string | null;
    noShowUserId?: string | null;
    forfeitUserId?: string | null;
  },
  persistence: EnginePersistence = defaultEnginePersistence,
): Promise<void> {
  const match = await persistence.fetchMatchById(params.matchId);
  if (!match) throw new Error('Match not found');

  const result = await persistence.completeTournamentMatch({
    matchId: match.id,
    winnerId: params.winnerId,
    winnerSource: params.winnerSource ?? (params.byeWalkover ? null : 'game_over'),
    statusReason: params.statusReason ?? null,
    reportedPlayer1Score: params.player1Score,
    reportedPlayer2Score: params.player2Score,
    noShowUserId: params.noShowUserId ?? null,
    forfeitUserId: params.forfeitUserId ?? null,
    byeWalkover: params.byeWalkover ?? false,
    actor: params.winnerSource ?? (params.byeWalkover ? 'bye_walkover' : 'game_over'),
  });

  if (!result.applied) {
    if (result.conflict) {
      // T-INV-3 / Decisions D-3: a genuine winner disagreement between two
      // producers should be impossible if the participant check and the state
      // machine are correct. Not fatal — we take the RPC's recorded answer —
      // but it must be greppable/alertable in production if it ever happens.
      log.warn({
        event: 'tournament_match_winner_conflict',
        matchId: match.id,
        tournamentId: match.tournament_id,
        recordedWinnerId: result.winner_id,
        attemptedWinnerId: params.winnerId,
        attemptedSource: params.winnerSource ?? 'game_over',
      }, 'tournament_match_winner_conflict');
    } else {
      log.info({
        matchId: match.id,
        tournamentId: match.tournament_id,
        winnerId: params.winnerId,
      }, 'result already applied by a concurrent writer');
    }
    return;
  }

  // ── this call is the one that completed the match ──
  emitToUserIds(io, [match.player1_id, match.player2_id], 'tournament:match_completed', {
    tournamentId: match.tournament_id,
    matchId: match.id,
    round: match.round,
    roomCode: match.room_code,
    winnerId: result.winner_id,
    winnerSource: result.winner_source ?? 'game_over',
  });

  if (result.round_now_complete) {
    const regs = await persistence.fetchRegistrations(match.tournament_id);
    emitToUserIds(io, regs.map((reg) => reg.user_id), 'tournament:round_completed', {
      tournamentId: match.tournament_id,
      round: match.round,
    });
  }

  if (result.tournament_completed) {
    await finalizeCompletedTournament(
      io,
      match.tournament_id,
      result.winner_id ?? params.winnerId,
      result.placements ?? [],
    );
    return;
  }

  if (result.advanced_to_match_id) {
    log.info({
      fromMatchId: match.id,
      nextMatchId: result.advanced_to_match_id,
      slot: result.advanced_to_slot,
      winnerId: result.winner_id,
    }, 'winner advanced');
    io.emit('tournament:match_updated', {
      tournamentId: match.tournament_id,
      matchId: result.advanced_to_match_id,
    });
    if (result.advanced_to_status === 'ready') {
      await dispatchTournamentMatch(
        io,
        result.advanced_to_match_id,
        { reason: 'winner_advanced' },
        persistence,
      );
      const refreshed = await persistence.fetchMatchById(result.advanced_to_match_id);
      if (refreshed) {
        await resolveBotOnlyMatch(io, refreshed, persistence, new Date());
      }
    }
  }
}

/**
 * After `complete_tournament_match` has finished the round-3 match, the DB
 * transaction has already written: every placement, the tournament's
 * `status='completed'` + `winner_id`, and the champion's registration
 * `status='winner'`. All that's left is the two side effects the RPC can't do:
 * the social activity feed and the `tournament:completed` broadcast.
 */
async function finalizeCompletedTournament(
  io: Server,
  tournamentId: string,
  winnerUserId: string,
  placements: Array<{ user_id: string; placement: number }>,
): Promise<void> {
  await writeTournamentCompletionActivity(
    tournamentId,
    placements
      .filter((p) => !isBotUserId(p.user_id))
      .map((p) => ({ userId: p.user_id, placement: p.placement })),
  );
  log.info({ tournamentId, winnerId: winnerUserId }, 'champion');
  io.emit('tournament:completed', { tournamentId, winnerId: winnerUserId });
}

export async function cancelTournament(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
): Promise<void> {
  await persistence.updateTournamentStatus(tournamentId, 'cancelled');
  io.emit('tournament:cancelled', { tournamentId });
}

/** Helper for the scheduler: open registration on a tournament. */
export async function openRegistration(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
): Promise<void> {
  await persistence.updateTournamentStatus(tournamentId, 'registration_open');
  io.emit('tournament:registration_open', { tournamentId });
}

/**
 * Helper for the scheduler: close registration and either start the bracket
 * or cancel if too few players.
 */
export async function closeRegistrationAndStart(
  io: Server,
  tournamentId: string,
  persistence: EnginePersistence = defaultEnginePersistence,
): Promise<{ started: boolean; reason?: string }> {
  const regs = await persistence.fetchRegistrations(tournamentId);
  const active = regs.filter((r) => r.status === 'registered');
  if (active.length < MIN_HUMANS_TO_START) {
    await cancelTournament(io, tournamentId, persistence);
    return { started: false, reason: 'not_enough_players' };
  }
  const tournament = await persistence.fetchTournamentById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');
  const regsWithProfile = await persistence.fetchRegistrationsWithProfile(tournamentId);
  const eligible = regsWithProfile.filter((r) => r.status === 'registered');
  const entrants = buildOrderedEntrants(tournamentId, tournament.max_players, eligible);
  await generateBracket(io, tournamentId, persistence, entrants);
  return { started: true };
}

/**
 * Single-instance first-release reconciliation for expired ready matches.
 *
 * This uses DB-persisted `ready_deadline_at` values and polling instead of
 * process-local timers so it survives restarts. Before multi-instance scale,
 * this must move behind a DB lease/lock so only one worker resolves deadlines.
 */
export async function reconcileExpiredReadyMatches(
  io: Server,
  now: Date = new Date(),
  persistence: EnginePersistence = defaultEnginePersistence,
  /**
   * In-progress tournaments the caller already read. The scheduler tick
   * fetches exactly this set immediately before calling here, so without it
   * the same query runs twice every 30 seconds — 2,880 duplicates a day,
   * players or no players. Omit it and the standalone read still happens.
   */
  inProgressTournaments?: ScheduledTournamentRow[],
): Promise<number> {
  const tournaments = inProgressTournaments
    ?? (persistence.fetchTournamentsByStatus
      ? await persistence.fetchTournamentsByStatus(['in_progress'])
      : []);
  let resolvedCount = 0;
  for (const tournament of tournaments) {
    const matches = await persistence.fetchMatches(tournament.id);
    for (const match of matches) {
      if (match.status !== 'ready' || !match.ready_deadline_at) continue;
      if (Date.parse(tournament.scheduled_start) > now.getTime()) continue;
      if (await resolveBotOnlyMatch(io, match, persistence, now)) {
        resolvedCount += 1;
        continue;
      }
      if (Date.parse(match.ready_deadline_at) >= now.getTime()) continue;
      if (!match.player1_id || !match.player2_id) continue;
      if (allHumanPlayersJoined(match) && match.room_code) {
        try {
          const room = persistence.getRoom(match.room_code);
          if (room.state) {
            await persistence.updateMatch(match.id, {
              status: 'in_progress',
              started_at: match.started_at ?? now.toISOString(),
              status_reason: null,
            });
            continue;
          }
        } catch {
          /* room missing — fall through to no-show resolution */
        }
      }

      const hasHumanPlayer = !isBotOnlyMatch(match);
      if (hasHumanPlayer && match.room_code) {
        try {
          persistence.getRoom(match.room_code);
        } catch {
          await dispatchTournamentMatch(io, match.id, { reason: 'repair', emitIfAlreadyReady: true }, persistence);
          await persistence.updateMatch(match.id, {
            ready_deadline_at: new Date(now.getTime() + TOURNAMENT_MATCH_READY_WINDOW_MS).toISOString(),
            status_reason: 'room_rehydrated_deadline_extended',
          });
          log.info({
            matchId: match.id,
            roomCode: match.room_code,
          }, 'ready room missing; rehydrated before no-show');
          continue;
        }
      }

      let winnerId: string;
      let noShowUserId: string | null = null;
      if (match.player1_joined_at && !match.player2_joined_at) {
        winnerId = match.player1_id;
        noShowUserId = match.player2_id;
      } else if (match.player2_joined_at && !match.player1_joined_at) {
        winnerId = match.player2_id;
        noShowUserId = match.player1_id;
      } else if (isBotUserId(match.player1_id) && !isBotUserId(match.player2_id)) {
        winnerId = match.player2_id;
      } else if (isBotUserId(match.player2_id) && !isBotUserId(match.player1_id)) {
        winnerId = match.player1_id;
      } else {
        winnerId = await selectHigherSeedWinner(
          match.tournament_id,
          match.player1_id,
          match.player2_id,
          persistence,
        );
      }

      log.info({
        matchId: match.id,
        userId: noShowUserId,
        reason: playerNoShowReason(match, noShowUserId),
      }, 'marking loss');

      await applyMatchResult(
        io,
        {
          matchId: match.id,
          winnerId,
          player1Score: match.player1_id === winnerId ? tournament.win_target : 0,
          player2Score: match.player2_id === winnerId ? tournament.win_target : 0,
          winnerSource: 'no_show',
          statusReason: noShowUserId
            ? playerNoShowReason(match, noShowUserId)
            : 'double_no_show_higher_seed_advanced',
          noShowUserId,
        },
        persistence,
      );
      resolvedCount += 1;
    }
  }
  return resolvedCount;
}

export const TOURNAMENT_CONFIG = {
  MIN_HUMANS_TO_START,
  DEFAULT_RATING,
  REGISTRATION_OPEN_LEAD_MIN: 30,
  REGISTRATION_CLOSE_LEAD_MIN: 2,
} as const;

/** Registration window timestamps aligned with seed SQL and TOURNAMENT_CONFIG. */
export function computeTournamentRegistrationTimestamps(scheduledStartMs: number): {
  registration_open_at: string;
  registration_close_at: string;
} {
  const { REGISTRATION_OPEN_LEAD_MIN, REGISTRATION_CLOSE_LEAD_MIN } = TOURNAMENT_CONFIG;
  return {
    registration_open_at: new Date(scheduledStartMs - REGISTRATION_OPEN_LEAD_MIN * 60_000).toISOString(),
    registration_close_at: new Date(scheduledStartMs - REGISTRATION_CLOSE_LEAD_MIN * 60_000).toISOString(),
  };
}

export function isTournamentRegistrationWindowOpen(input: {
  status: string;
  registration_close_at: string;
  nowMs: number;
}): boolean {
  return input.status === 'registration_open' && input.nowMs < Date.parse(input.registration_close_at);
}

export function isTournamentBracketLobbyPhase(input: {
  registration_close_at: string;
  scheduled_start: string;
  nowMs: number;
}): boolean {
  const closeMs = Date.parse(input.registration_close_at);
  const startMs = Date.parse(input.scheduled_start);
  return input.nowMs >= closeMs && input.nowMs < startMs;
}

/**
 * Apply tournament match result after multiplayer game-over.
 * Uses in-memory match id when present; otherwise resolves by room code in DB.
 */
export async function applyTournamentGameOverFromRoom(
  io: Server,
  room: { code: string; scheduledTournamentMatchId?: string; scheduledTournamentId?: string | null },
  params: {
    winnerUserId: string;
    player1Score: number;
    player2Score: number;
  },
  persistence: EnginePersistence = defaultEnginePersistence,
  lookupMatchByRoom: (code: string) => Promise<MatchRow | null> = findTournamentMatchByRoom,
): Promise<boolean> {
  let matchId = room.scheduledTournamentMatchId ?? null;
  if (!matchId && room.code) {
    const byRoom = await lookupMatchByRoom(room.code);
    if (byRoom) {
      matchId = byRoom.id;
      log.info({
        roomCode: room.code,
        matchId,
        tournamentId: byRoom.tournament_id,
      }, 'resolved match by room code');
    }
  }
  if (!matchId) {
    log.warn({
      roomCode: room.code,
      scheduledTournamentMatchId: room.scheduledTournamentMatchId ?? null,
    }, 'no tournament match for room');
    return false;
  }
  log.info({
    roomCode: room.code,
    matchId,
    tournamentId: room.scheduledTournamentId ?? null,
    winnerId: params.winnerUserId,
    scores: { player1: params.player1Score, player2: params.player2Score },
  }, 'applying result');
  await applyMatchResult(
    io,
    {
      matchId,
      winnerId: params.winnerUserId,
      player1Score: params.player1Score,
      player2Score: params.player2Score,
    },
    persistence,
  );
  return true;
}

/** Look up the tournament-match record (if any) associated with a room code. */
export async function findTournamentMatchByRoom(roomCode: string): Promise<MatchRow | null> {
  const rows = await supabaseFetch<MatchRow[]>(
    `/rest/v1/scheduled_tournament_matches?select=*&room_code=eq.${encodeURIComponent(roomCode)}&limit=1`,
  );
  return rows[0] ?? null;
}
