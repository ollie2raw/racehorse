/**
 * usePostGamePivotalReview
 *
 * Manages post-game analysis and review state for BotMatchScreen.
 *
 * Live behaviour: deferred move-log analysis, game-reviewer open/close, and the
 * post-game "review your game" prompt.
 *
 * It also holds the pivotal-turn review *wizard* state (open/summary), but that
 * path is inert on `main` — `PIVOTAL_REVIEW_WIZARD_ENABLED` is false and nothing
 * calls `setPivotalReviewOpen(true)` (CQ9.2 F16/F20). `pivotalSelection` returns
 * null while the flag is off.
 *
 * Activated only when botPostGameReviewEligible is true.
 * When false, deferred analysis never runs and all state stays at defaults.
 *
 * Does not own game state — reads match and moveLog as inputs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { GameAnalysis } from '../../analyzer/moveAnalyzer.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { FritzTier } from '../fritz/fritzConfig.ts';
import type { ReviewSnapshotRecorder } from './ReviewSnapshotRecorder.ts';
import { saveReviewSnapshots } from './reviewSnapshotStorage.ts';
import { useReviewWorkerBatch } from './useReviewWorkerBatch.ts';
import { correlateSnapshotsToMoveLog } from './correlateSnapshotsToMoveLog.ts';
import { logReviewWorkerBatchDiagnostics } from './logReviewWorkerBatchDiagnostics.ts';
import {
  DEFAULT_REVIEW_COVERAGE_THRESHOLD,
  DEFAULT_REVIEW_DISPATCH_BUDGET,
} from './reviewEngineConfig.ts';
import {
  buildPivotalReviewSession,
  savePivotalReviewSession,
  type PivotalReviewSession,
  type PivotalTurnReflection,
} from '../../training/pivotalReview/pivotalReviewStorage.ts';
import { selectPivotalTurnsFromAnalysis } from '../../training/pivotalReview/pivotalTurnSelector.ts';
import { PIVOTAL_REVIEW_WIZARD_ENABLED } from '../match/types.ts';
import { logger } from '../../utils/logger.ts';

export type UsePostGamePivotalReviewParams = {
  match: BotMatchState;
  moveLog: MoveEntry[];
  botPostGameReviewEligible: boolean;
  fritzTier: FritzTier;
  winningScore: number;
  showPostGameOverlays: boolean;
  /**
   * A5: read at game-over time to feed analyzeMoveLogDeferred's
   * reviewSnapshots option. Optional so callers that don't yet have a
   * recorder (MP, other analyzeMoveLog call sites) are unaffected.
   */
  reviewSnapshotRecorder?: ReviewSnapshotRecorder;
  /**
   * A6 persistence gate — deliberately separate from botPostGameReviewEligible.
   * That flag hides the (currently admin/beta-only) review UI; capture itself
   * is enabled much more broadly (isReviewCaptureEnabled, mode-scoped only).
   * Persistence must follow capture, not UI visibility, or snapshots are
   * captured correctly in memory but silently never survive a refresh for
   * every non-admin player. See the review-a6-persistence-gate-fix PR.
   */
  reviewCaptureEnabled: boolean;
};

export function usePostGamePivotalReview({
  match,
  moveLog,
  botPostGameReviewEligible,
  fritzTier,
  winningScore,
  showPostGameOverlays,
  reviewSnapshotRecorder,
  reviewCaptureEnabled,
}: UsePostGamePivotalReviewParams) {
  const [analyzerOpen, setAnalyzerOpen] = useState(false);
  const [currentAnalysis, setCurrentAnalysis] = useState<GameAnalysis | null>(null);
  const [reviewerScopeHandNumber, setReviewerScopeHandNumber] = useState<number | null>(null);
  const [reviewerInitialMoveIndex, setReviewerInitialMoveIndex] = useState(1);
  const [postGameReviewDismissed, setPostGameReviewDismissed] = useState(false);
  const [pivotalReviewOpen, setPivotalReviewOpen] = useState(false);
  const [pivotalReviewSummary, setPivotalReviewSummary] = useState<PivotalReviewSession | null>(null);
  const [postGameAnalysis, setPostGameAnalysis] = useState<GameAnalysis | null>(null);
  const [postGameAnalysisPending, setPostGameAnalysisPending] = useState(false);
  // B5 UI wiring: additional, independent state alongside GameAnalysis --
  // does not replace, merge into, or modify GameAnalysis/AnalyzedMove in
  // any way. Frozen into state at the same read point as the existing
  // `reviewSnapshots` read below (recorder mutates during live play, so
  // this can't be a live getSnapshots() call inside useReviewWorkerBatch
  // itself -- same reasoning as the A5 comment on that read).
  const [reviewWorkerSnapshots, setReviewWorkerSnapshots] = useState<readonly ReviewPositionSnapshotV2[]>([]);

  useEffect(() => {
    if (!match.gameOver) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the post-game review block while the match is live; the effect owns the analysis lifecycle
      setPostGameReviewDismissed(false);
      setPivotalReviewOpen(false);
      setPivotalReviewSummary(null);
      setPostGameAnalysis(null);
      setPostGameAnalysisPending(false);
      setReviewWorkerSnapshots([]);
      return;
    }

    // A6: persist the current session's snapshots so a refresh within this
    // session can reopen them. Gated on capture-eligibility, not on the
    // review-UI-eligibility check below — capture happens for any eligible
    // mode regardless of whether the (currently hidden) review UI is visible
    // to this player, so persistence must follow it, not the UI gate.
    // Single overwrite here, at game-over, not during live play — see
    // reviewSnapshotStorage.ts for why.
    if (reviewCaptureEnabled) {
      const capturedSnapshots = reviewSnapshotRecorder?.getSnapshots();
      if (capturedSnapshots) saveReviewSnapshots(capturedSnapshots);
    }

    const eligible = botPostGameReviewEligible;
    if (!eligible || !showPostGameOverlays || !moveLog.some((entry) => entry.player === 'you')) {
      setPostGameAnalysis(null);
      setPostGameAnalysisPending(false);
      setReviewWorkerSnapshots([]);
      return;
    }

    let cancelled = false;
    setPostGameAnalysisPending(true);
    // A5: read snapshots now, at game-over — the recorder is stable across
    // renders but its internal array mutates during live play, so this must
    // be a fresh read, not a hook dependency.
    const reviewSnapshots = reviewSnapshotRecorder?.getSnapshots();
    // B5 UI wiring: freeze the same read into state for useReviewWorkerBatch
    // below -- independent of, and not read by, the analyzeMoveLogDeferred
    // call immediately after.
    setReviewWorkerSnapshots(reviewSnapshots ?? []);
    void import('../../analyzer/moveAnalyzer.ts').then(({ analyzeMoveLogDeferred }) =>
      analyzeMoveLogDeferred(moveLog, true, {
        oracleMode: 'tier',
        tierPlayed: fritzTier,
        winningScore,
        reviewSnapshots,
      }),
    ).then((analysis) => {
      if (cancelled) return;
      setPostGameAnalysis(analysis);
      setPostGameAnalysisPending(false);
    }).catch((error) => {
      if (cancelled) return;
      // F19: without this, an analyzer import/run failure clears the pending flag
      // and the "review your game" prompt silently never appears, with no trace.
      setPostGameAnalysisPending(false);
      logger.warn(
        'usePostGamePivotalReview',
        'post-game analysis failed to load or run; the review-your-game prompt will not appear',
        { error: error instanceof Error ? error.message : String(error) },
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    showPostGameOverlays,
    match.gameOver,
    botPostGameReviewEligible,
    moveLog,
    fritzTier,
    winningScore,
    reviewSnapshotRecorder,
    reviewCaptureEnabled,
  ]);

  // B5 UI wiring: streaming-capable worker batch, wired as additional state
  // alongside GameAnalysis -- not consumed by GameReviewer's rendering, not
  // merged into postGameAnalysis. See logReviewWorkerBatchDiagnostics.ts
  // for the dev-only diagnostic surface this currently feeds; no
  // rating/coaching-copy translation happens here (Phase C's decision).
  const reviewWorkerBatch = useReviewWorkerBatch(
    reviewWorkerSnapshots,
    DEFAULT_REVIEW_DISPATCH_BUDGET,
    DEFAULT_REVIEW_COVERAGE_THRESHOLD,
  );

  useEffect(() => {
    if (!reviewWorkerBatch.done) return;
    if (reviewWorkerBatch.resultsByDecisionId.size === 0 && reviewWorkerBatch.errorsByDecisionId.size === 0) return;
    const correlation = correlateSnapshotsToMoveLog(reviewWorkerSnapshots, moveLog);
    logReviewWorkerBatchDiagnostics(reviewWorkerBatch, correlation);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- logs once per completed batch, keyed on `done`; reviewWorkerSnapshots/moveLog are read fresh but shouldn't retrigger this on their own reference churn
  }, [reviewWorkerBatch.done]);

  const pivotalSelection = useMemo(() => {
    // Only the wizard consumes this; skip the work when it's flagged off — the
    // result can't render (CQ9.2 F17).
    if (!PIVOTAL_REVIEW_WIZARD_ENABLED || !postGameAnalysis) return null;
    return selectPivotalTurnsFromAnalysis(postGameAnalysis, moveLog, { winningScore });
  }, [postGameAnalysis, moveLog, winningScore]);

  const skipPostGameReview = useCallback(() => {
    setPostGameReviewDismissed(true);
  }, []);

  const reopenPostGameReview = useCallback(() => {
    setPostGameReviewDismissed(false);
  }, []);

  const openHandScopedReview = useCallback(
    (handNumber: number) => {
      if (!postGameAnalysis) return;
      setReviewerScopeHandNumber(handNumber);
      setCurrentAnalysis(postGameAnalysis);
      setAnalyzerOpen(true);
    },
    [postGameAnalysis],
  );

  const openReviewGameFromPrompt = useCallback(() => {
    if (!postGameAnalysis) return;
    setPostGameReviewDismissed(true);
    setReviewerScopeHandNumber(null);
    setReviewerInitialMoveIndex(1);
    setCurrentAnalysis(postGameAnalysis);
    setAnalyzerOpen(true);
  }, [postGameAnalysis]);

  const completePivotalTurnReview = useCallback(
    (reflections: PivotalTurnReflection[]) => {
      if (!pivotalSelection) return;
      setPivotalReviewSummary(
        buildPivotalReviewSession({
          mode: 'bot',
          selection: pivotalSelection,
          reflections,
          youScore: match.players.you.score,
          opponentScore: match.players.bot.score,
        }),
      );
      setPivotalReviewOpen(false);
    },
    [match.players.bot.score, match.players.you.score, pivotalSelection],
  );

  const savePivotalReviewSummary = useCallback(() => {
    if (pivotalReviewSummary) savePivotalReviewSession(pivotalReviewSummary);
    setPivotalReviewSummary(null);
  }, [pivotalReviewSummary]);

  const closeAnalyzer = useCallback(() => {
    setAnalyzerOpen(false);
    setReviewerScopeHandNumber(null);
    setReviewerInitialMoveIndex(1);
  }, []);

  return {
    analyzerOpen,
    setAnalyzerOpen,
    currentAnalysis,
    setCurrentAnalysis,
    reviewerScopeHandNumber,
    setReviewerScopeHandNumber,
    reviewerInitialMoveIndex,
    setReviewerInitialMoveIndex,
    postGameReviewDismissed,
    setPostGameReviewDismissed,
    pivotalReviewOpen,
    setPivotalReviewOpen,
    pivotalReviewSummary,
    setPivotalReviewSummary,
    postGameAnalysis,
    postGameAnalysisPending,
    pivotalSelection,
    skipPostGameReview,
    reopenPostGameReview,
    openHandScopedReview,
    openReviewGameFromPrompt,
    completePivotalTurnReview,
    savePivotalReviewSummary,
    closeAnalyzer,
  };
}
