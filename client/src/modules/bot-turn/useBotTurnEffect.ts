import { useEffect, useRef, useState } from 'react';
import { asPlayMoves } from '../../game/tileUtils.ts';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { getLegalMoves } from '../match/runtime/botEngine.ts';
import type { BotDifficulty } from '../fritz/botHeuristics.ts';
import { botMatchDebugLog } from '../match/runtime/botMatchDebug.ts';
import type { DailyFritzStartResponse } from '../daily/dailyFritzContracts.ts';
import type { GhostProfileSummary } from '../ghost/ghostContracts.ts';
import { executeBotTurn, finalizeBotTurnExecution } from './botTurnExecutor.ts';
import { computeBotChainPaused } from './botChainPause.ts';
import type { RunDrawSequence } from './drawSequence.ts';
import {
  listEmbeddedForcedDrawTiles,
  presentEmbeddedForcedDraws,
} from './embeddedForcedDrawPresentation.ts';
import type { LocalRunSession } from './localRunSession.ts';
import {
  BOT_PLAYER_HANDOFF_DELAY_MS,
  resolveBotChainContinueDelayMs,
  resolveBotOpeningDelayMs,
  resolveBotPostActionSettleMs,
  shouldContinueBotTurnAtTimer,
  shouldScheduleBotTurn,
  waitMs,
} from './botTurnGuards.ts';
import {
  IDLE_FRITZ_PRESENTATION,
  type FritzPresentationState,
  buildFritzScoreCeremonyMessage,
} from './fritzPresentation.ts';
import type { BotTurnPorts } from './types.ts';

export type UseBotTurnEffectArgs = {
  match: BotMatchState;
  matchRef: React.MutableRefObject<BotMatchState>;
  ports: BotTurnPorts;
  localRun: LocalRunSession;
  runDrawSequence: RunDrawSequence;
  fritzDifficulty: BotDifficulty;
  isDailyFritzMode: boolean;
  dailyFritzPackage: DailyFritzStartResponse | null;
  isGuidedTranscriptMode: boolean;
  isGuidedV2Mode: boolean;
  isGuidedV2OffLine: boolean;
  preGameDrawActiveRef: React.MutableRefObject<boolean>;
  drawSequenceActiveRef: React.MutableRefObject<boolean>;
  isGhostMode: boolean;
  ghostProfile: GhostProfileSummary | null;
  isMuted: boolean;
  moveCounterRef: React.MutableRefObject<number>;
  botChainPauseRef: React.MutableRefObject<boolean>;
  botTurnInFlightRef: React.MutableRefObject<boolean>;
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void;
  onDrawVisualStep?: (player: import('../match/runtime/botEngine.ts').BotPlayerId, state: BotMatchState) => void;
  triggerDrawStepAnimation: (
    drawer: import('../match/runtime/botEngine.ts').BotPlayerId,
    nextState: BotMatchState,
  ) => void;
  drawStepMs: number;
  opponentLabel: string;
  setFritzPresentation: (next: FritzPresentationState) => void;
};

/**
 * Owns Fritz's tenure: claim in-flight immediately, then wait/think/act inside that
 * lock so effect remounts cannot clearTimeout the think delay down to milliseconds.
 * Cadence theater: variable beats, honest phase strip, place/score settles, handoff.
 */
export function useBotTurnEffect(args: UseBotTurnEffectArgs): void {
  const {
    match,
    matchRef,
    ports,
    localRun,
    runDrawSequence,
    fritzDifficulty,
    isDailyFritzMode,
    dailyFritzPackage,
    isGuidedTranscriptMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    preGameDrawActiveRef,
    drawSequenceActiveRef,
    isGhostMode,
    ghostProfile,
    isMuted,
    moveCounterRef,
    botChainPauseRef,
    botTurnInFlightRef,
    setMatch,
    onDrawVisualStep,
    triggerDrawStepAnimation,
    drawStepMs,
    opponentLabel,
    setFritzPresentation,
  } = args;

  const {
    beginLocalRun,
    isLocalRunCurrent,
    finishLocalRun,
  } = localRun;
  const [botTurnRetryNonce, setBotTurnRetryNonce] = useState(0);
  const botActionRetryRef = useRef({ key: '', attempts: 0 });
  const botActionRetryTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  // Schedule from turn identity, not every match field churn.
  const botScheduleKey = [
    match.currentPlayer,
    match.handNumber,
    match.turnIndex ?? 0,
    match.handOver,
    match.gameOver,
    match.players.bot.hand.length,
    match.players.you.hand.length,
    match.boneyard.length,
    match.board?.mainLine.length ?? 0,
    botTurnRetryNonce,
  ].join(':');

  useEffect(() => {
    botMatchDebugLog('[BOT-EFFECT] fired', {
      botScheduleKey,
      currentPlayer: matchRef.current.currentPlayer,
      drawSequenceActive: drawSequenceActiveRef.current,
      botTurnInFlight: botTurnInFlightRef.current,
    });

    if (
      !shouldScheduleBotTurn({
        match: matchRef.current,
        drawSequenceActive: drawSequenceActiveRef.current,
        botTurnInFlight: botTurnInFlightRef.current,
        preGameDrawActive: preGameDrawActiveRef.current,
        isDailyFritzMode,
        dailyFritzSetResult: dailyFritzPackage?.set_result,
        isGuidedTranscriptMode,
        isGuidedV2Mode,
        isGuidedV2OffLine,
      })
    ) {
      return;
    }

    let cancelled = false;
    const retryKey = botScheduleKey;
    if (botActionRetryRef.current.key !== retryKey) {
      botActionRetryRef.current = { key: retryKey, attempts: 0 };
    }

    // Claim immediately so remounts cannot clear a pending think timer.
    botTurnInFlightRef.current = true;
    botChainPauseRef.current = false;
    const runToken = beginLocalRun('bot-turn');
    let turnScoreTotal = 0;

    const setPhase = (patch: Partial<FritzPresentationState> & { phase: FritzPresentationState['phase'] }) => {
      setFritzPresentation({
        phase: patch.phase,
        drawCount: patch.drawCount ?? 0,
        turnScoreTotal: patch.turnScoreTotal ?? turnScoreTotal,
        lastScorePoints: patch.lastScorePoints ?? 0,
      });
    };

    void (async () => {
      try {
        // Player → Fritz handoff: settle the previous play before thinking starts.
        setPhase({ phase: 'thinking', turnScoreTotal: 0, lastScorePoints: 0, drawCount: 0 });
        await waitMs(BOT_PLAYER_HANDOFF_DELAY_MS);
        if (cancelled || !isLocalRunCurrent(runToken)) return;

        const openingLegal = asPlayMoves(getLegalMoves(matchRef.current, 'bot')).length > 0;
        const openingDelay = resolveBotOpeningDelayMs(openingLegal);
        setPhase({
          phase: openingLegal ? 'thinking' : 'drawing',
          turnScoreTotal: 0,
          lastScorePoints: 0,
          drawCount: 0,
        });
        botMatchDebugLog('[BOT-EFFECT] opening think', {
          delayMs: openingDelay,
          hasLegalMove: openingLegal,
        });
        await waitMs(openingDelay);
        if (cancelled || !isLocalRunCurrent(runToken)) return;

        let isFirstAction = true;
        while (!cancelled && isLocalRunCurrent(runToken)) {
          if (
            !shouldContinueBotTurnAtTimer({
              match: matchRef.current,
              isDailyFritzMode,
              dailyFritzSetResult: dailyFritzPackage?.set_result,
            })
          ) {
            break;
          }

          if (!isFirstAction) {
            const chainDelay = resolveBotChainContinueDelayMs();
            setPhase({
              phase: 'chaining',
              turnScoreTotal,
              lastScorePoints: 0,
              drawCount: 0,
            });
            botMatchDebugLog('[BOT-TURN] chain continue pause', { delayMs: chainDelay });
            await waitMs(chainDelay);
            if (cancelled || !isLocalRunCurrent(runToken)) break;
            if (
              !shouldContinueBotTurnAtTimer({
                match: matchRef.current,
                isDailyFritzMode,
                dailyFritzSetResult: dailyFritzPackage?.set_result,
              })
            ) {
              break;
            }
            const nextLegal = asPlayMoves(getLegalMoves(matchRef.current, 'bot')).length > 0;
            setPhase({
              phase: nextLegal ? 'thinking' : 'drawing',
              turnScoreTotal,
              lastScorePoints: 0,
              drawCount: 0,
            });
          }
          isFirstAction = false;

          let drawCountSeen = 0;
          const theaterRunDrawSequence: typeof runDrawSequence = async (
            initialState,
            player,
            token,
            onStep,
            drawStepMsOverride,
          ) => {
            if (player === 'bot') {
              setPhase({
                phase: 'drawing',
                drawCount: drawCountSeen,
                turnScoreTotal,
                lastScorePoints: 0,
              });
            }
            return runDrawSequence(
              initialState,
              player,
              token,
              (step) => {
                if (player === 'bot' && step.actionKind === 'draw') {
                  drawCountSeen += 1;
                  setPhase({
                    phase: 'drawing',
                    drawCount: drawCountSeen,
                    turnScoreTotal,
                    lastScorePoints: 0,
                  });
                }
                onStep?.(step);
              },
              drawStepMsOverride,
            );
          };

          const wrappedOnDrawVisualStep = (
            player: import('../match/runtime/botEngine.ts').BotPlayerId,
            state: BotMatchState,
          ) => {
            if (player === 'bot') {
              drawCountSeen += 1;
              setPhase({
                phase: 'drawing',
                drawCount: drawCountSeen,
                turnScoreTotal,
                lastScorePoints: 0,
              });
            }
            onDrawVisualStep?.(player, state);
          };

          const execution = await executeBotTurn({
            liveAtTurn: matchRef.current,
            matchSnapshotSource: matchRef.current,
            ports,
            matchRef,
            runDrawSequence: theaterRunDrawSequence,
            runToken,
            isLocalRunCurrent,
            cancelled: () => cancelled,
            isGhostMode,
            ghostProfile,
            fritzDifficulty,
            isDailyFritzMode,
            isMuted,
            moveCounter: moveCounterRef.current,
            setBotChainPaused: (paused) => {
              botChainPauseRef.current = paused;
            },
          });

          if (cancelled || !isLocalRunCurrent(runToken)) break;
          if (!execution.result) break;

          if (execution.playBeforeState) {
            const drawnTiles = listEmbeddedForcedDrawTiles(
              execution.playBeforeState,
              execution.result.state,
            );
            if (drawnTiles.length > 0) {
              setPhase({
                phase: 'drawing',
                drawCount: drawnTiles.length,
                turnScoreTotal,
                lastScorePoints: 0,
              });
              await presentEmbeddedForcedDraws({
                player: 'bot',
                beforePlay: execution.playBeforeState,
                afterPlay: execution.result.state,
                drawnTiles,
                setMatch,
                onDrawVisualStep: wrappedOnDrawVisualStep,
                triggerDrawStepAnimation,
                setDrawSequenceActiveBoth: ports.setDrawSequenceActiveBoth,
                drawStepMs,
                isMuted,
              });
              if (cancelled || !isLocalRunCurrent(runToken)) break;
            }
          }

          const scoredPoints = execution.result.scored?.points ?? 0;
          if (scoredPoints > 0) {
            turnScoreTotal += scoredPoints;
          }

          const willPlace = Boolean(execution.playedTileForHighlight);
          setPhase({
            phase: scoredPoints > 0 ? 'scoring' : willPlace ? 'placing' : 'thinking',
            turnScoreTotal,
            lastScorePoints: scoredPoints,
            drawCount: 0,
          });

          const finalized = finalizeBotTurnExecution({
            execution,
            ports,
            matchRef,
            matchSnapshotSource: matchRef.current,
            isGhostMode,
            isDailyFritzMode,
            moveCounter: moveCounterRef.current,
            setBotChainPaused: (paused) => {
              botChainPauseRef.current = paused;
            },
          });

          if (!finalized) {
            if (execution.result.error && botActionRetryRef.current.attempts < 1) {
              botActionRetryRef.current.attempts += 1;
              botActionRetryTimerRef.current = window.setTimeout(() => {
                botActionRetryTimerRef.current = null;
                setBotTurnRetryNonce((nonce) => nonce + 1);
              }, 350);
            }
            break;
          }

          // One score surface: sticky running total while Fritz still holds the turn.
          if (scoredPoints > 0 && !isDailyFritzMode) {
            ports.showBoardToast(
              buildFritzScoreCeremonyMessage(opponentLabel, scoredPoints, turnScoreTotal),
              'bot',
              {
                sticky: true,
                points: scoredPoints,
                turnTotal: turnScoreTotal,
                actorLabel: opponentLabel.toUpperCase().slice(0, 10),
              },
            );
          } else if (scoredPoints === 0 && isDailyFritzMode) {
            // A non-scoring chain step must not leave the prior +N on screen.
            ports.clearBoardToast();
          }

          const settleMs = willPlace || scoredPoints > 0
            ? resolveBotPostActionSettleMs(scoredPoints)
            : 0;
          if (settleMs > 0) {
            await waitMs(settleMs);
            if (cancelled || !isLocalRunCurrent(runToken)) break;
          }

          if (!computeBotChainPaused(execution.result)) {
            if (!isDailyFritzMode) {
              ports.clearBoardToast();
            }
            break;
          }
        }
      } finally {
        botTurnInFlightRef.current = false;
        setFritzPresentation(IDLE_FRITZ_PRESENTATION);
        if (isLocalRunCurrent(runToken)) {
          finishLocalRun(runToken);
        }
        ports.setDrawSequenceActiveBoth(false);
      }
    })();

    return () => {
      const inFlight = botTurnInFlightRef.current;
      botMatchDebugLog('[BOT-EFFECT] cleanup', { inFlight, cancelled });
      if (botActionRetryTimerRef.current) {
        clearTimeout(botActionRetryTimerRef.current);
        botActionRetryTimerRef.current = null;
      }
      // Tenure owns cancellation. Remounts while in-flight must not abort the
      // think/draw/chain waits — that was collapsing delays to milliseconds.
      if (!inFlight) {
        cancelled = true;
        finishLocalRun(runToken);
      }
    };
  }, [
    botScheduleKey,
    matchRef,
    ports,
    ghostProfile,
    isGhostMode,
    isGuidedTranscriptMode,
    runDrawSequence,
    beginLocalRun,
    isLocalRunCurrent,
    finishLocalRun,
    isMuted,
    isDailyFritzMode,
    dailyFritzPackage?.set_result,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    preGameDrawActiveRef,
    drawSequenceActiveRef,
    botTurnInFlightRef,
    fritzDifficulty,
    moveCounterRef,
    botChainPauseRef,
    setMatch,
    onDrawVisualStep,
    triggerDrawStepAnimation,
    drawStepMs,
    opponentLabel,
    setFritzPresentation,
  ]);
}
