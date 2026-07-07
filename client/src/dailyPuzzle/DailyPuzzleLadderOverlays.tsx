import { getDailyPuzzleDisplayTitle } from './presentation';
import type { LadderSlotBreakdownChip } from './ladderSlotRowViewModel';
import type {
  DailyPuzzleCompleteResponse,
  DailyPuzzleSlot,
  DailyPuzzleSubmitSlotResponse,
} from './types';

export type LadderSlotOverlayData = {
  response: DailyPuzzleSubmitSlotResponse;
  rawScore: number;
};

export type LadderPracticeOverlayData = {
  slotIndex: number;
  slotTitle: string;
  rawScore: number;
  bestPossible: number | null;
};

export type LadderFinalOverlayData = {
  response: DailyPuzzleCompleteResponse;
};

/**
 * Parallel overlay flags — not mutually exclusive. All matching layers render in this order
 * (pending → slot → practice → final), matching pre-extraction `renderLadderOverlays()`.
 */
export type DailyPuzzleLadderOverlayFlags = {
  submitPending: boolean;
  finalizePending: boolean;
  slotOverlay: LadderSlotOverlayData | null;
  practiceOverlay: LadderPracticeOverlayData | null;
  finalOverlay: LadderFinalOverlayData | null;
};

export type DailyPuzzleLadderOverlayActions = {
  exitPlayToHub: () => void;
  onSlotNext: (nextSlot: DailyPuzzleSlot) => void;
  onPracticeReplay: (slotIndex: 1 | 2 | 3) => void;
  onPracticeNext: (slotIndex: 1 | 2 | 3) => void;
  onPracticeExitToHub: () => void;
  onShareResult: (text: string) => void;
  onFinalHome: () => void;
  onFinalReview: () => void;
  onFinalLeaderboard: () => void;
};

export type DailyPuzzleLadderOverlaysProps = {
  flags: DailyPuzzleLadderOverlayFlags;
  currentSlotBreakdown: LadderSlotBreakdownChip[];
  finalLadderShareText: string;
  shareDone: boolean;
  actions: DailyPuzzleLadderOverlayActions;
};

export function DailyPuzzleLadderOverlays({
  flags,
  currentSlotBreakdown,
  finalLadderShareText,
  shareDone,
  actions,
}: DailyPuzzleLadderOverlaysProps) {
  const { submitPending, finalizePending, slotOverlay, practiceOverlay, finalOverlay } = flags;

  return (
    <>
      {submitPending || finalizePending ? (
        <div
          className="rh-modal-overlay dpl-ladder-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-busy="true"
          aria-label={finalizePending ? 'Finalizing ladder' : 'Submitting puzzle'}
        >
          <div className="rh-result dpl-ladder-pending-modal">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow" style={{ color: 'var(--tier-standard)' }}>
                DAILY LADDER
              </div>
              <div className="rh-result__feedback">
                {finalizePending ? 'Finalizing ladder…' : 'Submitting puzzle…'}
              </div>
            </header>
            <p className="dpl-ladder-pending-copy">Please wait.</p>
          </div>
        </div>
      ) : null}

      {slotOverlay ? (
        <div
          className="rh-modal-overlay dpl-ladder-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Puzzle complete"
        >
          <div className="rh-result dpl-ladder-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow">PUZZLE COMPLETE</div>
              <div className="rh-result__score">
                <span>{slotOverlay.response.slotResult.awardedPoints}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback">
                {getDailyPuzzleDisplayTitle(
                  slotOverlay.response.slotResult.slotIndex,
                  slotOverlay.response.slotResult.slotTitle,
                )}
              </div>
            </header>
            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Raw Score</span>
                <span className="rh-result__summary-value">{slotOverlay.rawScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Best Possible</span>
                <span className="rh-result__summary-value">{slotOverlay.response.slotResult.bestPossibleScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Ladder Total</span>
                <span className="rh-result__summary-value">{slotOverlay.response.attempt.totalScore}</span>
              </div>
            </div>
            <footer className="rh-result__actions dpl-ladder-result__actions">
              <button type="button" className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost" onClick={actions.exitPlayToHub}>
                Back to Ladder
              </button>
              {slotOverlay.response.nextSlot ? (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-result-btn--primary"
                  onClick={() => {
                    const nextSlot = slotOverlay.response.nextSlot;
                    if (nextSlot) actions.onSlotNext(nextSlot);
                  }}
                >
                  {`Next · Puzzle ${slotOverlay.response.nextSlot.slotIndex}`}
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      {practiceOverlay ? (
        <div className="rh-modal-overlay dpl-ladder-modal-overlay" role="dialog" aria-modal="true" aria-label="Practice complete">
          <div className="rh-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow" style={{ color: 'var(--tier-standard)' }}>PRACTICE COMPLETE</div>
              <div className="rh-result__score">
                <span>{practiceOverlay.rawScore}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback">
                {getDailyPuzzleDisplayTitle(practiceOverlay.slotIndex, practiceOverlay.slotTitle)}
              </div>
            </header>
            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Best Possible</span>
                <span className="rh-result__summary-value">{practiceOverlay.bestPossible ?? '—'}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Mode</span>
                <span className="rh-result__summary-value">Practice</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Slot</span>
                <span className="rh-result__summary-value">P{practiceOverlay.slotIndex}</span>
              </div>
            </div>
            <footer
              className="rh-result__actions"
              style={{ gridTemplateColumns: practiceOverlay.slotIndex < 3 ? '1fr 1.2fr' : '1fr 1fr' }}
            >
              <button
                type="button"
                className="rh-btn-leave"
                onClick={() => actions.onPracticeReplay(practiceOverlay.slotIndex as 1 | 2 | 3)}
              >
                Replay P{practiceOverlay.slotIndex}
              </button>
              {practiceOverlay.slotIndex < 3 ? (
                <button
                  type="button"
                  className="rh-btn-cancel"
                  onClick={() => actions.onPracticeNext((practiceOverlay.slotIndex + 1) as 1 | 2 | 3)}
                >
                  Practice P{practiceOverlay.slotIndex + 1}
                </button>
              ) : (
                <button
                  type="button"
                  className="rh-btn-cancel"
                  onClick={actions.onPracticeExitToHub}
                >
                  ← Back to Ladder
                </button>
              )}
            </footer>
            {practiceOverlay.slotIndex < 3 && (
              <div style={{ padding: '0 22px 22px', marginTop: '-10px', textAlign: 'center' }}>
                <button
                  type="button"
                  className="btn text compact"
                  style={{ opacity: 0.5, fontSize: '11px' }}
                  onClick={actions.onPracticeExitToHub}
                >
                  Return to Ladder Home
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {finalOverlay ? (
        <div className="rh-modal-overlay dpl-ladder-modal-overlay" role="dialog" aria-modal="true" aria-label="Ladder complete">
          <div className="rh-result dpl-ladder-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow">LADDER COMPLETE</div>
              <div className="rh-result__score">
                <span>{finalOverlay.response.attempt.totalScore}</span>
                <span className="rh-result__score-suffix">PTS</span>
              </div>
              <div className="rh-result__feedback">
                {finalOverlay.response.leaderboardRank ? `Rank #${finalOverlay.response.leaderboardRank}` : 'Ladder finalized'}
              </div>
            </header>
            <div className="rh-result__summary">
              <div>
                <span className="rh-result__summary-label">Completed</span>
                <span className="rh-result__summary-value">{finalOverlay.response.attempt.puzzlesCompleted}/3</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Puzzle 3</span>
                <span className="rh-result__summary-value">{finalOverlay.response.attempt.masterChainScore}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">Breakdown</span>
                <span className="rh-result__summary-value">
                  {currentSlotBreakdown.map((chip) => `${chip.label} ${chip.value}`).join(' · ')}
                </span>
              </div>
            </div>
            <footer className="rh-result__actions dpl-ladder-result__actions dpl-ladder-result__actions--with-share">
              {finalLadderShareText ? (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-share-result-btn"
                  onClick={() => actions.onShareResult(finalLadderShareText)}
                >
                  {shareDone ? '✓ Shared!' : 'Share Result'}
                </button>
              ) : null}
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                onClick={actions.onFinalHome}
              >
                ← Home
              </button>
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                onClick={actions.onFinalReview}
              >
                Review Ladder
              </button>
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--primary"
                onClick={actions.onFinalLeaderboard}
              >
                Leaderboard
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}