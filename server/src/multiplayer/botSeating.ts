import { joinRoom } from '../rooms';
import { getRoomRoster, setRoomRoster } from './roomSession';

/**
 * Server bot audit:
 * chooseBotMoveServer(state, botId, opponentKnownMissing, tier?) returns a Move
 * object and does not apply the move directly. The room turn driver reads
 * room.scheduledTournamentBotTier, which is copied from scheduled_tournament_matches.bot_tier.
 */
export function seatSyntheticBotInRoom(roomCode: string, botSeatId: string, label: string): void {
  const room = joinRoom(roomCode, botSeatId);
  const roster = getRoomRoster(roomCode);
  if (roster.some((player) => player.id === botSeatId)) {
    room.matchStartReady.add(botSeatId);
    return;
  }

  setRoomRoster(roomCode, [
    ...roster,
    {
      id: botSeatId,
      socketId: '',
      username: label,
      userId: null,
    },
  ]);
  room.matchStartReady.add(botSeatId);
}
