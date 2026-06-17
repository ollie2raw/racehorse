import type { GameState } from '../game/types';
import { createReservedRoom, peekRoom, type Room } from '../rooms';
import type { LiveRosterEntry, RoomLiveSessionRow } from './roomLivePersistence';
import { parseRoomShell } from './roomLivePersistence';

function cloneGameState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

/**
 * Materialize an in-memory room from a live-session row (static imports only).
 * Kept separate from `roomLivePersistence.ts` so `rooms.ts` never imports persistence.
 */
export function applyLiveSessionRow(
  row: RoomLiveSessionRow,
): { room: Room; restoredRoster: LiveRosterEntry[] } | null {
  const code = row.room_code.trim().toUpperCase();
  const existing = peekRoom(code);
  if (existing) {
    return { room: existing, restoredRoster: row.roster };
  }

  const shell = parseRoomShell(row.room_shell);
  const room = createReservedRoom(code, shell.config);
  room.matchId = row.match_id;
  room.players = [...row.engine_seat_ids];
  room.state = row.game_state ? cloneGameState(row.game_state) : null;
  room.config = shell.config;
  room.asyncStateVersion = shell.asyncStateVersion;
  room.nextHandReady = new Set(shell.nextHandReady);
  room.rematchReady = new Set(shell.rematchReady);
  room.matchStartReady = new Set(shell.matchStartReady);
  room.lastHandEndedNotifiedHand = shell.lastHandEndedNotifiedHand;
  room.lastHandEndedAtMs = shell.lastHandEndedAtMs;
  room.lastBroadcastScores = { ...shell.lastBroadcastScores };
  room.ghostMoveLogs = structuredClone(shell.ghostMoveLogs);
  room.ghostTurnIndex = shell.ghostTurnIndex;
  room.matchLogged = shell.matchLogged;
  room.leadTracker = shell.leadTracker ? { ...shell.leadTracker } : null;
  room.eventLogVersion = 1;
  room.eventSequence = row.last_event_sequence;
  room.events = structuredClone(row.events);
  room.matchmakingMatchId = row.matchmaking_match_id ?? undefined;
  room.scheduledTournamentId = row.scheduled_tournament_id ?? undefined;
  room.scheduledTournamentMatchId = row.scheduled_tournament_match_id ?? undefined;
  if (shell.scheduledTournamentBotTier) {
    room.scheduledTournamentBotTier = shell.scheduledTournamentBotTier;
  }
  if (shell.abandonedAt) room.abandonedAt = shell.abandonedAt;
  if (shell.abandonedByUserId !== undefined) room.abandonedByUserId = shell.abandonedByUserId;
  if (shell.abandonedWinnerUserId !== undefined) {
    room.abandonedWinnerUserId = shell.abandonedWinnerUserId;
  }
  if (shell.abandonedReason) room.abandonedReason = shell.abandonedReason;

  return { room, restoredRoster: row.roster.map((entry) => ({ ...entry })) };
}
