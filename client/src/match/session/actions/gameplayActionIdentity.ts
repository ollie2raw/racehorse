import type { GameState, PlacementPosition, Tile } from '../../../types';
import { nextGameActionRequestId } from '../../../multiplayer/drawAudit';

export type LogicalGameplayActionKind = 'draw' | 'pass' | 'move';

export type LogicalGameplayAction = {
  kind: LogicalGameplayActionKind;
  requestId: string;
  roomCode: string;
  playerId: string;
  baselineSequence: number;
  handNumber: number;
  signature: string;
  uncertain: boolean;
  /** Match (room generation) this command was created for; every retry of it carries the same one. */
  matchId: string | null;
};

export function buildLogicalActionSignature(params: {
  kind: LogicalGameplayActionKind;
  roomCode: string;
  playerId: string;
  baselineSequence: number;
  handNumber: number;
  tile?: Tile | null;
  position?: PlacementPosition | null;
}): string {
  const tilePart = params.tile ? `${params.tile.low}-${params.tile.high}` : '';
  const positionPart = params.position ?? '';
  return [
    params.roomCode.trim().toUpperCase(),
    params.playerId,
    params.kind,
    params.baselineSequence,
    params.handNumber,
    tilePart,
    positionPart,
  ].join('|');
}

export function resolveLogicalActionRequestId(params: {
  current: LogicalGameplayAction | null;
  kind: LogicalGameplayActionKind;
  roomCode: string;
  playerId: string;
  baselineSequence: number;
  handNumber: number;
  signature: string;
  /** Authoritative current match id at the moment the command is created (null = not known yet). */
  matchId?: string | null;
}): LogicalGameplayAction {
  const matchId = params.matchId ?? null;
  if (
    params.current?.uncertain &&
    // A retry keeps its own match id. It is only NOT a retry when we positively know another match.
    (matchId === null || params.current.matchId === null || params.current.matchId === matchId) &&
    params.current.kind === params.kind &&
    params.current.roomCode === params.roomCode.trim().toUpperCase() &&
    params.current.playerId === params.playerId &&
    params.current.baselineSequence === params.baselineSequence &&
    params.current.handNumber === params.handNumber &&
    params.current.signature === params.signature
  ) {
    return params.current;
  }

  return {
    kind: params.kind,
    requestId: nextGameActionRequestId(params.kind),
    roomCode: params.roomCode.trim().toUpperCase(),
    playerId: params.playerId,
    baselineSequence: params.baselineSequence,
    handNumber: params.handNumber,
    signature: params.signature,
    uncertain: false,
    matchId,
  };
}

export function shouldClearLogicalActionForState(
  action: LogicalGameplayAction | null,
  state: GameState | null,
  roomCode: string | null,
): boolean {
  if (!action) return false;
  if (!state) return true;
  if (!roomCode || roomCode.trim().toUpperCase() !== action.roomCode) return true;
  if (state.handNumber !== action.handNumber) return true;
  if (state.gameOver || state.handOver) return true;
  return state.sequence > action.baselineSequence;
}
