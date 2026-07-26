import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { Tile } from '../../types.ts';

export type PlacementClickBlockReason =
  | 'current-player-not-you'
  | 'placement-in-flight'
  | 'no-selected-tile'
  | 'hand-over'
  | 'game-over'
  | 'no-matching-move';

export function getPlacementClickBlockReason(
  match: BotMatchState,
  selectedTile: Tile | null,
  hasMatchingMove: boolean,
  placementInFlight = false,
): PlacementClickBlockReason | null {
  if (match.currentPlayer !== 'you') return 'current-player-not-you';
  if (placementInFlight) return 'placement-in-flight';
  if (!selectedTile) return 'no-selected-tile';
  if (match.handOver) return 'hand-over';
  if (match.gameOver) return 'game-over';
  if (!hasMatchingMove) return 'no-matching-move';
  return null;
}
