import { assertDisplayedOpenCountMatchesCanonical, computeOpenEndsSum } from '../game/openEndsGeometry';
import type { BoardState } from '../types';

export interface MatchBoardTurnBarProps {
  turnLabel: string;
  isYourTurn: boolean;
  board: BoardState | null;
  /** @deprecated Dev cross-check; display always uses computeOpenEndsSum(board) */
  openEndsSum?: number;
  showOpenEnds?: boolean;
  overlayOnBoard?: boolean;
}

export function MatchBoardTurnBar({
  turnLabel,
  isYourTurn,
  board,
  openEndsSum,
  showOpenEnds = true,
  overlayOnBoard = false,
}: MatchBoardTurnBarProps) {
  if (!turnLabel) return null;

  const canonical = board ? computeOpenEndsSum(board) : (openEndsSum ?? 0);
  if (board && openEndsSum !== undefined) {
    assertDisplayedOpenCountMatchesCanonical(board, openEndsSum, 'MatchBoardTurnBar');
  }

  return (
    <div
      className={`wl-board-turn${overlayOnBoard ? ' wl-board-turn--overlay' : ''}`}
      data-ui="turn"
    >
      <span className={`wl-board-turn__label${isYourTurn ? ' your-turn' : ' opp-turn'}`}>
        {turnLabel}
      </span>
      {showOpenEnds && board ? (
        <span className="wl-board-turn__open-ends">
          <span className="wl-board-turn__open-value">{canonical}</span>
          <span className="wl-board-turn__open-label">open</span>
        </span>
      ) : null}
    </div>
  );
}
