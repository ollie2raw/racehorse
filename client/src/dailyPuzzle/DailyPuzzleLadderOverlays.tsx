import { getDailyPuzzleDisplayTitle } from './presentation';
import type { LadderSlotBreakdownChip } from './ladderSlotRowViewModel';
import type {
  DailyPuzzleCompleteResponse,
  DailyPuzzleSlot,
  DailyPuzzleSubmitSlotResponse,
} from './types';
import './dailyPuzzleClimbOverlays.css';

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
  hubError?: string | null;
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
};

function LadderStageRail({
  currentStage,
  complete,
  completedThrough = currentStage,
}: {
  currentStage: number;
  complete?: boolean;
  completedThrough?: number;
}) {
  return (
    <div className="dpl-climb-result__rail" role="list" aria-label="Daily Climb progress">
      {[1, 2, 3, 4, 5].map((stage) => {
        const isReached = complete || stage <= completedThrough;
        const isCurrent = !complete && stage === currentStage;
        return (
          <span
            key={stage}
            role="listitem"
            aria-label={`Puzzle ${stage}${isReached ? ' complete' : isCurrent ? ' current' : ' upcoming'}`}
            className={[
              'dpl-climb-result__rail-step',
              isReached ? 'is-reached' : '',
              isCurrent ? 'is-current' : '',
              stage === 5 ? 'is-summit' : '',
            ].filter(Boolean).join(' ')}
          >
            <span aria-hidden>{isReached ? '✓' : stage}</span>
            <small>P{stage}</small>
          </span>
        );
      })}
    </div>
  );
}

export function DailyPuzzleLadderOverlays({
  flags,
  currentSlotBreakdown,
  finalLadderShareText,
  shareDone,
  actions,
}: DailyPuzzleLadderOverlaysProps) {
  const { submitPending, finalizePending, slotOverlay, practiceOverlay, finalOverlay, hubError = null } = flags;

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
          <div className="rh-result dpl-climb-status" aria-live="polite">
            <div className="dpl-climb-status__mark" aria-hidden>
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <div className="dpl-climb-status__eyebrow">DAILY CLIMB</div>
            <h2>{finalizePending ? 'Finalizing ladder…' : 'Submitting puzzle…'}</h2>
            <p>Saving your result…</p>
            <div className="dpl-climb-status__trust">Your progress is being secured</div>
          </div>
        </div>
      ) : null}

      {hubError && !submitPending && !finalizePending && !slotOverlay && !practiceOverlay && !finalOverlay ? (
        <div className="rh-modal-overlay dpl-ladder-modal-overlay" role="alertdialog" aria-modal="true">
          <div className="rh-result dpl-climb-status dpl-climb-status--error">
            <div className="dpl-climb-status__alert-mark" aria-hidden>!</div>
            <div className="dpl-climb-status__eyebrow">SAVE NEEDS ATTENTION</div>
            <h2>Your board is still safe</h2>
            <p>{hubError}</p>
            <footer className="dpl-climb-status__actions">
              <button type="button" className="dpl-ladder-result-btn dpl-ladder-result-btn--primary" onClick={actions.exitPlayToHub}>
                Return to Ladder
              </button>
            </footer>
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
          <div className="rh-result dpl-ladder-result dpl-climb-result">
            <header className="dpl-climb-result__header">
              <div className="dpl-climb-result__header-row">
                <div className="dpl-climb-result__eyebrow">
                  {slotOverlay.response.slotResult.solved ? 'STAGE CLEARED' : 'STAGE RECORDED'}
                </div>
                <div className="dpl-climb-result__stage-count">
                  {slotOverlay.response.slotResult.slotIndex} / 5
                </div>
              </div>
              <LadderStageRail currentStage={slotOverlay.response.slotResult.slotIndex} />
              <div className="dpl-climb-result__hero">
                <div className="dpl-climb-result__identity">
                  <span className="dpl-climb-result__performance">
                    {slotOverlay.response.slotResult.perfect
                      ? 'Perfect line'
                      : slotOverlay.response.slotResult.solved
                        ? 'Climb continues'
                        : 'Result locked in'}
                  </span>
                  <h2>
                    {getDailyPuzzleDisplayTitle(
                      slotOverlay.response.slotResult.slotIndex,
                      slotOverlay.response.slotResult.slotTitle,
                    )}
                  </h2>
                  <p>
                    {slotOverlay.response.nextSlot
                      ? `Next up: ${getDailyPuzzleDisplayTitle(
                          slotOverlay.response.nextSlot.slotIndex,
                          slotOverlay.response.nextSlot.slotTitle,
                        )}`
                      : 'The summit is within reach.'}
                  </p>
                </div>
                <div className="dpl-climb-result__score" aria-label={`${slotOverlay.response.slotResult.awardedPoints} points earned`}>
                  <strong>{slotOverlay.response.slotResult.awardedPoints}</strong>
                  <span>PTS EARNED</span>
                  <small>of {slotOverlay.response.slotResult.slotMaxPoints}</small>
                </div>
              </div>
            </header>
            <div className="dpl-climb-result__summary">
              <div>
                <span>Board score</span>
                <strong>{slotOverlay.rawScore}</strong>
              </div>
              <div>
                <span>Best possible</span>
                <strong>{slotOverlay.response.slotResult.bestPossibleScore}</strong>
              </div>
              <div>
                <span>Climb total</span>
                <strong>{slotOverlay.response.attempt.totalScore}</strong>
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
                  {`Climb to ${getDailyPuzzleDisplayTitle(
                    slotOverlay.response.nextSlot.slotIndex,
                    slotOverlay.response.nextSlot.slotTitle,
                  )}`}
                </button>
              ) : null}
            </footer>
          </div>
        </div>
      ) : null}

      {practiceOverlay ? (
        <div className="rh-modal-overlay dpl-ladder-modal-overlay" role="dialog" aria-modal="true" aria-label="Practice complete">
          <div className="rh-result dpl-ladder-result dpl-climb-result dpl-climb-result--practice">
            <header className="dpl-climb-result__header">
              <div className="dpl-climb-result__header-row">
                <div className="dpl-climb-result__eyebrow">PRACTICE COMPLETE</div>
                <div className="dpl-climb-result__stage-count">STAGE {practiceOverlay.slotIndex} / 5</div>
              </div>
              <LadderStageRail
                currentStage={practiceOverlay.slotIndex}
                completedThrough={0}
              />
              <div className="dpl-climb-result__hero">
                <div className="dpl-climb-result__identity">
                  <span className="dpl-climb-result__performance">Practice run</span>
                  <h2>{getDailyPuzzleDisplayTitle(practiceOverlay.slotIndex, practiceOverlay.slotTitle)}</h2>
                  <p>Replay this board or move forward through the climb.</p>
                </div>
                <div className="dpl-climb-result__score" aria-label={`${practiceOverlay.rawScore} practice points`}>
                  <strong>{practiceOverlay.rawScore}</strong>
                  <span>BOARD PTS</span>
                  <small>Unranked</small>
                </div>
              </div>
            </header>
            <div className="dpl-climb-result__summary">
              <div>
                <span>Best possible</span>
                <strong>{practiceOverlay.bestPossible ?? '—'}</strong>
              </div>
              <div>
                <span>Mode</span>
                <strong>Practice</strong>
              </div>
              <div>
                <span>Stage</span>
                <strong>{practiceOverlay.slotIndex}/5</strong>
              </div>
            </div>
            <footer
              className={`rh-result__actions dpl-ladder-result__actions${
                practiceOverlay.slotIndex < 5 ? ' dpl-ladder-result__actions--triple' : ''
              }`}
            >
              <button
                type="button"
                className="dpl-ladder-result-btn dpl-ladder-result-btn--ghost"
                onClick={() => actions.onPracticeReplay(practiceOverlay.slotIndex as 1 | 2 | 3 | 4 | 5)}
              >
                Replay
              </button>
              {practiceOverlay.slotIndex < 5 ? (
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
              {practiceOverlay.slotIndex < 5 ? (
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
          <div className="rh-result dpl-ladder-result dpl-climb-result dpl-climb-result--summit">
            <header className="dpl-climb-result__header">
              <div className="dpl-climb-result__header-row">
                <div className="dpl-climb-result__eyebrow">DAILY CLIMB COMPLETE</div>
                <div className="dpl-climb-result__stage-count dpl-climb-result__stage-count--summit">SUMMIT</div>
              </div>
              <LadderStageRail currentStage={5} complete />
              <div className="dpl-climb-result__hero">
                <div className="dpl-climb-result__identity">
                  <span className="dpl-climb-result__performance">Summit reached</span>
                  <h2>Master Chain Complete</h2>
                  <p>
                    {finalOverlay.response.leaderboardRank
                      ? `You placed #${finalOverlay.response.leaderboardRank} on today’s ladder.`
                      : 'Your score is locked on today’s ladder.'}
                  </p>
                </div>
                <div className="dpl-climb-result__score" aria-label={`${finalOverlay.response.attempt.totalScore} total points`}>
                  <strong>{finalOverlay.response.attempt.totalScore}</strong>
                  <span>TOTAL PTS</span>
                  <small>{finalOverlay.response.leaderboardRank ? `Rank #${finalOverlay.response.leaderboardRank}` : 'Final'}</small>
                </div>
              </div>
            </header>
            <div className="dpl-climb-result__summary">
              <div>
                <span>Stages cleared</span>
                <strong>{finalOverlay.response.attempt.puzzlesCompleted}/5</strong>
              </div>
              <div>
                <span>Master Chain</span>
                <strong>{finalOverlay.response.attempt.masterChainScore}</strong>
              </div>
              <div>
                <span>Daily rank</span>
                <strong>{finalOverlay.response.leaderboardRank ? `#${finalOverlay.response.leaderboardRank}` : '—'}</strong>
              </div>
            </div>
            <div className="dpl-climb-result__breakdown" role="list" aria-label="Puzzle score breakdown">
              {currentSlotBreakdown.map((chip) => (
                <div key={chip.slotIndex} role="listitem" className={chip.slotIndex === 5 ? 'is-summit' : ''}>
                  <span>{chip.label}</span>
                  <strong>{chip.value}</strong>
                </div>
              ))}
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
