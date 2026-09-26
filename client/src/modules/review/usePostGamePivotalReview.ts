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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import type { GameAnalysis, ReviewEvidenceDisclosure } from '../../analyzer/moveAnalyzer.ts';
import type { ReviewCoachingFacts } from '../../analyzer/reviewCoachingFacts.ts';
import { buildPlayerDecisionLedger } from './reviewDecisionAccounting.ts';
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
  COMPLETION_REVIEW_DISPATCH_BUDGET,
  defaultReviewWorkerPoolSize,
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
import { enqueueServerReviewCompletion, pollServerReviewCompletion } from './reviewCompletionClient.ts';
import { resolveGameServerUrl } from '../../lib/gameServerUrl.ts';

export type UsePostGamePivotalReviewParams = {
  match: BotMatchState;
  moveLog: MoveEntry[];
  botPostGameReviewEligible: boolean;
  /** Selects durable server authority; false is reserved for explicit local/dev review. */
  reviewPersistenceEnabled?: boolean;
  accessToken?: string | null;
  /**
   * Gate 4: when true, persisted replay artifacts snapshot approved positional
   * coaching prose. Must match the live GameReviewer prop for the same review
   * so the shared coachingFactsStore does not mix enablement modes.
   */
  enablePositionalExplanations?: boolean;
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
   * That flag controls review UI; capture itself
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
  accessToken = null,
  enablePositionalExplanations = false,
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
  const [serverJobId, setServerJobId] = useState<string | null>(null);
  const [serverCompletion, setServerCompletion] = useState<Awaited<ReturnType<typeof pollServerReviewCompletion>>>(null);
  const [enqueueRetry, setEnqueueRetry] = useState(0);
  const enqueueKeyRef = useRef<string | null>(null);
  const loggedCaptureFailureIdsRef = useRef(new Set<string>());
  const enqueueRetryDelayMs = Math.min(2_000 * 2 ** Math.min(enqueueRetry, 4), 30_000);

  useEffect(() => {
    if (!match.gameOver) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the post-game review block while the match is live; the effect owns the analysis lifecycle
      setPostGameReviewDismissed(false);
      setPivotalReviewOpen(false);
      setPivotalReviewSummary(null);
      setPostGameAnalysis(null);
      setPostGameAnalysisPending(false);
      setReviewWorkerSnapshots([]);
      setServerJobId(null);
      setServerCompletion(null);
      setEnqueueRetry(0);
      enqueueKeyRef.current = null;
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
      for (const failure of reviewSnapshotRecorder?.getCaptureFailures?.() ?? []) {
        if (loggedCaptureFailureIdsRef.current.has(failure.decisionId)) continue;
        loggedCaptureFailureIdsRef.current.add(failure.decisionId);
        logger.error('usePostGamePivotalReview', 'canonical review snapshot capture failed', {
          decisionId: failure.decisionId,
          handId: failure.handId,
          sequence: failure.sequence,
          captureStatus: 'failed',
          failureReason: failure.reason,
        });
      }
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

  // Production Game Review is owned by the durable server job.
  // Browser workers remain available only when durable persistence is explicitly off.
  useEffect(() => {
    if (!match.gameOver || !reviewPersistenceEnabled || !reviewCaptureEnabled) return;
    if (!accessToken) {
      logger.warn('usePostGamePivotalReview', 'durable review waiting for authenticated session');
      const retryTimer = setTimeout(() => setEnqueueRetry((attempt) => attempt + 1), enqueueRetryDelayMs);
      return () => clearTimeout(retryTimer);
    }
    const playerSnapshots = reviewWorkerSnapshots.filter((snapshot) => snapshot.identifiers.actorId === 'you');
    const failures = (reviewSnapshotRecorder?.getCaptureFailures?.() ?? [])
      .filter((failure) => failure.actorId === 'you')
      .map(({ decisionId, handId, sequence, reason }) => ({ decisionId, handId, sequence, reason }));
    if (playerSnapshots.length === 0 && failures.length === 0) return;
    const expectedDecisionIds = [
      ...playerSnapshots.map((snapshot) => ({
        decisionId: snapshot.identifiers.decisionId,
        sequence: snapshot.identifiers.turnSequence,
      })),
      ...failures.map((failure) => ({ decisionId: failure.decisionId, sequence: failure.sequence })),
    ].sort((a, b) => a.sequence - b.sequence).map((entry) => entry.decisionId);
    const digest = computeGameDigest(reviewWorkerSnapshots);
    const requestKey = `${sourceMatchId}:${digest}`;
    if (enqueueKeyRef.current === requestKey) return;
    enqueueKeyRef.current = requestKey;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    void enqueueServerReviewCompletion({
      apiBase: resolveGameServerUrl(),
      authHeader: `Bearer ${accessToken}`,
      gameDigest: digest,
      sourceMatchId,
      gameId: sourceMatchId,
      snapshots: playerSnapshots,
      expectedDecisionIds,
      captureFailures: failures,
    }).then((job) => {
      if (!job) {
        enqueueKeyRef.current = null;
        logger.error('usePostGamePivotalReview', 'durable review job creation failed');
        // Keep the review pending and retry the durable request. In production
        // local browser completion is disabled, so an HTTP outage cannot
        // publish subset analysis as authoritative.
        retryTimer = setTimeout(() => setEnqueueRetry((attempt) => attempt + 1), enqueueRetryDelayMs);
        return;
      }
      setServerJobId(job.jobId);
    });
    return () => { if (retryTimer) clearTimeout(retryTimer); };
  }, [match.gameOver, reviewPersistenceEnabled, reviewCaptureEnabled, reviewWorkerSnapshots, accessToken, sourceMatchId, reviewSnapshotRecorder, enqueueRetry, enqueueRetryDelayMs]);

  useEffect(() => {
    if (!serverJobId || !accessToken || !reviewPersistenceEnabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const result = await pollServerReviewCompletion({
        apiBase: resolveGameServerUrl(),
        authHeader: `Bearer ${accessToken}`,
        jobId: serverJobId,
      });
      if (cancelled) return;
      if (result) setServerCompletion(result);
      timer = setTimeout(() => { void poll(); }, result?.complete ? 5_000 : 1_000);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [serverJobId, accessToken, reviewPersistenceEnabled]);

  // The local batch supports immediate/dev-only review. Cohort-enabled
  // production Game Review receives its authoritative results from polling.
  const localReviewWorkerBatch = useReviewWorkerBatch(
    reviewPersistenceEnabled ? [] : reviewWorkerSnapshots,
    COMPLETION_REVIEW_DISPATCH_BUDGET,
    DEFAULT_REVIEW_COVERAGE_THRESHOLD,
    undefined,
    defaultReviewWorkerPoolSize(),
  );
  const serverEvaluationsByDecisionId = useMemo(() => new Map(
    (serverCompletion?.evaluations ?? []).map((evaluation) => [evaluation.snapshotId, evaluation] as const),
  ), [serverCompletion]);
  const serverPendingIds = useMemo(() => new Set(
    (serverCompletion?.decisions ?? [])
      .filter((decision) => decision.lifecycle !== 'SCORED' && decision.lifecycle !== 'FORCED')
      .map((decision) => decision.decisionId),
  ), [serverCompletion]);
  const reviewWorkerBatch = useMemo<ReturnType<typeof useReviewWorkerBatch>>(
    () => reviewPersistenceEnabled
      ? {
          resultsByDecisionId: serverEvaluationsByDecisionId,
          errorsByDecisionId: new Map(),
          pendingDecisionIds: serverPendingIds,
          done: serverCompletion?.complete === true,
          cancel: () => {},
        }
      : localReviewWorkerBatch,
    [reviewPersistenceEnabled, serverEvaluationsByDecisionId, serverPendingIds, serverCompletion?.complete, localReviewWorkerBatch],
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
  const [finalizedResultsByDecisionId, setFinalizedResultsByDecisionId] = useState<
    ReadonlyMap<string, import('@racehorse/game-core/review').ReviewEvaluationV1>
  >(() => new Map());
  const [calibratedHandsAnalysis, setCalibratedHandsAnalysis] = useState<GameAnalysis | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (reviewWorkerSnapshots.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- tracks reviewWorkerBatch's own async lifecycle (see accuracyModelPending's doc comment above), not a prop-derived value computable during render
      setAccuracyModel(undefined);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setEvidence(undefined);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setAccuracyModelPending(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setFinalizedResultsByDecisionId(new Map());
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setCalibratedHandsAnalysis(null);
      return () => {
        cancelled = true;
      };
    }
    if (!reviewWorkerBatch.done) {
      // Progressive UX: keep final game accuracy gated, but stream calibrated
      // hand % for hands whose non-forced decisions are already SCORED so
      // Game Review is usable before Tier 3/4 finishes.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setAccuracyModel(undefined);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setEvidence(undefined);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
      setAccuracyModelPending(true);
      if (postGameAnalysis) {
        void import('./applyCalibratedHandAccuracies.ts').then(({ applyCalibratedHandAccuracies }) => {
          if (cancelled) return;
          setCalibratedHandsAnalysis(
            applyCalibratedHandAccuracies(postGameAnalysis, {
              decisionIdByMoveNumber,
              resultsByDecisionId: reviewWorkerBatch.resultsByDecisionId,
              pendingDecisionIds: reviewWorkerBatch.pendingDecisionIds,
            }),
          );
        }).catch(() => { /* progressive hand % is best-effort */ });
      }
      return () => {
        cancelled = true;
      };
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setAccuracyModelPending(true);
    // Dynamic import, same reason as analyzeMoveLogDeferred above:
    // @racehorse/review-engine's dependency graph is heavy, and this hook
    // is reachable from BotMatchScreen's eager bundle -- a static import
    // here trips check:bot-match-lazy exactly the way moveAnalyzer.ts's own
    // value re-export did (C4's first CI fix).
    void Promise.all([
      import('@racehorse/review-engine'),
      import('../../analyzer/moveAnalyzer.ts'),
      import('./applyCalibratedHandAccuracies.ts'),
    ]).then(([{ computeGameAccuracyModel, completeReviewEvaluations }, { deriveReviewEvidence }, { applyCalibratedHandAccuracies }]) => {
      if (cancelled) return;

      // Adaptive escalation over worker results — budget exhaustion stays
      // FAILED_RETRYABLE / pending, never UNAVAILABLE for fresh captures.
      const locallyCompleted = reviewPersistenceEnabled ? null : completeReviewEvaluations({
        snapshots: reviewWorkerSnapshots,
        liveResultsByDecisionId: reviewWorkerBatch.resultsByDecisionId,
        liveErrorsByDecisionId: reviewWorkerBatch.errorsByDecisionId,
        startTier: 2,
        maxTier: 4,
      });
      const completed = locallyCompleted ?? {
        resultsByDecisionId: serverEvaluationsByDecisionId,
        reasonCounts: {},
        lifecycleCounts: { PENDING: serverPendingIds.size, SEARCHING: 0, SCORED: serverCompletion?.progress.scored ?? 0, FORCED: serverCompletion?.progress.forced ?? 0, FAILED_RETRYABLE: 0, FAILED_FATAL: 0 },
        reevaluatedDecisionIds: [],
        promotedToSearchOrExact: 0,
        retryableDecisionIds: [...serverPendingIds],
        fatalDecisionIds: [],
        complete: serverCompletion?.complete === true,
      };
      setFinalizedResultsByDecisionId(completed.resultsByDecisionId);
      logger.info('usePostGamePivotalReview', 'review evaluation completion', {
        reasonCounts: completed.reasonCounts,
        lifecycleCounts: completed.lifecycleCounts,
        complete: completed.complete,
        retryable: completed.retryableDecisionIds.length,
        fatal: completed.fatalDecisionIds.length,
        resultCount: completed.resultsByDecisionId.size,
      });

      const evaluations = Array.from(completed.resultsByDecisionId.values());

      // Nothing to complete — clear pending, skip persistence (E1 empty case).
      if (evaluations.length === 0) {
        setFinalizedResultsByDecisionId(completed.resultsByDecisionId);
        setAccuracyModel(undefined);
        setEvidence(undefined);
        setCalibratedHandsAnalysis(null);
        setAccuracyModelPending(false);
        return;
      }

      const model = reviewPersistenceEnabled && serverCompletion?.complete
        ? (serverCompletion.accuracyModelResult ?? computeGameAccuracyModel(evaluations))
        : computeGameAccuracyModel(evaluations);
      const nextEvidence = deriveReviewEvidence(model);

      const authoritativeComplete = completed.complete && (
        reviewPersistenceEnabled
          ? serverCompletion?.complete === true
          : import.meta.env.DEV
      );

      // Finalization gate: production authority requires durable server COMPLETE.
      // Still stream progressive hand % for completed hands.
      if (!authoritativeComplete) {
        setAccuracyModel(undefined);
        setEvidence(undefined);
        setAccuracyModelPending(true);
        if (postGameAnalysis) {
          setCalibratedHandsAnalysis(
            applyCalibratedHandAccuracies(postGameAnalysis, {
              decisionIdByMoveNumber,
              resultsByDecisionId: completed.resultsByDecisionId,
              pendingDecisionIds: new Set(completed.retryableDecisionIds),
            }),
          );
        }
        return;
      }

      setAccuracyModel(model);
      setEvidence(nextEvidence);
      setAccuracyModelPending(false);

      const analysisForPersist = postGameAnalysis
        ? applyCalibratedHandAccuracies(
            { ...postGameAnalysis, accuracyModel: model, evidence: nextEvidence },
            {
              decisionIdByMoveNumber,
              resultsByDecisionId: completed.resultsByDecisionId,
              pendingDecisionIds: new Set(),
            },
          )
        : null;
      setCalibratedHandsAnalysis(analysisForPersist);

      // E1 persistence — fire-and-forget; never affects local UI.
      if (reviewPersistenceEnabled && evaluations.length > 0 && analysisForPersist && coachingFactsStore) {
        void Promise.all([
          import('./postGameReviewWrite.ts'),
          import('./gameReviewReplayArtifact.ts'),
        ])
          .then(([{ postGameReviewWrite }, { buildGameReviewReplayArtifact }]) => {
            const replayArtifact = buildGameReviewReplayArtifact({
              analysis: analysisForPersist,
              evaluationsByDecisionId: completed.resultsByDecisionId,
              expectedDecisionIds: reviewPersistenceEnabled
                ? (serverCompletion?.decisions ?? []).map((decision) => decision.decisionId)
                : [...completed.resultsByDecisionId.keys()],
              assertAuthoritativeComplete: true,
              decisionIdByMoveNumber,
              snapshotsByDecisionId,
              coachingFactsStore,
              enablePositionalExplanations,
            });
            postGameReviewWrite({
              gameDigest: computeGameDigest(reviewWorkerSnapshots),
              reviewEngineVersion: evaluations[0].reviewEngineVersion,
              accuracyModelVersion: model.accuracyModelVersion,
              evaluations,
              accuracyModelResult: model,
              mode: 'pvf',
              sourceMatchId,
              replayArtifact,
            });
          })
          .catch((error) => {
            // Persistence must never affect local state or the post-game UI,
            // but a failed final artifact write must remain observable.
            logger.warn('usePostGamePivotalReview', 'completed review artifact persistence failed', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      } else if (reviewPersistenceEnabled && evaluations.length > 0 && !postGameAnalysis) {
        // Analysis still pending — this effect re-runs when postGameAnalysis lands.
      } else if (reviewPersistenceEnabled && evaluations.length > 0) {
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
          .catch(() => {});
      }
    }).catch((error) => {
      if (cancelled) return;
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
  }, [reviewWorkerSnapshots, reviewWorkerBatch.done, reviewWorkerBatch.resultsByDecisionId, reviewWorkerBatch.errorsByDecisionId, reviewWorkerBatch.pendingDecisionIds, reviewPersistenceEnabled, enablePositionalExplanations, sourceMatchId, postGameAnalysis, coachingFactsStore, decisionIdByMoveNumber, snapshotsByDecisionId, serverEvaluationsByDecisionId, serverPendingIds, serverCompletion]);

  const exposedPostGameAnalysis = useMemo(() => {
    // Prefer progressive calibrated hands while final accuracyModel is still
    // gated — Game Review opens immediately with partial hand %.
    if (calibratedHandsAnalysis) {
      return {
        ...calibratedHandsAnalysis,
        ...(accuracyModel !== undefined
          ? { accuracyModel, evidence: evidence ?? calibratedHandsAnalysis.evidence }
          : {}),
      };
    }
    if (!postGameAnalysis || accuracyModel === undefined) return postGameAnalysis;
    return { ...postGameAnalysis, accuracyModel, evidence: evidence ?? postGameAnalysis.evidence };
  }, [postGameAnalysis, accuracyModel, evidence, calibratedHandsAnalysis]);

  const skipPostGameReview = useCallback(() => {
    setPostGameReviewDismissed(true);
  }, []);

  const reopenPostGameReview = useCallback(() => {
    setPostGameReviewDismissed(false);
  }, []);

  // accuracyModel/evidence are merged onto the analysis exposed to the
  // post-game prompt. Opening GameReviewer MUST use that same merged
  // object — otherwise the header stays pinned to LEGACY while the prompt
  // already shows calibrated accuracy/grade (production smoke failure
  // 2026-09-22).
  const openHandScopedReview = useCallback(
    (handNumber: number) => {
      if (!exposedPostGameAnalysis) return;
      setReviewerScopeHandNumber(handNumber);
      setCurrentAnalysis(exposedPostGameAnalysis);
      setAnalyzerOpen(true);
    },
    [exposedPostGameAnalysis],
  );

  const openReviewGameFromPrompt = useCallback(() => {
    if (!exposedPostGameAnalysis) return;
    setPostGameReviewDismissed(true);
    setReviewerScopeHandNumber(null);
    setReviewerInitialMoveIndex(1);
    setCurrentAnalysis(exposedPostGameAnalysis);
    setAnalyzerOpen(true);
  }, [exposedPostGameAnalysis]);

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

  const decisionLedger = useMemo(() => {
    if (!exposedPostGameAnalysis?.analyzedMoves) return null;
    const results =
      finalizedResultsByDecisionId.size > 0
        ? finalizedResultsByDecisionId
        : reviewWorkerBatch.resultsByDecisionId;
    return buildPlayerDecisionLedger({
      analyzedMoves: exposedPostGameAnalysis.analyzedMoves,
      decisionIdByMoveNumber,
      resultsByDecisionId: results,
      errorsByDecisionId: reviewWorkerBatch.errorsByDecisionId,
      pendingDecisionIds: reviewWorkerBatch.pendingDecisionIds,
      batchDone: reviewWorkerBatch.done && accuracyModel !== undefined,
    });
  }, [
    exposedPostGameAnalysis,
    decisionIdByMoveNumber,
    reviewWorkerBatch,
    finalizedResultsByDecisionId,
    accuracyModel,
  ]);

  const exposedReviewWorkerBatch = useMemo(() => {
    if (finalizedResultsByDecisionId.size === 0) return reviewWorkerBatch;
    return {
      ...reviewWorkerBatch,
      resultsByDecisionId: finalizedResultsByDecisionId,
      pendingDecisionIds: new Set<string>(),
      done: reviewWorkerBatch.done && accuracyModel !== undefined,
    };
  }, [reviewWorkerBatch, finalizedResultsByDecisionId, accuracyModel]);

  // While the reviewer is open, always prefer the merged exposed analysis so
  // provenance cannot stay LEGACY after accuracy/evidence resolve — without a
  // syncing effect (react-hooks/set-state-in-effect).
  const reviewerAnalysis =
    analyzerOpen && exposedPostGameAnalysis ? exposedPostGameAnalysis : currentAnalysis;

  const closeAnalyzer = useCallback(() => {
    setAnalyzerOpen(false);
    setReviewerScopeHandNumber(null);
    setReviewerInitialMoveIndex(1);
  }, []);

  return {
    analyzerOpen,
    setAnalyzerOpen,
    currentAnalysis: reviewerAnalysis,
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
    decisionLedger,
    reviewWorkerBatch: exposedReviewWorkerBatch,
    decisionIdByMoveNumber,
    coachingFactsStore,
    snapshotsByDecisionId,
    enablePositionalExplanations,
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
