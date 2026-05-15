export interface MatchBoardTurnBarProps {
  turnLabel: string;
  isYourTurn: boolean;
  openEndsSum: number;
  showOpenEnds?: boolean;
  overlayOnBoard?: boolean;
}

export function MatchBoardTurnBar({
  turnLabel,
  isYourTurn,
  openEndsSum,
  showOpenEnds = true,
  overlayOnBoard = false,
}: MatchBoardTurnBarProps) {
  if (!turnLabel) return null;

  return (
    <div
      className={`wl-board-turn${overlayOnBoard ? ' wl-board-turn--overlay' : ''}`}
      data-ui="turn"
    >
      <span className={`wl-board-turn__label${isYourTurn ? ' your-turn' : ' opp-turn'}`}>
        {turnLabel}
      </span>
      {showOpenEnds ? (
        <span className="wl-board-turn__open-ends">
          <span className="wl-board-turn__open-value">{openEndsSum}</span>
          <span className="wl-board-turn__open-label">open</span>
        </span>
      ) : null}
    </div>
  );
}
