import { useEffect, useRef, useState } from 'react';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
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
  BOT_THINK_DELAY_MS,
  shouldContinueBotTurnAtTimer,
  shouldScheduleBotTurn,
  waitMs,
} from './botTurnGuards.ts';
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
};

/**
 * Owns Fritz's tenure: claim in-flight immediately, then wait/think/act inside that
 * lock so effect remounts cannot clearTimeout the think delay down to milliseconds.
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

    botMatchDebugLog('[BOT-EFFECT] claiming tenure', { delayMs: BOT_THINK_DELAY_MS });
    let cancelled = false;
    const retryKey = botScheduleKey;
    if (botActionRetryRef.current.key !== retryKey) {
      botActionRetryRef.current = { key: retryKey, attempts: 0 };
    }

    // Claim immediately so remounts cannot clear a pending think timer.
    botTurnInFlightRef.current = true;
    botChainPauseRef.current = false;
    const runToken = beginLocalRun('bot-turn');

    void (async () => {
      try {
        // Initial think beat lives inside the lock (not a clearable outer setTimeout).
        await waitMs(BOT_THINK_DELAY_MS);
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
            botMatchDebugLog('[BOT-TURN] chain continue pause', {
              delayMs: BOT_THINK_DELAY_MS,
            });
            await waitMs(BOT_THINK_DELAY_MS);
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
          }
          isFirstAction = false;

          const execution = await executeBotTurn({
            liveAtTurn: matchRef.current,
            matchSnapshotSource: matchRef.current,
            ports,
            matchRef,
            runDrawSequence,
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
              await presentEmbeddedForcedDraws({
                player: 'bot',
                beforePlay: execution.playBeforeState,
                afterPlay: execution.result.state,
                drawnTiles,
                setMatch,
                onDrawVisualStep,
                triggerDrawStepAnimation,
                setDrawSequenceActiveBoth: ports.setDrawSequenceActiveBoth,
                drawStepMs,
                isMuted,
              });
              if (cancelled || !isLocalRunCurrent(runToken)) break;
            }
          }

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

          if (!computeBotChainPaused(execution.result)) {
            break;
          }
        }
      } finally {
        botTurnInFlightRef.current = false;
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
  ]);
}
