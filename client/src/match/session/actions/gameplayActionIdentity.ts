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
}): LogicalGameplayAction {
  if (
    params.current?.uncertain &&
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
