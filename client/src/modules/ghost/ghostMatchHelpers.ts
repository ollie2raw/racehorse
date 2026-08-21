import type { MoveEntry } from '../../game/moveLogger.ts';
import { serializeGhostBoardState } from '../../ghost/logic.ts';
import type { GhostMoveLogEntry } from './ghostContracts.ts';

export function getGhostResultMessage(playerScore: number, ghostScore: number): string {
  const margin = playerScore - ghostScore;
  if (margin >= 15) return "You've outgrown your ghost.";
  if (margin >= 1) return 'Closer than it looks. Ghost is watching.';
  if (margin <= -15) return "Ghost didn't even break a sweat.";
  return 'Your ghost remembers this.';
}

export function roundedRatingDelta(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function formatRatingDelta(value: number): string {
  if (value === 0) return 'No change';
  return `${value > 0 ? '+' : ''}${value}`;
}

/**
 * The placement side a move was actually played on.
 *
 * `MoveEntry.position` is the authoritative value: the runtime records it from
 * the move it hands to `applyPlayMove`. `MoveEntry.boardState` is snapshotted
 * BEFORE the move is applied (see `collectPlayerMoveSnapshot` in
 * usePlayerPlacementHandler.ts / useBotTurn), so it never contains the tile that
 * was just played — reconstructing the side from it silently degraded every
 * placement to 'left' and made the server's ranked replay reject the match with
 * "Illegal move: [a|b] on left does not match the board (...)".
 */
function placementBranchForEntry(entry: MoveEntry): string | null {
  if (entry.action === 'draw') return 'draw';
  if (entry.action === 'pass') return 'pass';
  if (entry.action !== 'place' || !entry.tile) return null;
  if (entry.position) return entry.position;
  // Legacy entries with no recorded position: keep the old lookup so their
  // behaviour is unchanged. It resolves only if the pre-move snapshot happens
  // to contain the tile, which is why it degraded to 'left' in the first place.
  return (
    entry.boardState.find(
      (s) => s.tile[0] === entry.tile![0] && s.tile[1] === entry.tile![1],
    )?.position ?? 'left'
  );
}

export function moveEntriesToGhostMoveLog(entries: MoveEntry[]): GhostMoveLogEntry[] {
  return entries.map((entry) => ({
    turn: entry.moveNumber,
    actor: entry.player === 'you' ? 'you' : 'ghost',
    board_state: serializeGhostBoardState(entry.boardRenderState),
    tile_played: entry.action === 'place' && entry.tile ? `${entry.tile[0]}|${entry.tile[1]}` : null,
    branch: placementBranchForEntry(entry),
    hand_before: entry.handBefore.map(([low, high]) => `${low}|${high}`),
    score_delta: entry.pointsScored,
  }));
}