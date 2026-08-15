import { lazy, Suspense, type CSSProperties } from 'react';
import { POST_GAME_REVIEW_VISIBLE } from '../../../appRouteTypes.ts';
import { logger } from '../../../utils/logger.ts';

const GameReviewer = lazy(() => import('../../../analyzer/GameReviewer.tsx'));
import LeaveGameModal from '../../../components/LeaveGameModal.tsx';
import { GameOverlayPortal } from '../../../components/GameOverlayPortal.tsx';
import { InGameOverlayStack } from '../../../match/board';
import type { InGameOverlayViewModel } from '../../view-model/botMatchViewModelTypes.ts';

type BotMatchInGameOverlaysProps = InGameOverlayViewModel;

export function BotMatchInGameOverlays({
  flyingTiles,
  isLessonLayoutMode,
  showFullCoachTip,
  showPlayerCoaching,
  lessonCoachVm,
  lessonCoachContent,
  setShowFullCoachTip,
  analyzerOpen,
  closeAnalyzer,
  currentAnalysis,
  reviewerScopeHandNumber,
  reviewerInitialMoveIndex,
  opponentLabel,
  showDebug,
  botHand,
  openEnds,
  lastBotChoice,
  showLeaveConfirm,
  setShowLeaveConfirm,
  isJourneyTrial,
  isStandaloneFritzMatch,
  matchGameOver,
  navigation,
  abandonStandaloneFritzMatch,
}: BotMatchInGameOverlaysProps) {
  const { exitJourneyTrial, exitMatch, onProfileRefresh } = navigation;
  return (
    <>
      <InGameOverlayStack>
        {flyingTiles.length > 0 && (
          <GameOverlayPortal>
            {flyingTiles.map((ft) => (
              <div
                key={ft.id}
                className="flying-tile-overlay"
                style={{
                  '--fly-from-x': `${ft.x}px`,
                  '--fly-from-y': `${ft.y}px`,
                  '--fly-to-x': `${ft.toX}px`,
                  '--fly-to-y': `${ft.toY}px`,
                } as CSSProperties}
              />
            ))}
          </GameOverlayPortal>
        )}
      </InGameOverlayStack>

      {isLessonLayoutMode && showFullCoachTip && showPlayerCoaching && !lessonCoachVm?.isOffAuthoredLine ? (
        <GameOverlayPortal>
          <div
            className="learn-guided-coach-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Full coach tip"
            onClick={() => setShowFullCoachTip(false)}
          >
            <div className="learn-guided-coach-modal__card" onClick={(event) => event.stopPropagation()}>
              <div className="learn-guided-coach-modal__header">
                <p className="learn-guided-coach-modal__eyebrow">Fritz Coach</p>
                <button
                  type="button"
                  className="learn-guided-coach-modal__close"
                  onClick={() => setShowFullCoachTip(false)}
                >
                  Close
                </button>
              </div>
              <h2 className="learn-guided-coach-modal__title">{lessonCoachContent.title}</h2>
              <div className="learn-guided-coach-modal__body">
                {lessonCoachContent.bodyParagraphs.map((paragraph, index) => (
                  <p
                    key={`modal-${index}-${paragraph.slice(0, 24)}`}
                    className="learn-guided-coach-modal__paragraph"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </GameOverlayPortal>
      ) : null}

      {POST_GAME_REVIEW_VISIBLE && analyzerOpen ? (
        <Suspense fallback={null}>
          <GameReviewer
            open={analyzerOpen}
            onClose={closeAnalyzer}
            analysis={currentAnalysis}
            scopeHandNumber={reviewerScopeHandNumber}
            initialMoveIndex={reviewerInitialMoveIndex}
            title="Game Review"
            opponentLabel={opponentLabel}
          />
        </Suspense>
      ) : null}

      {showDebug && (
        <aside className="bot-debug-panel">
          <div>
            <strong>{opponentLabel} hand:</strong> {botHand}
          </div>
          <div>
            <strong>Open ends:</strong> {openEnds.join(', ') || '(none)'}
          </div>
          {lastBotChoice && (
            <div>
              <strong>Last bot eval:</strong> {`score=${lastBotChoice.score.toFixed(2)} `}
              {`immediate=${lastBotChoice.breakdown.immediate} `}
              {`mobility=${lastBotChoice.breakdown.mobility} `}
              {`denial=${lastBotChoice.breakdown.denial.toFixed(1)} `}
              {`risk=${lastBotChoice.breakdown.replyRisk}`}
            </div>
          )}
        </aside>
      )}

      {showLeaveConfirm && (
        <LeaveGameModal
          onCancel={() => setShowLeaveConfirm(false)}
          onLeave={() => {
            if (isJourneyTrial) {
              setShowLeaveConfirm(false);
              exitJourneyTrial(false);
              return;
            }
            if (isStandaloneFritzMatch && !matchGameOver) {
              void abandonStandaloneFritzMatch()
                .catch((err) => {
                  console.warn('[Fritz Pending] abandon failed', err);
                })
                .finally(() => {
                  void Promise.resolve(onProfileRefresh?.()).catch((error) => {
                    logger.error('bot.profile_refresh_after_abandon', error);
                  });
                  exitMatch();
                });
            } else {
              exitMatch();
            }
          }}
        />
      )}
    </>
  );
}
