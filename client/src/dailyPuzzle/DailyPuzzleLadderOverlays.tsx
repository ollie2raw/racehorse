import { getDailyPuzzleDisplayTitle } from './presentation';
import { DAILY_PUZZLE_SLOT_COUNT } from './types';
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
  onPracticeReplay: (slotIndex: 1 | 2 | 3 | 4 | 5) => void;
  onPracticeNext: (slotIndex: 1 | 2 | 3 | 4 | 5) => void;
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
  /** Length of the ladder this day published (3 today, 5 on archived days). */
  publishedSlotCount?: number;
};

export function DailyPuzzleLadderOverlays({
  flags,
  currentSlotBreakdown,
  finalLadderShareText,
  shareDone,
  actions,
  publishedSlotCount = DAILY_PUZZLE_SLOT_COUNT,
}: DailyPuzzleLadderOverlaysProps) {
  const finalSlotIndex = publishedSlotCount;
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
            <p className="dpl-ladder-pending-copy is-pending">Saving your result…</p>
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
          <div className="rh-result dpl-ladder-result">
            <header className="rh-result__head">
              <div className="claude-mode-hero__eyebrow">PRACTICE COMPLETE</div>
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
                <span className="rh-result__summary-label">Puzzle</span>
                <span className="rh-result__summary-value">
                  {getDailyPuzzleDisplayTitle(practiceOverlay.slotIndex, practiceOverlay.slotTitle)}
                </span>
              </div>
            </div>
            <footer
              className={`rh-result__actions dpl-ladder-result__actions${
                practiceOverlay.slotIndex < finalSlotIndex ? ' dpl-ladder-result__actions--triple' : ''
              }`}
            >
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                onClick={() => actions.onPracticeReplay(practiceOverlay.slotIndex as 1 | 2 | 3 | 4 | 5)}
              >
                Replay
              </button>
              {practiceOverlay.slotIndex < finalSlotIndex ? (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-result-btn--primary"
                  onClick={() => actions.onPracticeNext((practiceOverlay.slotIndex + 1) as 1 | 2 | 3 | 4 | 5)}
                >
                  {`Practice ${getDailyPuzzleDisplayTitle(practiceOverlay.slotIndex + 1)}`}
                </button>
              ) : (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-result-btn--primary"
                  onClick={actions.onPracticeExitToHub}
                >
                  Back to Ladder
                </button>
              )}
              {practiceOverlay.slotIndex < finalSlotIndex ? (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                  onClick={actions.onPracticeExitToHub}
                >
                  Ladder Home
                </button>
              ) : null}
            </footer>
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
                <span className="rh-result__summary-value">{finalOverlay.response.attempt.puzzlesCompleted}/{publishedSlotCount}</span>
              </div>
              <div>
                <span className="rh-result__summary-label">{getDailyPuzzleDisplayTitle(finalSlotIndex)}</span>
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
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--primary"
                onClick={actions.onFinalLeaderboard}
              >
                Leaderboard
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
                className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                onClick={actions.onFinalHome}
              >
                Home
              </button>
              {finalLadderShareText ? (
                <button
                  type="button"
                  className="dpl-ladder-result-btn dpl-ladder-share-result-btn"
                  onClick={() => actions.onShareResult(finalLadderShareText)}
                >
                  {shareDone ? 'Copied' : 'Share Result'}
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
