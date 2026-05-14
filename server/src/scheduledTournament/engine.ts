import type { Server } from 'socket.io';
import { createReservedRoom } from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import { advanceSlot, seedBracket } from './bracket';
import {
  fetchMatchById,
  fetchMatches,
  fetchRegistrations,
  fetchRegistrationsWithProfile,
  fetchTournamentById,
  insertMatch,
  updateMatch,
  updateRegistrationStatus,
  updateTournamentStatus,
} from './persistence';
import type { MatchRow, SeededPlayer } from './types';

const MIN_PLAYERS_TO_START = 4;

/** Roughly 800 = Glicko default for players without a profile rating. */
const DEFAULT_RATING = 800;

function makeTournamentRoomCode(tournamentId: string, round: number, matchNumber: number): string {
  // T-<short>-<round><match> — uppercase, room-code friendly.
  const short = tournamentId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `T${short}R${round}M${matchNumber}`;
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
 * Returns the inserted match rows in canonical order. Throws if < MIN_PLAYERS_TO_START.
 */
export async function generateBracket(
  io: Server,
  tournamentId: string,
): Promise<MatchRow[]> {
  const tournament = await fetchTournamentById(tournamentId);
  if (!tournament) throw new Error('Tournament not found');

  const registrations = await fetchRegistrationsWithProfile(tournamentId);
  const eligible = registrations.filter((r) => r.status === 'registered');
  if (eligible.length < MIN_PLAYERS_TO_START) {
    throw new Error('Not enough players to start');
  }

  const seedInput: SeededPlayer[] = eligible.map((r) => ({
    userId: r.user_id,
    username: r.username ?? r.user_id.slice(0, 6),
    rating: r.rating ?? DEFAULT_RATING,
  }));
  const qfSlots = seedBracket(seedInput);

  // Pre-create all 7 match rows so the bracket is consistent from t=0.
  const insertedQf: MatchRow[] = [];
  for (const slot of qfSlots) {
    const roomCode = makeTournamentRoomCode(tournamentId, 1, slot.matchNumber);
    createReservedRoom(roomCode, { winningScore: tournament.win_target });
    const initialStatus =
      slot.player1 === null || slot.player2 === null ? 'bye' : 'ready';
    const row = await insertMatch({
      tournamentId,
      round: 1,
      matchNumber: slot.matchNumber,
      player1Id: slot.player1?.userId ?? null,
      player2Id: slot.player2?.userId ?? null,
      roomCode,
      status: initialStatus,
    });
    insertedQf.push(row);
  }

  // Empty SF and Final rows (slots fill as winners advance).
  for (let m = 1; m <= 2; m++) {
    const roomCode = makeTournamentRoomCode(tournamentId, 2, m);
    createReservedRoom(roomCode, { winningScore: tournament.win_target });
    await insertMatch({
      tournamentId, round: 2, matchNumber: m,
      player1Id: null, player2Id: null, roomCode, status: 'waiting',
    });
  }
  {
    const roomCode = makeTournamentRoomCode(tournamentId, 3, 1);
    createReservedRoom(roomCode, { winningScore: tournament.win_target });
    await insertMatch({
      tournamentId, round: 3, matchNumber: 1,
      player1Id: null, player2Id: null, roomCode, status: 'waiting',
    });
  }

  // Mark all registered players "active".
  for (const reg of eligible) {
    const idx = eligible.findIndex((r) => r.user_id === reg.user_id);
    await updateRegistrationStatus(tournamentId, reg.user_id, 'active', idx + 1);
  }

  await updateTournamentStatus(tournamentId, 'in_progress');

  // Auto-walkover any bye QFs (player vs null).
  for (const qf of insertedQf) {
    if (qf.status !== 'bye') continue;
    const winnerId = qf.player1_id ?? qf.player2_id;
    if (!winnerId) continue; // both null — shouldn't happen, but defensively skip
    await applyMatchResult(io, {
      matchId: qf.id,
      winnerId,
      player1Score: qf.player1_id === winnerId ? tournament.win_target : 0,
      player2Score: qf.player2_id === winnerId ? tournament.win_target : 0,
      byeWalkover: true,
    });
  }

  // Broadcast.
  io.emit('tournament:bracket_generated', { tournamentId });

  // For each non-bye ready match, notify the two players.
  const matches = await fetchMatches(tournamentId);
  for (const m of matches) {
    if (m.status === 'ready' && m.player1_id && m.player2_id) {
      notifyMatchReady(io, m);
    }
  }

  return matches;
}

/**
 * Mark a tournament-match completed and propagate the winner forward.
 * Idempotent: re-applying the same winner on an already-completed match
 * is a no-op.
 */
export async function applyMatchResult(
  io: Server,
  params: {
    matchId: string;
    winnerId: string;
    player1Score: number;
    player2Score: number;
    byeWalkover?: boolean;
  },
): Promise<void> {
  const match = await fetchMatchById(params.matchId);
  if (!match) throw new Error('Match not found');
  if (match.status === 'completed') return;

  await updateMatch(match.id, {
    status: 'completed',
    winner_id: params.winnerId,
    completed_at: new Date().toISOString(),
    player1_score: params.player1Score,
    player2_score: params.player2Score,
  });

  // Mark loser eliminated (if there was one).
  const loserId =
    match.player1_id === params.winnerId ? match.player2_id :
    match.player2_id === params.winnerId ? match.player1_id : null;
  if (loserId && !params.byeWalkover) {
    await updateRegistrationStatus(match.tournament_id, loserId, 'eliminated');
  }

  if (match.round === 3) {
    // Final — tournament complete.
    await completeTournament(io, match.tournament_id, params.winnerId);
    return;
  }

  // Advance to next round.
  const next = advanceSlot(match.round as 1 | 2, match.match_number);
  const nextMatches = await fetchMatches(match.tournament_id);
  const target = nextMatches.find(
    (m) => m.round === next.nextRound && m.match_number === next.nextMatchNumber,
  );
  if (!target) {
    console.warn('[tournament] no target match for advancement', { matchId: match.id });
    return;
  }
  const patch =
    next.slot === 'player1'
      ? { player1_id: params.winnerId }
      : { player2_id: params.winnerId };

  // Determine the new status of the target after this advancement.
  const otherSlotFilled =
    next.slot === 'player1' ? target.player2_id !== null : target.player1_id !== null;
  const newStatus: MatchRow['status'] = otherSlotFilled ? 'ready' : 'waiting';

  await updateMatch(target.id, { ...patch, status: newStatus });

  // Re-fetch and broadcast.
  const updated = await fetchMatchById(target.id);
  io.emit('tournament:match_updated', { tournamentId: match.tournament_id, matchId: target.id });
  if (updated && updated.status === 'ready') {
    notifyMatchReady(io, updated);
  }
}

export async function completeTournament(
  io: Server,
  tournamentId: string,
  winnerUserId: string,
): Promise<void> {
  await updateTournamentStatus(tournamentId, 'completed', { winner_id: winnerUserId });
  await updateRegistrationStatus(tournamentId, winnerUserId, 'winner');
  io.emit('tournament:completed', { tournamentId, winnerId: winnerUserId });
}

export async function cancelTournament(io: Server, tournamentId: string): Promise<void> {
  await updateTournamentStatus(tournamentId, 'cancelled');
  io.emit('tournament:cancelled', { tournamentId });
}

/**
 * Emit `tournament:match_ready` to both players via Supabase userId → socket
 * presence lookup. Best-effort: if a player is offline, they'll see the
 * match in their bracket view next time they connect.
 */
function notifyMatchReady(io: Server, match: MatchRow): void {
  const sockets = Array.from(io.sockets.sockets.values());
  for (const sock of sockets) {
    const userId: string | undefined = (sock.data as { userId?: string }).userId;
    if (!userId) continue;
    if (userId === match.player1_id || userId === match.player2_id) {
      sock.emit('tournament:match_ready', {
        tournamentId: match.tournament_id,
        matchId: match.id,
        round: match.round,
        matchNumber: match.match_number,
        roomCode: match.room_code,
        opponent: userId === match.player1_id ? match.player2_id : match.player1_id,
      });
    }
  }
}

/** Helper for the scheduler: open registration on a tournament. */
export async function openRegistration(io: Server, tournamentId: string): Promise<void> {
  await updateTournamentStatus(tournamentId, 'registration_open');
  io.emit('tournament:registration_open', { tournamentId });
}

/**
 * Helper for the scheduler: close registration and either start the bracket
 * or cancel if too few players.
 */
export async function closeRegistrationAndStart(
  io: Server,
  tournamentId: string,
): Promise<{ started: boolean; reason?: string }> {
  const regs = await fetchRegistrations(tournamentId);
  const active = regs.filter((r) => r.status === 'registered');
  if (active.length < MIN_PLAYERS_TO_START) {
    await cancelTournament(io, tournamentId);
    return { started: false, reason: 'not_enough_players' };
  }
  await generateBracket(io, tournamentId);
  return { started: true };
}

export const TOURNAMENT_CONFIG = {
  MIN_PLAYERS_TO_START,
  DEFAULT_RATING,
  REGISTRATION_OPEN_LEAD_MIN: 30,
  REGISTRATION_CLOSE_LEAD_MIN: 5,
} as const;

/** Look up the tournament-match record (if any) associated with a room code. */
export async function findTournamentMatchByRoom(roomCode: string): Promise<MatchRow | null> {
  const rows = await supabaseFetch<MatchRow[]>(
    `/rest/v1/scheduled_tournament_matches?select=*&room_code=eq.${encodeURIComponent(roomCode)}&limit=1`,
  );
  return rows[0] ?? null;
}
