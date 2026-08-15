import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotActionResult } from '../runtime/botEngine.ts';
import {
  DAILY_FRITZ_HAND_AUTO_ADVANCE_MS,
  emitHandLifecycleDebugLog,
  isDailyFritzAdvanceLocked,
  isDailyFritzSetTerminal,
  logDailyFritzHandBreadcrumb,
  warnHandLifecycleStuck,
} from '../hand-lifecycle/handLifecycleRules.ts';
import {
  DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
  DailyFritzEndOfRunError,
  DailyFritzNextHandHttpError,
  formatDailyFritzNextHandUserMessage,
  isRetryableDailyFritzNextHandError,
  type DailyFritzNextHandResponse,
} from '../../daily/dailyFritzContracts.ts';
import { resolveDailyFritzCompletedHandNextHandFailure } from '../../../dailyFritz/dailyFritzNextHandFailurePolicy.ts';
import { dailyFritzDebugLog, shouldLogDailyFritzDebug } from '../../daily/dailyFritzMatchDiagnostics.ts';
import { resolveGameServerUrl } from '../../../lib/gameServerUrl.ts';
import { HandAdvanceRetryScheduler } from '../hand-lifecycle/handAdvanceRetry.ts';
import { playHandEndAudioEffects } from '../hand-lifecycle/handAudioEffects.ts';
import { applyBotActionUiEffects } from '../hand-lifecycle/handUiEffects.ts';
import { HandPrefetchCoordinator } from '../hand-lifecycle/handPrefetchCoordinator.ts';
import {
  buildDailyFritzCompletedHandEvidenceKey,
  buildDailyFritzPrefetchParams,
  computeDailyFritzMinAdvanceAtOnHandComplete,
  createDailyFritzNextHandRequest,
  createEndOfRunMatchState,
  logDailyFritzHandComplete,
  tryApplyDailyFritzNextHand,
} from '../hand-lifecycle/dailyFritzHandService.ts';
import { planLocalHandAdvance } from '../hand-lifecycle/guidedHandCoordinator.ts';
import { planGuidedV2HandAdvance } from '../bootstrap/lessonV2LazyRegistry.ts';
import { useHandRevealScheduler } from '../hand-lifecycle/useHandRevealScheduler.ts';
import { useHandLifecycleWatchdogs } from '../hand-lifecycle/useHandLifecycleWatchdogs.ts';
import type {
  DailyFritzPrefetchParams,
  HandLifecycleDebugSnapshot,
  HandLifecyclePorts,
  UseHandLifecycleArgs,
  UseHandLifecycleResult,
} from '../hand-lifecycle/types.ts';
import {
  buildDailyFritzStorageKey,
  discardDailyFritzSnapshotBeforeReload,
} from '../../daily/dailyFritzSessionStorage.ts';
import { recordDailyFritzTelemetry } from '../../../dailyFritz/api.ts';
import { dailyFritzTelemetryEventId, getDailyFritzTelemetrySession } from '../../../dailyFritz/telemetry.ts';

export type { HandLifecyclePorts, HandLifecycleDebugSnapshot, UseHandLifecycleArgs, UseHandLifecycleResult };
export const autoAdvanceMs = DAILY_FRITZ_HAND_AUTO_ADVANCE_MS;

export function useHandLifecycle(args: UseHandLifecycleArgs): UseHandLifecycleResult {
  const {
    match,
    setMatch,
    matchRef,
    lifecycle,
    mode,
    isDailyFritzMode,
    isGuidedMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    isAuthoringMode,
    isMuted,
    opponentLabel,
    dailyFritzPackage,
    dailyFritzTranscriptProtocolVersion,
    dailyFritzHandIndex,
    dailyFritzAuthorityRevision,
    applyDailyFritzAuthorityCursor,
    initialDailyFritzHandResult,
    setDailyFritzHandResult,
    frozenV2Lesson,
    frozenLesson,
    fritzV2LastAppliedIndexRef,
    setGuidedV2EventIndex,
    setIsGuidedV2OffLine,
    lastDailyFlowLabelRef,
    getMoveLog,
    ports,
  } = args;

  const [handAdvanceError, setHandAdvanceError] = useState<string | null>(null);
  const [showManualHandAdvance, setShowManualHandAdvance] = useState(false);

  const handTransitionInFlightRef = useRef(false);
  const reloadRequiredRef = useRef(false);
  const transitionStateRef = useRef({ dailyFritzNextHandFailureCount: 0 });
  const prefetchCoordinatorRef = useRef(new HandPrefetchCoordinator());
  const completedHandEvidenceRef = useRef<{
    key: string;
    params: DailyFritzPrefetchParams;
  } | null>(null);
  const advanceRetryRef = useRef(new HandAdvanceRetryScheduler());
  const advanceHandRef = useRef<() => void>(() => {});

  const traceHandLifecycle = useCallback(
    (
      phase: import('@racehorse/match-protocol').HandLifecyclePhase,
      detail?: Record<string, unknown>,
      hypothesisId?: string,
    ) => {
      lifecycle.transition(
        phase,
        { mode, getHandNumber: () => matchRef.current.handNumber },
        detail,
        hypothesisId,
      );
    },
    [lifecycle, mode, matchRef],
  );

  const prefetchCoordinator = prefetchCoordinatorRef.current;
  const advanceRetry = advanceRetryRef.current;

  useEffect(() => {
    const advanceRetry = advanceRetryRef.current;
    const prefetchCoordinator = prefetchCoordinatorRef.current;
    return () => {
      advanceRetry.dispose();
      prefetchCoordinator.clear();
    };
  }, []);

  useEffect(() => {
    completedHandEvidenceRef.current = null;
    prefetchCoordinatorRef.current.clear();
  }, [dailyFritzPackage?.attempt_id, dailyFritzPackage?.current_game_number]);

  const handleAutoAdvance = useCallback(() => {
    advanceHandRef.current();
  }, []);

  const handleRevealShown = useCallback(() => {
    setHandAdvanceError(null);
    transitionStateRef.current.dailyFritzNextHandFailureCount = 0;
  }, [setHandAdvanceError]);

  const handleRevealHidden = useCallback(() => {
    setShowManualHandAdvance(false);
  }, [setShowManualHandAdvance]);

  const handlePrefetchReady = useCallback(() => {
    return prefetchCoordinatorRef.current.hasReadyResult();
  }, []);

  const handleHandTransitionInFlight = useCallback(() => {
    return handTransitionInFlightRef.current;
  }, []);

  const reveal = useHandRevealScheduler({
    match,
    matchRef,
    mode,
    isDailyFritzMode,
    isGuidedMode,
    isGuidedV2Mode,
    lastDailyFlowLabelRef,
    traceHandLifecycle,
    onAutoAdvance: handleAutoAdvance,
    onRevealShown: handleRevealShown,
    onRevealHidden: handleRevealHidden,
    prefetchReady: handlePrefetchReady,
    handTransitionInFlight: handleHandTransitionInFlight,
    initialHandReveal: initialDailyFritzHandResult,
  });

  const applyDailyFritzNextHandResponse = useCallback(
    (response: DailyFritzNextHandResponse, source: string) => {
      lastDailyFlowLabelRef.current = 'next-hand-start';
      dailyFritzDebugLog('[daily-fritz-hand] applying next hand', {
        source,
        gameNumber: response.game_number ?? dailyFritzPackage?.current_game_number ?? 1,
        currentHandIndex: response.current_hand_index,
        nextHandNumber: matchRef.current.handNumber + 1,
        replayed: Boolean(response.replayed),
        ignored: Boolean(response.ignored),
      });
      traceHandLifecycle('dealing-next-hand', { source }, 'D');

      const live = matchRef.current;
      const challengeHandOnlyGameOver = Boolean(
        dailyFritzPackage?.challenge_code
        && Math.max(live.players.you.score, live.players.bot.score) < dailyFritzPackage.winning_score,
      );
      const challengeStateForHandAdvance = challengeHandOnlyGameOver && live.gameOver
        ? { ...live, gameOver: false, winnerId: null }
        : live;
      const nextStateResult = tryApplyDailyFritzNextHand(
        challengeStateForHandAdvance,
        response.hand,
        response.current_game_scores,
      );
      const applied = nextStateResult.applied;
      if (nextStateResult.applied) {
        // Commit the server cursor only when the matching deal can also be
        // committed. Persistence rejects the brief cross-store render, so the
        // cursor can never durably relabel the previous terminal hand.
        applyDailyFritzAuthorityCursor({
          handIndex: response.current_hand_index,
          revision: response.authority_revision
            ?? dailyFritzPackage?.authority_revision
            ?? 0,
        });
        setDailyFritzHandResult(null);
        transitionStateRef.current.dailyFritzNextHandFailureCount = 0;
        reloadRequiredRef.current = false;
        setHandAdvanceError(null);
        setShowManualHandAdvance(false);
        // Keep the hand-over surface mounted until the new deal is accepted.
        // If application fails, the same reveal must remain available to show
        // the retry/error state instead of leaving the old board uncovered.
        reveal.dismissRevealForAdvance();
        setMatch(nextStateResult.nextState);
      } else {
        warnHandLifecycleStuck('setMatch skipped — hand not over', {
          handOver: live.handOver,
          gameOver: live.gameOver,
          source,
        });
        emitHandLifecycleDebugLog({
          location: 'BotMatchScreen.tsx:applyDailyFritzNextHandResponse',
          message: 'setMatch-noop',
          hypothesisId: 'D',
          data: { handOver: live.handOver, gameOver: live.gameOver, source },
        });
      }

      prefetchCoordinator.clear();
      completedHandEvidenceRef.current = null;
      handTransitionInFlightRef.current = false;
      if (applied) {
        traceHandLifecycle('playing', { source, handIndex: response.current_hand_index });
      } else {
        traceHandLifecycle('error', { source, reason: 'setMatch-noop' }, 'D');
        setHandAdvanceError('Could not start the next hand. Tap Continue to retry.');
        if (dailyFritzPackage) {
          const sessionId = getDailyFritzTelemetrySession(dailyFritzPackage.run_date);
          void recordDailyFritzTelemetry({
            eventId: dailyFritzTelemetryEventId(
              dailyFritzPackage.attempt_id,
              'recovery_started',
              `next-hand-apply:${response.current_hand_index}`,
            ),
            eventType: 'recovery_started',
            attemptId: dailyFritzPackage.attempt_id,
            runDate: dailyFritzPackage.run_date,
            challengeId: dailyFritzPackage.challenge_id ?? null,
            sessionId,
            failureCode: 'next_hand_apply_rejected',
            payload: {
              transitionPhase: 'apply-next-hand',
              clientCursor: {
                gameNumber: dailyFritzPackage.current_game_number ?? 1,
                handIndex: dailyFritzHandIndex,
                authorityRevision: dailyFritzAuthorityRevision,
              },
              serverCursor: {
                gameNumber: response.current_game_number ?? response.game_number ?? 1,
                handIndex: response.current_hand_index,
                authorityRevision: response.authority_revision ?? null,
              },
              matchHandNumber: live.handNumber,
              recoveryDecision: 'show_modal_retry',
            },
          });
        }
        logDailyFritzHandBreadcrumb('manual-advance-shown', { reason: 'setMatch-noop', source });
        setShowManualHandAdvance(true);
      }
    },
    [
      dailyFritzPackage?.challenge_code,
      dailyFritzPackage?.current_game_number,
      dailyFritzPackage?.winning_score,
      dailyFritzAuthorityRevision,
      dailyFritzHandIndex,
      lastDailyFlowLabelRef,
      matchRef,
      prefetchCoordinator,
      reveal,
      applyDailyFritzAuthorityCursor,
      setDailyFritzHandResult,
      setMatch,
      traceHandLifecycle,
    ],
  );

  const advanceHand = useCallback(() => {
    const live = matchRef.current;
    const challengeHandOnlyGameOver = Boolean(
      isDailyFritzMode
      && dailyFritzPackage?.challenge_code
      && Math.max(live.players.you.score, live.players.bot.score) < dailyFritzPackage.winning_score,
    );

    if (live.gameOver && !challengeHandOnlyGameOver) {
      traceHandLifecycle('match-complete', { reason: 'advance-skipped-game-over' });
      return;
    }
    if (isDailyFritzMode && isDailyFritzSetTerminal(dailyFritzPackage?.set_result)) {
      traceHandLifecycle('set-complete', { reason: 'advance-skipped-set-terminal' });
      return;
    }
    if (handTransitionInFlightRef.current) {
      dailyFritzDebugLog('[daily-flow] advanceHand skipped — transition already in flight');
      emitHandLifecycleDebugLog({
        location: 'BotMatchScreen.tsx:advanceHand',
        message: 'advanceHand-skipped-in-flight',
        hypothesisId: 'B',
        data: { handNumber: matchRef.current.handNumber },
      });
      return;
    }

    traceHandLifecycle('advancing-hand', {
      prefetchReady: prefetchCoordinator.hasReadyResult(),
      hasPrefetchPromise: prefetchCoordinator.hasInFlightRequest(),
    });

    if (isDailyFritzMode) {
      lastDailyFlowLabelRef.current = 'reveal-end';
      dailyFritzDebugLog('[daily-flow] reveal end', {
        handNumber: matchRef.current.handNumber,
        prefetchReady: prefetchCoordinator.hasReadyResult(),
        handTransitionInFlight: handTransitionInFlightRef.current,
      });
    }

    ports.invalidateLocalRuns();
    ports.setSelectedTile(null);
    ports.flashLastPlayed(null);
    ports.setLastBotChoice(null);

    if (isDailyFritzMode && dailyFritzPackage) {
      const minAdvanceAt = reveal.dailyFritzMinAdvanceAtRef.current;
      const nowMs = Date.now();
      if (isDailyFritzAdvanceLocked(minAdvanceAt, nowMs)) {
        const remainingMs = (minAdvanceAt ?? nowMs) - nowMs;
        advanceRetry.schedule(Math.max(80, Math.ceil(remainingMs)), 'reveal-window-guard', () => {
          advanceHandRef.current();
        });
        return;
      }

      handTransitionInFlightRef.current = true;
      reveal.clearAutoAdvanceTimer('advance-start');

      const handleEndOfRun = (reason: string) => {
        dailyFritzDebugLog('[daily-flow] end-of-run detected from server', {
          reason,
          handNumber: matchRef.current.handNumber,
        });
        lastDailyFlowLabelRef.current = 'match-complete';
        handTransitionInFlightRef.current = false;
        prefetchCoordinator.clear();
        completedHandEvidenceRef.current = null;
        reveal.dailyFritzMinAdvanceAtRef.current = null;
        setHandAdvanceError(null);
        setShowManualHandAdvance(false);
        reveal.setHandReveal(null);
        traceHandLifecycle('match-complete', { reason });
        setMatch((prev) => createEndOfRunMatchState(prev));
      };

      const cacheSnapshot = prefetchCoordinator.entry;
      if (cacheSnapshot?.error instanceof DailyFritzEndOfRunError) {
        handleEndOfRun(cacheSnapshot.error.message);
        return;
      }
      if (cacheSnapshot?.result) {
        dailyFritzDebugLog('[hand-over] advancing-next-hand', { source: 'prefetch-hit' });
        applyDailyFritzNextHandResponse(cacheSnapshot.result, 'prefetch-hit');
        return;
      }

      const gameNumber = (dailyFritzPackage.current_game_number ?? 1);
      const evidenceKey = buildDailyFritzCompletedHandEvidenceKey(
        dailyFritzPackage,
        gameNumber,
        dailyFritzHandIndex,
        matchRef.current.handNumber,
      );
      const frozenEvidence = completedHandEvidenceRef.current;
      const prefetchParams = frozenEvidence?.key === evidenceKey
        ? frozenEvidence.params
        : buildDailyFritzPrefetchParams(
            dailyFritzPackage,
            dailyFritzHandIndex,
            matchRef.current,
            getMoveLog(),
            dailyFritzTranscriptProtocolVersion,
          );
      if (frozenEvidence?.key !== evidenceKey) {
        completedHandEvidenceRef.current = { key: evidenceKey, params: prefetchParams };
      }
      const source = cacheSnapshot?.promise ? 'advance-await-prefetch' : 'advance-fetch';
      const activeCache = prefetchCoordinator.ensureRequest(prefetchParams, source);

      void prefetchCoordinator
        .resolve(() => createDailyFritzNextHandRequest(prefetchParams))
        .then((response) => {
          activeCache.result = response;
          const requestEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
          dailyFritzDebugLog('[daily-fritz-hand] next hand response', {
            source,
            gameNumber: response.game_number ?? prefetchParams.gameNumber,
            currentHandIndex: response.current_hand_index,
            replayed: Boolean(response.replayed),
            ignored: Boolean(response.ignored),
            durationMs: Number((requestEndedAt - activeCache.startedAt).toFixed(1)),
          });
          applyDailyFritzNextHandResponse(response, source);
        })
        .catch((err) => {
          if (err instanceof DailyFritzEndOfRunError) {
            handleEndOfRun(err.message);
            return;
          }
          const errMsg = err instanceof Error ? err.message : 'Failed to load next Daily Fritz hand.';
          activeCache.error = err;
          handTransitionInFlightRef.current = false;
          transitionStateRef.current.dailyFritzNextHandFailureCount += 1;
          const failureAttempt = transitionStateRef.current.dailyFritzNextHandFailureCount;
          const isAbort = err instanceof Error && err.message.toLowerCase().includes('timed out');
          const isRetryable = isRetryableDailyFritzNextHandError(err);
          const verifierCode = err instanceof DailyFritzNextHandHttpError
            ? err.verifierCode
            : null;
          const emitModalFailureTelemetry = (recoveryDecision: string) => {
            const sessionId = getDailyFritzTelemetrySession(dailyFritzPackage.run_date);
            void recordDailyFritzTelemetry({
              eventId: dailyFritzTelemetryEventId(
                dailyFritzPackage.attempt_id,
                'recovery_started',
                `next-hand:${dailyFritzHandIndex}:${failureAttempt}:${verifierCode ?? 'transport'}`,
              ),
              eventType: 'recovery_started',
              attemptId: dailyFritzPackage.attempt_id,
              runDate: dailyFritzPackage.run_date,
              challengeId: dailyFritzPackage.challenge_id ?? null,
              sessionId,
              failureCode: verifierCode ?? (isAbort ? 'timeout' : 'next_hand_request_failed'),
              payload: {
                transitionPhase: 'next-hand-request',
                endpoint: '/api/daily-fritz/next-hand',
                clientCursor: {
                  gameNumber: prefetchParams.gameNumber,
                  handIndex: dailyFritzHandIndex,
                  authorityRevision: dailyFritzAuthorityRevision,
                },
                serverCursor: err instanceof DailyFritzNextHandHttpError
                  ? {
                      authorityRevision: err.authorityRevision,
                      authoritativeState: err.authoritativeState,
                    }
                  : null,
                lifecyclePhase: matchRef.current.gameOver
                  ? 'completed'
                  : matchRef.current.handOver ? 'hand_transition' : 'active_hand',
                matchHandNumber: matchRef.current.handNumber,
                status: err instanceof DailyFritzNextHandHttpError ? err.status : null,
                verifierCode,
                recoveryDecision,
              },
            });
          };
          emitHandLifecycleDebugLog({
            location: 'BotMatchScreen.tsx:advanceHand',
            message: 'advanceHand-network-error',
            hypothesisId: isAbort ? 'A' : 'B',
            data: {
              source,
              error: errMsg,
              failureAttempt,
              handNumber: matchRef.current.handNumber,
              timeoutMs: DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
              nextHandUrl: `${resolveGameServerUrl()}/api/daily-fritz/next-hand`,
              isRetryable,
            },
          });
          if (!isRetryable) {
            const status = err instanceof DailyFritzNextHandHttpError ? err.status : null;
            const recovery = resolveDailyFritzCompletedHandNextHandFailure({
              verifierCode,
              status,
              failureAttempt,
            });
            if (recovery.kind === 'rebuild') {
              prefetchCoordinator.clear();
              completedHandEvidenceRef.current = null;
              advanceRetry.schedule(recovery.delayMs, recovery.reason, () => advanceHandRef.current());
              return;
            }
            setHandAdvanceError(recovery.message);
            logDailyFritzHandBreadcrumb('manual-advance-shown', {
              reason: recovery.reason,
              source,
              failureAttempt,
              status,
              verifierCode,
              error: errMsg,
            });
            setShowManualHandAdvance(true);
            emitModalFailureTelemetry('show_modal_retry');
            traceHandLifecycle('error', {
              source,
              error: errMsg,
              failureAttempt,
              status,
              verifierCode,
              willRetry: false,
            }, 'C');
            return;
          }
          const retryDelaysMs = [1000, 2500, 5000];
          if (failureAttempt <= retryDelaysMs.length) {
            const retryDelayMs = retryDelaysMs[failureAttempt - 1]!;
            logDailyFritzHandBreadcrumb('next-hand-silent-retry', {
              source,
              failureAttempt,
              retryDelayMs,
              error: errMsg,
            });
            traceHandLifecycle('error', { source, error: errMsg, failureAttempt, retryDelayMs, willRetry: true }, 'C');
            advanceRetry.schedule(retryDelayMs, 'next-hand-fetch-failed', () => advanceHandRef.current());
            return;
          }
          setHandAdvanceError(formatDailyFritzNextHandUserMessage(errMsg));
          logDailyFritzHandBreadcrumb('manual-advance-shown', {
            reason: 'next-hand-fetch-failed',
            source,
            failureAttempt,
            error: errMsg,
          });
          setShowManualHandAdvance(true);
          emitModalFailureTelemetry('show_modal_retry_after_transport_retries');
          traceHandLifecycle('error', { source, error: errMsg, failureAttempt }, 'C');
          if (import.meta.env.DEV) {
            console.warn('[daily-fritz-hand] next hand error (raw)', {
              source,
              gameNumber: prefetchParams.gameNumber,
              url: `${resolveGameServerUrl()}/api/daily-fritz/next-hand`,
              error: errMsg,
              handNumber: matchRef.current.handNumber,
            });
          }
          if (shouldLogDailyFritzDebug()) {
            console.warn('[daily-fritz-hand] next hand error', {
              source,
              gameNumber: prefetchParams.gameNumber,
              error: errMsg,
              handNumber: matchRef.current.handNumber,
            });
          }
          advanceRetry.schedule(4000, 'next-hand-fetch-failed', () => advanceHandRef.current());
        });
      return;
    }

    setHandAdvanceError(null);
    setShowManualHandAdvance(false);
    reveal.setHandReveal(null);
    traceHandLifecycle('dealing-next-hand');

    if (isGuidedV2Mode && frozenV2Lesson) {
      const plan = planGuidedV2HandAdvance(frozenV2Lesson, matchRef.current.handNumber);
      if (plan) {
        setGuidedV2EventIndex(plan.firstEventIndex);
        setIsGuidedV2OffLine(false);
        fritzV2LastAppliedIndexRef.current = -1;
        setMatch(() => plan.nextState);
      }
      return;
    }
    if (isGuidedV2Mode) return;

    const localPlan = planLocalHandAdvance(matchRef.current, {
      isAuthoringMode,
      isGuidedMode,
      frozenLesson,
    });
    if (!localPlan) return;

    handTransitionInFlightRef.current = true;
    ports.captureGuidedMatchCandidateNextHand(localPlan.previousState, localPlan.nextState);
    setMatch(localPlan.nextState);
    handTransitionInFlightRef.current = false;
    traceHandLifecycle('playing');
  }, [
    applyDailyFritzNextHandResponse,
    advanceRetry,
    dailyFritzHandIndex,
    dailyFritzAuthorityRevision,
    dailyFritzPackage,
    dailyFritzTranscriptProtocolVersion,
    frozenLesson,
    frozenV2Lesson,
    fritzV2LastAppliedIndexRef,
    getMoveLog,
    isAuthoringMode,
    isDailyFritzMode,
    isGuidedMode,
    isGuidedV2Mode,
    lastDailyFlowLabelRef,
    matchRef,
    ports,
    prefetchCoordinator,
    reveal,
    setGuidedV2EventIndex,
    setIsGuidedV2OffLine,
    setMatch,
    traceHandLifecycle,
  ]);

  advanceHandRef.current = advanceHand;

  const notifyBotActionResult = useCallback(
    (result: BotActionResult) => {
      if (result.handEnded) {
        lifecycle.onHandEndedFromBotAction(
          { mode, getHandNumber: () => result.state.handNumber },
          {
            winner: result.handEnded.winner,
            reason: result.handEnded.reason,
            gameOver: result.state.gameOver,
            handNumber: result.state.handNumber,
          },
        );
        if (isDailyFritzMode) {
          lastDailyFlowLabelRef.current = 'hand-complete';
          reveal.dailyFritzMinAdvanceAtRef.current = computeDailyFritzMinAdvanceAtOnHandComplete();
          logDailyFritzHandComplete(result);
        }
        ports.flashLastPlayed(null);
        const plan = reveal.planHandEndedReveal(result);
        if (isDailyFritzMode) setDailyFritzHandResult(plan.revealPayload);
        reveal.showHandEndedReveal(plan, result.state.handNumber);
        playHandEndAudioEffects(result, isMuted);
      }
      applyBotActionUiEffects(result, ports, opponentLabel, isMuted, isDailyFritzMode);
    },
    [
      dailyFritzHandIndex,
      dailyFritzPackage,
      dailyFritzTranscriptProtocolVersion,
      getMoveLog,
      isDailyFritzMode,
      isMuted,
      lastDailyFlowLabelRef,
      lifecycle,
      mode,
      opponentLabel,
      ports,
      prefetchCoordinator,
      reveal,
      setDailyFritzHandResult,
    ],
  );

  const retryHandAdvance = useCallback(() => {
    if (reloadRequiredRef.current) {
      if (dailyFritzPackage) {
        discardDailyFritzSnapshotBeforeReload(
          buildDailyFritzStorageKey(
            dailyFritzPackage.attempt_id,
            dailyFritzPackage.current_game_number ?? 1,
          ),
          () => window.location.reload(),
        );
      } else {
        window.location.reload();
      }
      return;
    }
    setHandAdvanceError(null);
    handTransitionInFlightRef.current = false;
    prefetchCoordinator.clear();
    advanceHandRef.current();
  }, [dailyFritzPackage, prefetchCoordinator]);

  const getDebugSnapshot = useCallback((): HandLifecycleDebugSnapshot => ({
    lastDailyFlowLabel: lastDailyFlowLabelRef.current,
    revealTimerPending: reveal.isRevealTimerPending(),
    handRevealVisible: reveal.handRevealRef.current !== null,
    nextHandPrefetched: prefetchCoordinator.hasReadyResult(),
    nextHandInFlight: prefetchCoordinator.hasInFlightRequest(),
    transitionInFlight: handTransitionInFlightRef.current,
  }), [lastDailyFlowLabelRef, prefetchCoordinator, reveal]);

  useHandLifecycleWatchdogs({
    match,
    matchRef,
    handReveal: reveal.handReveal,
    handRevealRef: reveal.handRevealRef,
    pendingHandRevealRef: reveal.pendingHandRevealRef,
    handRevealTimerRef: reveal.handRevealTimerRef,
    handRevealShownAtRef: reveal.handRevealShownAtRef,
    dailyFritzMinAdvanceAtRef: reveal.dailyFritzMinAdvanceAtRef,
    handTransitionInFlightRef,
    lastDailyFlowLabelRef,
    isDailyFritzMode,
    isGuidedMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    handAdvanceError,
    setShowManualHandAdvance,
    setHandReveal: reveal.setHandReveal,
    advanceHand,
  });

  return {
    handReveal: reveal.handReveal,
    handRevealProgress: reveal.handRevealProgress,
    handAdvanceError,
    showManualHandAdvance,
    notifyBotActionResult,
    advanceHand,
    scheduleHandReveal: reveal.scheduleHandReveal,
    clearHandReveal: reveal.clearHandReveal,
    retryHandAdvance,
    isRevealTimerPending: reveal.isRevealTimerPending,
    getDebugSnapshot,
  };
}
