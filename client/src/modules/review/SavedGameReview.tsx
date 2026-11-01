import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { GameOverlayPortal } from '../../components/GameOverlayPortal';
import { useAuth } from '../../auth/useAuth';
import {
  isDurablePvfReviewEnabled,
  isPositionalCoachingProseEnabled,
  isPostGameReviewAudience,
} from '../../training/pivotalReview/postGameReviewPolicy';
import { PostGameReviewPrompt } from '../../training/pivotalReview/PostGameReviewPrompt';
import type { FritzTier } from '../fritz/fritzConfig';
import type { SavedGameRecord } from './rebuildGameFromRecord';
import type { RebuiltGame } from './rebuildGameFromRecord';
import { loadSavedGame, type LoadSavedGameResult } from './savedGames';
import { usePostGamePivotalReview } from './usePostGamePivotalReview';
import '../../styles/dossierRecord.css';
import '../../training/pivotalReview/postGameReviewPrompt.css';

const GameReviewer = lazy(() => import('../../analyzer/GameReviewer'));

const FRITZ_TIERS: readonly FritzTier[] = ['rookie', 'standard', 'elite', 'master'];
const toFritzTier = (value: string | null): FritzTier => (FRITZ_TIERS as readonly string[]).includes(value ?? '') ? (value as FritzTier) : 'elite';

type SavedGameReviewProps = {
  sourceMatchId: string;
  onClose: () => void;
};

type LoadState =
  | { status: 'loading' }
  | { status: 'failed'; result: Extract<LoadSavedGameResult, { ok: false }> }
  | { status: 'ready'; record: SavedGameRecord; game: RebuiltGame };

/** What a player is told for each way a saved game can fail to open. Never a raw code. */
export function savedGameFailureCopy(result: Extract<LoadSavedGameResult, { ok: false }>): { title: string; message: string; retryable: boolean } {
  if (result.reason === 'not_found') {
    return { title: "We can't find that game", message: 'It may not have been saved, or it belongs to another account.', retryable: false };
  }
  if (result.reason === 'unreachable') {
    return { title: "Couldn't load your game", message: 'Check your connection and try again.', retryable: true };
  }
  return {
    title: "This game can't be replayed",
    message: 'It was saved, but its moves do not replay cleanly, so it cannot be reviewed.',
    retryable: false,
  };
}

function SavedGameStatus(props: { title: string; message?: string; onClose: () => void; onRetry?: () => void; busy?: boolean }) {
  return (
    <GameOverlayPortal>
      <div className="game-over-overlay df-result-overlay pgr-prompt-overlay" role="dialog" aria-modal="true" aria-label="Saved game review">
        <div className="dfd" onClick={(event) => event.stopPropagation()}>
          <div className="dfd__body">
            <header>
              <span className="dfd__eyebrow">Play vs Fritz</span>
              <h2 className="dfd__headline">{props.title}</h2>
              {props.message ? <p className="dfd__sub" role={props.busy ? 'status' : 'alert'}>{props.message}</p> : null}
            </header>
            <div className="dfd__actions">
              {props.onRetry ? <button type="button" className="dfd__btn dfd__btn--primary" onClick={props.onRetry}>Try again</button> : null}
              <button type="button" className="dfd__btn dfd__btn--ghost" onClick={props.onClose}>Close</button>
            </div>
          </div>
        </div>
      </div>
    </GameOverlayPortal>
  );
}

/**
 * The saved game, replayed through the real engine and recorder, fed to the same review hook the live match uses. The hook
 * enqueues the review job, polls it, builds the analysis and saves the finished review, so the next time this game is
 * opened from History it comes back instantly with no recomputation.
 */
function SavedGameReviewRun({ record, game, onClose }: { record: SavedGameRecord; game: RebuiltGame; onClose: () => void }) {
  const { user, accessToken } = useAuth();
  const reviewAudience = Boolean(user?.id) && isPostGameReviewAudience(user?.email);
  const durable = isDurablePvfReviewEnabled({ production: import.meta.env.PROD, authenticated: Boolean(accessToken) });
  const enablePositionalExplanations = isPositionalCoachingProseEnabled(reviewAudience);

  const review = usePostGamePivotalReview({
    match: game.finalState,
    moveLog: game.moveLog,
    botPostGameReviewEligible: reviewAudience,
    reviewPersistenceEnabled: durable,
    accessToken,
    enablePositionalExplanations,
    fritzTier: toFritzTier(record.fritzTier),
    winningScore: record.winningScore ?? 60,
    showPostGameOverlays: true,
    // Someone who opened this game asked for the review: start the job now, not after the post-game delay.
    reviewStartDelayMs: 0,
    reviewSnapshotRecorder: game.recorder,
    reviewCaptureEnabled: true,
    sourceMatchId: record.sourceMatchId,
  });

  const closeAll = useCallback(() => {
    review.closeAnalyzer();
    onClose();
  }, [review, onClose]);

  if (review.analyzerOpen && review.currentAnalysis) {
    return (
      <Suspense fallback={null}>
        <GameReviewer
          open
          onClose={closeAll}
          analysis={review.currentAnalysis}
          reviewWorkerBatch={review.reviewWorkerBatch}
          decisionIdByMoveNumber={review.decisionIdByMoveNumber}
          coachingFactsStore={review.coachingFactsStore}
          snapshotsByDecisionId={review.snapshotsByDecisionId}
          enablePositionalExplanations={review.enablePositionalExplanations}
          scopeHandNumber={review.reviewerScopeHandNumber}
          initialMoveIndex={review.reviewerInitialMoveIndex}
          title="Game Review"
          opponentLabel="Fritz"
        />
      </Suspense>
    );
  }

  if (review.postGameAnalysis) {
    const won = record.result.winner === 'you' ? true : record.result.winner === 'opponent' ? false : null;
    return (
      <PostGameReviewPrompt
        open
        accent="gold"
        modeLabel="Play vs Fritz"
        resultLabel={won === true ? 'Victory' : won === false ? 'Defeat' : 'Final score'}
        won={won}
        youScore={record.result.you}
        opponentScore={record.result.opponent}
        opponentLabel="Fritz"
        analysis={review.postGameAnalysis}
        accuracyModelPending={review.accuracyModelPending}
        reviewUnavailable={review.reviewUnavailable}
        decisionLedger={review.decisionLedger}
        onRetryReview={review.retryReview}
        reviewRetryState={review.reviewRetryState}
        onReviewGame={review.openReviewGameFromPrompt}
        onSkip={onClose}
      />
    );
  }

  return <SavedGameStatus title="Preparing your game…" message="Setting up the review." busy onClose={onClose} />;
}

/** Opens a saved game for review: fetch it, rebuild it, and run the review on it. Every way it can fail is explained. */
export default function SavedGameReview({ sourceMatchId, onClose }: SavedGameReviewProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void loadSavedGame(sourceMatchId).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { status: 'ready', record: result.record, game: result.game } : { status: 'failed', result });
    });
    return () => { cancelled = true; };
  }, [sourceMatchId, attempt]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((count) => count + 1);
  }, []);

  if (state.status === 'loading') return <SavedGameStatus title="Loading your game…" busy onClose={onClose} />;
  if (state.status === 'failed') {
    const copy = savedGameFailureCopy(state.result);
    return <SavedGameStatus title={copy.title} message={copy.message} onClose={onClose} onRetry={copy.retryable ? retry : undefined} />;
  }
  return <SavedGameReviewRun record={state.record} game={state.game} onClose={onClose} />;
}
