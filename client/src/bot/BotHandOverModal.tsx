import React from 'react';
import { GameOverlayPortal } from '../components/GameOverlayPortal';
import HandOverModal from '../components/handOver/HandOverModal';
import {
  buildHandOverReasonCopy,
  buildNextHandDealingHint,
  loserDisplayLabel,
  resolveWinnerSide,
  winnerDisplayLabel,
  type HandOverTileReveal,
} from '../components/handOver/handOverCopy';
import LearningHandRecap from '../learning/LearningHandRecap';
import type { BotHandReveal } from './botMatchScreenTypes';

import type { HandLearningSummary } from '../learning/handSummary';

export interface BotHandOverModalProps {
  handReveal: BotHandReveal | null;
  gameOver: boolean;
  handRevealProgress: number;
  handAdvanceError: string | null;
  showManualHandAdvance: boolean;
  ghostResultError: string | null;
  isGuidedMode: boolean;
  isGuidedV2Mode: boolean;
  isDailyFritzMode: boolean;
  opponentLabel: string;
  tileReveals: HandOverTileReveal[];
  coach: {
    handSummary?: HandLearningSummary | null;
  };
  autoAdvanceMs: number;
  onAdvanceHand: () => void;
  onRetryGhost: () => void;
  onRetryHandAdvance: () => void;
  handNumber: number;
  mode?: string;
  onStakesProceed?: () => void;
}

export const BotHandOverModal: React.FC<BotHandOverModalProps> = ({
  handReveal,
  gameOver,
  handRevealProgress,
  handAdvanceError,
  showManualHandAdvance,
  ghostResultError,
  isGuidedMode,
  isGuidedV2Mode,
  isDailyFritzMode,
  opponentLabel,
  tileReveals,
  coach,
  autoAdvanceMs,
  onAdvanceHand,
  onRetryGhost,
  onRetryHandAdvance,
  handNumber,
  mode,
  onStakesProceed,
}) => {
  if (!handReveal || gameOver) return null;

  const winnerSide = resolveWinnerSide(handReveal.winner);

  return (
    <GameOverlayPortal>
      <HandOverModal
        variant="sp"
        cardClassName={isDailyFritzMode ? 'hand-over-modal--daily-fritz' : undefined}
        pointsAwarded={handReveal.pointsAwarded}
        winnerSide={winnerSide}
        winnerLabel={winnerDisplayLabel(winnerSide, opponentLabel)}
        loserLabel={loserDisplayLabel(winnerSide, opponentLabel)}
        loserPips={handReveal.loserPips}
        reasonCopy={buildHandOverReasonCopy({
          youWentOut: handReveal.reason !== 'blocked' && handReveal.winner === 'you',
          opponentWentOut: handReveal.reason !== 'blocked' && handReveal.winner === 'bot',
          isBlocked: handReveal.reason === 'blocked',
          opponentName: opponentLabel,
          pointsAwarded: handReveal.pointsAwarded,
        })}
        tileReveals={tileReveals}
        nextHandLabel="Next hand starting..."
        nextHandHint={buildNextHandDealingHint({
          completedHandNumber: handNumber,
          isDailyFritzMode,
          opponentLabel,
        })}
        progress={isGuidedMode || isGuidedV2Mode ? undefined : handRevealProgress}
        progressTransitionMs={
          isGuidedMode || isGuidedV2Mode ? undefined : autoAdvanceMs
        }
        learningRecap={
          isGuidedMode && coach.handSummary ? (
            <LearningHandRecap summary={coach.handSummary} />
          ) : undefined
        }
        footer={
          ghostResultError ? (
            <footer className="hand-over-modal__footer">
              <div className="hand-over-error-zone">
                <span className="hand-over-error-text" title={ghostResultError}>
                  {ghostResultError}
                </span>
                <button
                  type="button"
                  className="mode-inline-btn"
                  onClick={onRetryGhost}
                >
                  Retry
                </button>
              </div>
            </footer>
          ) : showManualHandAdvance || handAdvanceError ? (
            <footer className="hand-over-modal__footer">
              <div className="hand-over-error-zone">
                {handAdvanceError ? (
                  <span className="hand-over-error-text" title={handAdvanceError}>
                    {handAdvanceError}
                  </span>
                ) : (
                  <span className="hand-over-modal__next-hint">
                    Next hand is taking longer than expected.
                  </span>
                )}
                <button
                  type="button"
                  className="mode-inline-btn"
                  onClick={onRetryHandAdvance}
                >
                  {handAdvanceError?.includes('Reload the hand')
                    ? 'Reload Hand'
                    : handAdvanceError
                      ? 'Retry'
                      : 'Continue'}
                </button>
              </div>
            </footer>
          ) : mode === 'stakes' ? (
            <footer className="hand-over-modal__footer">
              <button type="button" className="pvf-start-btn" onClick={onStakesProceed}>
                <span>Proceed to Settlement</span>
                <span className="pvf-start-arrow" aria-hidden>
                  ›
                </span>
              </button>
            </footer>
          ) : isGuidedMode || isGuidedV2Mode ? (
            <footer className="hand-over-modal__footer">
              <button type="button" className="pvf-start-btn" onClick={onAdvanceHand}>
                <span>Next Hand</span>
                <span className="pvf-start-arrow" aria-hidden>
                  ›
                </span>
              </button>
            </footer>
          ) : undefined
        }
      />
    </GameOverlayPortal>
  );
};
