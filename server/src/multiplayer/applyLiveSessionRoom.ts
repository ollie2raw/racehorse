import type { GameState } from '../game/types';
import { createDetachedRoom, createReservedRoom, deleteRoom, peekRoom, type Room } from '../rooms';
import type { LiveRosterEntry, RoomLiveSessionRow } from './roomLivePersistence';
import { parseRoomShell } from './roomLivePersistence';
import { createHydratedRoomDurabilityState } from './roomDurability';
import { hydrateGameActionReceiptsForRoom } from './gameActionIdempotency';
import { emitMpAuthorityFunnel } from './mpAuthorityTelemetry';

function cloneGameState(state: GameState): GameState {
  return structuredClone(state) as GameState;
}

/**
 * Materialize an in-memory room from a live-session row (static imports only).
 * Kept separate from `roomLivePersistence.ts` so `rooms.ts` never imports persistence.
 */
function populateRoomFromSession(
  room: Room,
  row: RoomLiveSessionRow,
  shell: ReturnType<typeof parseRoomShell>,
  options: { registerReceipts: boolean },
): void {
  const code = row.room_code.trim().toUpperCase();
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
  if (shell.abandonedForfeitReason) room.abandonedForfeitReason = shell.abandonedForfeitReason;
  if (row.room_shell.durabilityCommit) {
    room.durability = createHydratedRoomDurabilityState(room, row.room_shell.durabilityCommit);
  }
  if (options.registerReceipts && shell.actionReceipts?.length) {
    const restored = hydrateGameActionReceiptsForRoom(code, shell.actionReceipts);
    if (restored > 0) {
      emitMpAuthorityFunnel('private_receipts_hydrated', {
        roomCode: code,
        extra: { restored },
      });
    }
  }
}

/**
 * A room object rebuilt from a TERMINAL session row for completion replay only.
 *
 * It is never registered in the room map, never receives sockets, never installs action
 * receipts and emits no events: completed rooms are not reopened for play, this is just the
 * durable evidence shaped the way the completion pipeline reads it.
 */
export function materializeDetachedRoomFromSession(row: RoomLiveSessionRow): Room {
  const shell = parseRoomShell(row.room_shell);
  const room = createDetachedRoom(row.room_code, shell.config);
  populateRoomFromSession(room, row, shell, { registerReceipts: false });
  return room;
}

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
  try {
    if (!row.room_shell.durabilityCommit) throw new Error('snapshot_missing_commit_fence');
    populateRoomFromSession(room, row, shell, { registerReceipts: true });
  } catch {
    deleteRoom(code);
    return null;
  }

  return { room, restoredRoster: row.roster.map((entry) => ({ ...entry })) };
}
