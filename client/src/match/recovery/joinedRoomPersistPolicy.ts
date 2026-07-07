import { isTerminalTournamentMatch } from '../../tournament/terminalMatches';
import { shouldPersistLastRoomCode } from './matchRecovery';

export type JoinedRoomPersistContext = {
  joinedRoom: string | null;
  preventAutoRejoin: boolean;
  liveGameOver: boolean | undefined;
  tournamentMatchId: string | null | undefined;
};

export type RoomPersistGateSignals = {
  gameOver: boolean | undefined;
  isTerminalTournamentMatch: boolean;
};

/**
 * Assembles game + tournament gate signals for joined-room localStorage persistence.
 * App.tsx supplies raw cross-domain state; this helper names the coupling explicitly.
 */
export function buildRoomPersistGateSignals(
  context: Pick<JoinedRoomPersistContext, 'liveGameOver' | 'tournamentMatchId'>,
): RoomPersistGateSignals {
  return {
    gameOver: context.liveGameOver,
    isTerminalTournamentMatch: Boolean(
      context.tournamentMatchId && isTerminalTournamentMatch(context.tournamentMatchId),
    ),
  };
}

export function shouldPersistJoinedRoom(context: JoinedRoomPersistContext): boolean {
  const gateSignals = buildRoomPersistGateSignals(context);
  return shouldPersistLastRoomCode({
    joinedRoom: context.joinedRoom,
    preventAutoRejoin: context.preventAutoRejoin,
    gameOver: gateSignals.gameOver,
    isTerminalTournamentMatch: gateSignals.isTerminalTournamentMatch,
  });
}