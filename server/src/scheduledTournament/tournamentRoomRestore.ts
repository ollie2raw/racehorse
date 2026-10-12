import { childLogger } from '../logger';
import type { Config } from '../game/types';
import { createReservedRoom, deleteRoom, peekRoom, type Room } from '../rooms';
import { ensureRoomHydrated } from '../multiplayer/roomLivePersistence';
import { setRoomRoster } from '../multiplayer/roomSession';
import { syncTournamentTurnClock } from '../multiplayer/tournamentTurnClock';
import { alertTournamentAnomaly } from './tournamentAlerts';

const log = childLogger('tournament:room-restore');

/** Another match's session under this room code (a legacy room-code collision): alert and refuse. */
function refuseForeignSession(code: string, matchId: string, storedMatchId: string): never {
  alertTournamentAnomaly(
    'tournament_foreign_live_session',
    { matchId, roomCode: code },
    { foreignMatchId: storedMatchId, stage: 'restore' },
  );
  throw new Error('tournament_room_session_mismatch');
}

/** One restore-or-create per room code at a time (see restoreOrCreateTournamentRoom). */
const inFlightByRoomCode = new Map<string, Promise<Room>>();

/**
 * The in-memory room for a tournament match, restored from its live session
 * when the process does not hold it (after a restart or redeploy).
 *
 * Dispatch used to create an empty reserved room here. Hydration
 * (`ensureRoomHydrated`) only runs when no room is in memory, so that empty
 * room hid the stored game: the attach then dealt a new one at 0-0.
 *
 *   - stored game in progress → restored, with its roster, so a reattaching
 *     player gets their seat back;
 *   - no stored session, or a pre-game (lobby) one → a fresh reserved room;
 *   - stored session that cannot be trusted (unreadable, uncommitted, invalid,
 *     terminal) or that belongs to another match → throws. A game in progress
 *     is never replaced by an empty room; the caller fails as it would on any
 *     dispatch error, and a later attempt retries.
 *
 * Single-flight per room code: concurrent callers (boot recovery, a scheduler
 * tick, two players attaching) share one restore-or-create and get the same
 * room. Callers only reach this for a match that is not completed (dispatch
 * rejects completed/bye matches and finished tournaments first).
 */
export function restoreOrCreateTournamentRoom(
  roomCode: string,
  matchId: string,
  config: Partial<Config>,
): Promise<Room> {
  const code = roomCode.trim().toUpperCase();
  const inFlight = inFlightByRoomCode.get(code);
  if (inFlight) return inFlight;
  const attempt = restoreOrCreate(code, matchId, config).finally(() => {
    if (inFlightByRoomCode.get(code) === attempt) inFlightByRoomCode.delete(code);
  });
  inFlightByRoomCode.set(code, attempt);
  return attempt;
}

async function restoreOrCreate(code: string, matchId: string, config: Partial<Config>): Promise<Room> {
  const hydrated = await ensureRoomHydrated(code, { expectedTournamentMatchId: matchId });
  switch (hydrated.kind) {
    case 'already_in_memory':
      // Another path (a room:join) may have restored this code's session; if
      // it is another match's room it is not this match's to take over.
      if (hydrated.room.scheduledTournamentMatchId && hydrated.room.scheduledTournamentMatchId !== matchId) {
        refuseForeignSession(code, matchId, hydrated.room.scheduledTournamentMatchId);
      }
      return hydrated.room;
    case 'foreign_tournament_session':
      // Refused before any room was created: nothing to clean up.
      refuseForeignSession(code, matchId, hydrated.storedMatchId);
      break;
    case 'hydrated': {
      // A session naming another match never gets here (refused before
      // publication) unless another path created the room meanwhile: refuse
      // it, and leave that room alone.
      if (hydrated.room.scheduledTournamentMatchId && hydrated.room.scheduledTournamentMatchId !== matchId) {
        refuseForeignSession(code, matchId, hydrated.room.scheduledTournamentMatchId);
      }
      if (hydrated.room.scheduledTournamentMatchId !== matchId) {
        // A legacy session naming no match: not provably this match's game.
        deleteRoom(code);
        log.error(
          { roomCode: code, matchId, storedMatchId: hydrated.room.scheduledTournamentMatchId ?? null },
          'stored live session names no tournament match; not restored',
        );
        throw new Error('tournament_room_session_mismatch');
      }
      if (hydrated.restoredRoster.length > 0) {
        setRoomRoster(
          code,
          hydrated.restoredRoster.map((entry) => ({
            id: entry.seatId,
            socketId: '',
            username: entry.username,
            userId: entry.userId,
          })),
        );
      }
      log.info({ roomCode: code, matchId, handNumber: hydrated.room.state?.handNumber ?? null }, 'restored tournament room from its live session');
      // The turn in progress gets a fresh full timeout: the remaining time is not persisted.
      syncTournamentTurnClock(code);
      return hydrated.room;
    }
    case 'not_found':
    case 'shell_only':
      return peekRoom(code) ?? createReservedRoom(code, config);
    case 'persistence_unavailable':
      throw new Error('room_persistence_unavailable');
    case 'snapshot_freshness_unknown':
      throw new Error('room_snapshot_uncommitted');
    default:
      log.error({ roomCode: code, matchId, kind: hydrated.kind, error: hydrated.error }, 'stored live session not restorable');
      throw new Error(hydrated.error);
  }
}
