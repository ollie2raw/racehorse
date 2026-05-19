export interface LearnGuidedMatchChromeProps {
  yourScore: number;
  opponentScore: number;
  turnLabel: string;
  isYourTurn: boolean;
  openEndsSum: number;
  boneyardCount: number;
}

export default function LearnGuidedMatchChrome({
  yourScore,
  opponentScore,
  turnLabel,
  isYourTurn,
  openEndsSum,
  boneyardCount,
}: LearnGuidedMatchChromeProps) {
  return (
    <header className="learn-guided-match-state" data-ui="learn-match-hud">
      <div className="fritz-section-label">1. Current Decision</div>
      <div className="learn-guided-match-state__grid">
        <div className="learn-guided-match-state__stat">
          <div className="fritz-summary-value">{opponentScore}</div>
          <div className="fritz-summary-key">Fritz Score</div>
        </div>
        <div className="learn-guided-match-state__stat learn-guided-match-state__stat--turn">
          <div className={`learn-guided-match-state__turn-pill${isYourTurn ? ' is-active' : ''}`}>
            {isYourTurn ? 'Your Move' : turnLabel}
          </div>
          <div className="fritz-summary-key">Turn State</div>
        </div>
        <div className="learn-guided-match-state__stat">
          <div className="fritz-summary-value">{yourScore}</div>
          <div className="fritz-summary-key">Your Score</div>
        </div>
        <div className="learn-guided-match-state__stat">
          <div className="fritz-summary-value">{openEndsSum}</div>
          <div className="fritz-summary-key">Open Count</div>
        </div>
        <div className="learn-guided-match-state__stat">
          <div className="fritz-summary-value">{boneyardCount}</div>
          <div className="fritz-summary-key">Boneyard</div>
        </div>
      </div>
    </header>
  );
}
