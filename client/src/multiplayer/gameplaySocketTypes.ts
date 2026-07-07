import type { Tile } from '../types';
import type { GameRematchStatusPayload } from './legacyTournamentTypes';

/** Payload shape for live-match `hand:ended` socket handlers. */
export type ConnectionHandEndedPayload = {
  handNumber: number;
  opponentRemainingTiles: Tile[];
  yourRemainingTiles: Tile[];
  pointsAwarded: {
    you: number;
    opponent: number;
  };
  whoWentOut?: string | null;
  winnerId?: string | null;
  handWinnerId?: string | null;
};

/** Live-match gameplay socket delegates — owned by useMultiplayerConnection. */
export type GameplaySocketDelegates = {
  onHandEnded: (payload: ConnectionHandEndedPayload) => void;
  onGameRematchStatus: (payload: GameRematchStatusPayload) => void;
  onGameRematchStarted: () => void;
  onPlayerDragging: (payload: { playerId?: string; dragging?: boolean }) => void;
};

export type GameplaySocketScope = {
  gameplay: GameplaySocketDelegates | null;
};