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
import type { GameAnalysis, ReviewEvidenceDisclosure } from '../../analyzer/moveAnalyzer.ts';
import type { ReviewCoachingFacts } from '../../analyzer/reviewCoachingFacts.ts';
import type { GameAccuracyModelResult } from '@racehorse/review-engine';
import { computeGameDigest } from './gameDigest.ts';
import type { MoveEntry } from '../../game/moveLogger.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { FritzTier } from '../fritz/fritzConfig.ts';
import type { ReviewSnapshotRecorder } from './ReviewSnapshotRecorder.ts';
import { saveReviewSnapshots } from './reviewSnapshotStorage.ts';
import { useReviewWorkerBatch } from './useReviewWorkerBatch.ts';
import { buildDecisionIdByMoveNumber, correlateSnapshotsToMoveLog } from './correlateSnapshotsToMoveLog.ts';
import { logReviewWorkerBatchDiagnostics } from './logReviewWorkerBatchDiagnostics.ts';
import {
  DEFAULT_REVIEW_COVERAGE_THRESHOLD,
  DEFAULT_REVIEW_DISPATCH_BUDGET,
} from './reviewEngineConfig.ts';
import {
  createReviewCoachingFactsStore,
  type ReviewCoachingFactsStore,
} from './reviewCoachingFactsStore.ts';
import {
  buildPivotalReviewSession,
  savePivotalReviewSession,
  type PivotalReviewSession,
  type PivotalTurnReflection,
} from '../../training/pivotalReview/pivotalReviewStorage.ts';
import type { PivotalTurnSelection } from '../../training/pivotalReview/pivotalTurnSelector.ts';
import { PIVOTAL_REVIEW_WIZARD_ENABLED } from '../match/types.ts';
import { logger } from '../../utils/logger.ts';

export type UsePostGamePivotalReviewParams = {
  match: BotMatchState;
  moveLog: MoveEntry[];
  botPostGameReviewEligible: boolean;
  /** Server cohort gate for persistence; local analysis/UI is independent. */
  reviewPersistenceEnabled?: boolean;
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
  /**
   * E1 (game-review-oracle-upgrade-2026-09-13.md, Phase E): a stable
   * identifier for this PVF match, generated once at match start
   * (useReviewRuntime.ts, mirroring MP's room-code generation pattern) and
   * threaded down to tag the persisted game_reviews row (E0c's
   * `sourceMatchId`). Not the same value as ReviewSnapshotRecorder's own
   * sessionId/gameId -- those key the in-memory review-capture session,
   * this identifies the real match a persisted row belongs to.
   */
  sourceMatchId: string;
};

export function usePostGamePivotalReview({
  match,
  moveLog,
  botPostGameReviewEligible,
  reviewPersistenceEnabled = true,
  fritzTier,
  winningScore,
  showPostGameOverlays,
  reviewSnapshotRecorder,
  reviewCaptureEnabled,
  sourceMatchId,
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
  // alongside GameAnalysis -- never merged into postGameAnalysis or
  // GameAnalysis/AnalyzedMove's own shape. Originally dev-diagnostic-only;
  // now also exposed below (reviewWorkerBatch, decisionIdByMoveNumber) as
  // progressive-enhancement data a render layer can opt into per move --
  // still no rating/coaching-copy translation happening in this hook
  // itself (that's classifyHeuristicResult's job, called from the render
  // layer, not here).
  const reviewWorkerBatch = useReviewWorkerBatch(
    reviewWorkerSnapshots,
    DEFAULT_REVIEW_DISPATCH_BUDGET,
    DEFAULT_REVIEW_COVERAGE_THRESHOLD,
  );

  // Computed once here (this hook already holds both reviewWorkerSnapshots
  // and moveLog in scope) rather than leaking the raw snapshots array to
  // callers just so they can build this themselves -- a plain moveNumber ->
  // decisionId map is the minimal, directly-usable shape a per-move
  // selector needs.
  const decisionIdByMoveNumber = useMemo(
    () => buildDecisionIdByMoveNumber(reviewWorkerSnapshots, moveLog),
    [reviewWorkerSnapshots, moveLog],
  );

  // Canonical coaching-facts store for this review instance. Fresh Map when
  // snapshots / match identity change; survives GameReviewer remount so cursor
  // and reopen reuse the same published facts. Persistence still writes only
  // evaluations (F1e-5 will later persist/load this artifact).
  // Identity uses decision IDs (always present on stubs) rather than
  // computeGameDigest, which requires integrity digests not present in every
  // test fixture.
  const coachingFactsStore = useMemo((): ReviewCoachingFactsStore<ReviewCoachingFacts> | null => {
    if (reviewWorkerSnapshots.length === 0) return null;
    const decisionKey = reviewWorkerSnapshots.map((s) => s.identifiers.decisionId).join(',');
    return createReviewCoachingFactsStore<ReviewCoachingFacts>(`${sourceMatchId}:${decisionKey}`);
  }, [sourceMatchId, reviewWorkerSnapshots]);

  const snapshotsByDecisionId = useMemo(() => {
    const map = new Map<string, ReviewPositionSnapshotV2>();
    for (const snapshot of reviewWorkerSnapshots) {
      map.set(snapshot.identifiers.decisionId, snapshot);
    }
    return map;
  }, [reviewWorkerSnapshots]);

  useEffect(() => {
    if (!reviewWorkerBatch.done) return;
    if (reviewWorkerBatch.resultsByDecisionId.size === 0 && reviewWorkerBatch.errorsByDecisionId.size === 0) return;
    const correlation = correlateSnapshotsToMoveLog(reviewWorkerSnapshots, moveLog);
    logReviewWorkerBatchDiagnostics(reviewWorkerBatch, correlation);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- logs once per completed batch, keyed on `done`; reviewWorkerSnapshots/moveLog are read fresh but shouldn't retrigger this on their own reference churn
  }, [reviewWorkerBatch.done]);

  const [pivotalSelection, setPivotalSelection] = useState<PivotalTurnSelection | null>(null);
  useEffect(() => {
    // Require a completed batch for a stable top-N and clear the prior selection.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- owns async selection lifecycle
    setPivotalSelection(null);
    if (!PIVOTAL_REVIEW_WIZARD_ENABLED || !postGameAnalysis || !reviewWorkerBatch.done) return;
    let cancelled = false;
    // The selector reuses review-engine's isScorable. Keep that dependency off
    // BotMatchScreen's eager graph, as with the accuracy model below.
    void import('../../training/pivotalReview/pivotalTurnSelector.ts').then(({ selectPivotalTurnsFromAnalysis }) => {
      if (cancelled) return;
      setPivotalSelection(selectPivotalTurnsFromAnalysis(postGameAnalysis, moveLog, {
        winningScore,
        evaluationsByDecisionId: reviewWorkerBatch.resultsByDecisionId,
        decisionIdByMoveNumber,
      }));
    }).catch((error) => {
      if (!cancelled) logger.warn('usePostGamePivotalReview', 'pivotal selection failed', { error: String(error) });
    });
    return () => { cancelled = true; };
  }, [postGameAnalysis, moveLog, winningScore, reviewWorkerBatch.done, reviewWorkerBatch.resultsByDecisionId, decisionIdByMoveNumber]);

  // C4 UI follow-up (phase-c-accuracy-model-spec.md section 6): the coverage
  // floor's real input, computed from reviewWorkerBatch's real per-decision
  // ReviewEvaluationV1 data -- the exact data source moveAnalyzer.ts's own
  // `accuracyModel?` doc comment names as the missing piece.
  //
  // `accuracyModelPending` is real state, not derived inline from
  // `!reviewWorkerBatch.done` -- it stays true until `accuracyModel` has
  // actually been set for the current batch, not merely until `done`
  // flips. `computeGameAccuracyModel` is loaded via a dynamic import below
  // (see that comment for why), which resolves on a LATER microtask than
  // the render where `done` becomes true -- deriving pending from `done`
  // alone reintroduces exactly the legacy-then-swap flash this whole
  // wiring was built to avoid: `done` true + `accuracyModel` still
  // undefined, for one real (if brief) window, is precisely that flash.
  // Still short-circuits to `false` immediately for zero snapshots (no
  // worker spawned, nothing will ever resolve) -- unchanged from before.
  const [accuracyModelPending, setAccuracyModelPending] = useState(false);
  const [accuracyModel, setAccuracyModel] = useState<GameAccuracyModelResult | undefined>(undefined);
  // Derived alongside accuracyModel, from the same resolved data, so
  // GameReviewer's evidence banner stops being permanently pinned to
  // LEGACY_ANALYSIS_DISCLOSURE once real oracle coverage exists -- see
  // deriveReviewEvidence's doc comment (moveAnalyzer.ts) for the gate.
  const [evidence, setEvidence] = useState<ReviewEvidenceDisclosure | undefined>(undefined);

  useEffect(() => {
    if (reviewWorkerSnapshots.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- tracks reviewWorkerBatch's own async lifecycle (see accuracyModelPending's doc comment above), not a prop-derived value computable during render
      setAccuracyModel(undefined);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setEvidence(undefined);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setAccuracyModelPending(false);
      return;
    }
    if (!reviewWorkerBatch.done) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setAccuracyModel(undefined);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setEvidence(undefined);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setAccuracyModelPending(true);
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setAccuracyModelPending(true);
    let cancelled = false;
    const evaluations = Array.from(reviewWorkerBatch.resultsByDecisionId.values());
    // Dynamic import, same reason as analyzeMoveLogDeferred above:
    // @racehorse/review-engine's dependency graph is heavy, and this hook
    // is reachable from BotMatchScreen's eager bundle -- a static import
    // here trips check:bot-match-lazy exactly the way moveAnalyzer.ts's own
    // value re-export did (C4's first CI fix). computeGameAccuracyModel
    // relocated here from client/src/analyzer/gameAccuracyModel.ts in E2
    // (Phase E) so server-side reconciliation can compute the identical
    // result -- import it directly from the package, never statically from
    // anywhere in the standard bot-match path. deriveReviewEvidence lives in
    // moveAnalyzer.ts, itself only reachable dynamically from this hook for
    // the same lazy-boundary reason (see the analyzeMoveLogDeferred import
    // above) -- bundled into this same dynamic import, matching
    // MultiplayerGameShell.tsx's existing Promise.all pattern for two
    // dynamic imports resolved together.
    void Promise.all([
      import('@racehorse/review-engine'),
      import('../../analyzer/moveAnalyzer.ts'),
    ]).then(([{ computeGameAccuracyModel }, { deriveReviewEvidence }]) => {
      if (cancelled) return;
      const model = computeGameAccuracyModel(evaluations);
      setAccuracyModel(model);
      setEvidence(deriveReviewEvidence(model));
      setAccuracyModelPending(false);

      // E1 (game-review-oracle-upgrade-2026-09-13.md, Phase E): fire-and-
      // forget persistence write -- never awaited. Persistence failure must
      // never affect local state or the post-game UI; nothing above this
      // point depends on what happens here. Skipped when there are zero
      // resolved evaluations -- nothing real to persist.
      //
      // Dynamic import, same lazy-boundary reason as @racehorse/review-engine
      // above: postGameReviewWrite.ts pulls in api/client.ts -> lib/supabase.ts,
      // which reads import.meta.env at module scope -- fine under
      // Vite/Vitest, but a static import here would also load eagerly under
      // the plain-Node `tsx` runner usePostGamePivotalReview.behaviorTests.ts
      // uses (npm run test:bot-hooks), where import.meta.env is undefined
      // and the module throws just from being imported, before any test
      // even runs. The .catch() below covers both an import failure and a
      // postGameReviewWrite failure with the same "never affect local
      // state" handling -- no need to distinguish them.
      //
      // Local analysis/UI is available to guests and non-cohort users, but
      // server persistence remains cohort-gated. This preserves the original
      // in-memory fallback without issuing writes that the server would reject.
      if (reviewPersistenceEnabled && evaluations.length > 0) {
        void import('./postGameReviewWrite.ts')
          .then(({ postGameReviewWrite }) => {
            postGameReviewWrite({
              gameDigest: computeGameDigest(reviewWorkerSnapshots),
              reviewEngineVersion: evaluations[0].reviewEngineVersion,
              accuracyModelVersion: model.accuracyModelVersion,
              evaluations,
              accuracyModelResult: model,
              mode: 'pvf',
              sourceMatchId,
            });
          })
          .catch(() => {
            // Persistence must never affect local state or the post-game UI.
          });
      }
    }).catch((error) => {
      if (cancelled) return;
      // Leaves accuracyModel at its default (undefined) -- the prompt falls
      // back to the legacy accuracy/grade, same as any other GameAnalysis
      // without a computed accuracyModel. Still clears pending -- a
      // permanently-pending loading state on import failure would be worse
      // than the legacy fallback.
      setAccuracyModelPending(false);
      logger.warn(
        'usePostGamePivotalReview',
        'accuracyModel chunk failed to load; falling back to legacy accuracy/grade',
        { error: error instanceof Error ? error.message : String(error) },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [reviewWorkerSnapshots, reviewWorkerBatch.done, reviewWorkerBatch.resultsByDecisionId, reviewPersistenceEnabled, sourceMatchId]);

  // Merged only into the value exposed as `postGameAnalysis` below -- the
  // internal `postGameAnalysis` state above (read by pivotalSelection,
  // openHandScopedReview, openReviewGameFromPrompt) is left untouched
  // on purpose. accuracyModel doesn't affect pivotal-turn selection or
  // GameReviewer's (D2) per-move rendering, so there's no reason to widen
  // this change's blast radius to those call sites.
  const exposedPostGameAnalysis = useMemo(() => {
    if (!postGameAnalysis || accuracyModel === undefined) return postGameAnalysis;
    // evidence is set in the same state update as accuracyModel above, so
    // by the time accuracyModel !== undefined, evidence is too -- but the
    // `?? postGameAnalysis.evidence` fallback keeps this honest (rather
    // than asserting) if that ever stops being true.
    return { ...postGameAnalysis, accuracyModel, evidence: evidence ?? postGameAnalysis.evidence };
  }, [postGameAnalysis, accuracyModel, evidence]);

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
    postGameAnalysis: exposedPostGameAnalysis,
    postGameAnalysisPending,
    accuracyModelPending,
    reviewWorkerBatch,
    decisionIdByMoveNumber,
    coachingFactsStore,
    snapshotsByDecisionId,
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
