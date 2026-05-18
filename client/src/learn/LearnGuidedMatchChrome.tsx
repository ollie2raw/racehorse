import { MatchBoardTurnBar } from '../components/MatchBoardTurnBar';
import { MatchScoreHeader } from '../components/MatchScoreHeader';
import type { BoardState } from '../types';

export interface LearnGuidedMatchChromeProps {
  username: string;
  opponentLabel: string;
  yourScore: number;
  opponentScore: number;
  yourTileCount: number;
  opponentTileCount: number;
  winningScore: number;
  turnLabel: string;
  isYourTurn: boolean;
  board: BoardState | null;
  openEndsSum: number;
  onOpenScoreTrack?: () => void;
}

export default function LearnGuidedMatchChrome({
  username,
  opponentLabel,
  yourScore,
  opponentScore,
  yourTileCount,
  opponentTileCount,
  winningScore,
  turnLabel,
  isYourTurn,
  board,
  openEndsSum,
  onOpenScoreTrack,
}: LearnGuidedMatchChromeProps) {
  const displayName = username.trim() || 'You';

  return (
    <header className="learn-guided-chrome" data-ui="learn-match-hud">
      <div className="learn-guided-chrome__players">
        <div className="learn-guided-chrome__player is-you">
          <span className="learn-guided-chrome__avatar" aria-hidden="true">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <div className="learn-guided-chrome__player-meta">
            <span className="learn-guided-chrome__player-name">{displayName}</span>
            <strong className="learn-guided-chrome__player-score">{yourScore}</strong>
          </div>
        </div>

        <MatchBoardTurnBar
          turnLabel={turnLabel}
          isYourTurn={isYourTurn}
          board={board}
          openEndsSum={openEndsSum}
          showOpenEnds
        />

        <div className="learn-guided-chrome__player is-opp">
          <div className="learn-guided-chrome__player-meta is-opp">
            <span className="learn-guided-chrome__player-name">{opponentLabel}</span>
            <strong className="learn-guided-chrome__player-score">{opponentScore}</strong>
          </div>
          <span className="learn-guided-chrome__avatar is-bot" aria-hidden="true">
            F
          </span>
        </div>
      </div>

      <div className="learn-guided-chrome__track-wrap">
        <MatchScoreHeader
          target={winningScore}
          you={{
            label: displayName,
            score: yourScore,
            tileCount: yourTileCount,
            isActive: isYourTurn,
          }}
          opponent={{
            label: opponentLabel,
            sublabel: 'Bot',
            score: opponentScore,
            tileCount: opponentTileCount,
            isActive: !isYourTurn,
          }}
          onOpenDetail={onOpenScoreTrack}
        />
      </div>
    </header>
  );
}
