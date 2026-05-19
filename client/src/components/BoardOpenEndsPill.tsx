/** Open-end sum pill — always shows canonical geometry sum from board tiles. */

import {
  assertDisplayedOpenCountMatchesCanonical,
  computeOpenEndsSum,
  hydrateBoardForOpenEnds,
} from '../game/openEndsGeometry';
import type { BoardState } from '../types';

export interface BoardOpenEndsPillProps {
  board: BoardState | null;
  /**
   * Optional dev cross-check only. The displayed value always comes from
   * `computeOpenEndsSum(board)` — never from this prop alone.
   */
  openEndsSum?: number;
  visible?: boolean;
}

export function BoardOpenEndsPill({ board, openEndsSum, visible = true }: BoardOpenEndsPillProps) {
  if (!visible) return null;

  // Fresh hands start with board === null; still show "0" until the first tile is played.
  const scoringBoard = board ? hydrateBoardForOpenEnds(board) : null;
  const canonical = scoringBoard ? computeOpenEndsSum(scoringBoard) : (openEndsSum ?? 0);
  if (scoringBoard && openEndsSum !== undefined) {
    assertDisplayedOpenCountMatchesCanonical(scoringBoard, openEndsSum, 'BoardOpenEndsPill');
  }

  return (
    <div className="open-ends-pill board-corner-pill board-corner-pill--tl" aria-label={`${canonical} open ends`}>
      <span className="open-ends-pill__label">Open</span>
      <span className="open-ends-count">{canonical}</span>
    </div>
  );
}
