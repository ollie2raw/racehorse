import { useEffect, useRef, useState } from 'react';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotDifficulty } from '../fritz/botHeuristics.ts';
import { botMatchDebugLog } from '../match/runtime/botMatchDebug.ts';
import type { DailyFritzStartResponse } from '../daily/dailyFritzContracts.ts';
import type { GhostProfileSummary } from '../ghost/ghostContracts.ts';
import { executeBotThinkingFallback } from './botThinkingFallback.ts';
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
  resolveBotTurnDelayMs,
  shouldContinueBotTurnAtTimer,
  shouldScheduleBotTurn,
  waitMs,
} from './botTurnGuards.ts';
import type { BotTurnPorts } from './types.ts';

const BOT_MAX_THINKING_MS = 3000;

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
  const [, setBotTurnRetryNonce] = useState(0);
  const botActionRetryRef = useRef({ key: '', attempts: 0 });
  const botActionRetryTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  useEffect(() => {
    botMatchDebugLog('[BOT-EFFECT] fired', {
      currentPlayer: match.currentPlayer,
      handOver: match.handOver,
      gameOver: match.gameOver,
      drawSequenceActive: drawSequenceActiveRef.current,
      botTurnInFlight: botTurnInFlightRef.current,
      cancelled: false,
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

    botMatchDebugLog('[BOT-EFFECT] passed guard, scheduling turn');
    let cancelled = false;
    let actionResolved = false;
    const retryKey = `${match.handNumber}:${match.turnIndex ?? 0}:${match.currentPlayer}`;
    if (botActionRetryRef.current.key !== retryKey) {
      botActionRetryRef.current = { key: retryKey, attempts: 0 };
    }
    const botTurnDelayMs = resolveBotTurnDelayMs();
    const runToken = beginLocalRun('bot-turn');
    botChainPauseRef.current = false;

    const timer = setTimeout(() => {
      void (async () => {
        botMatchDebugLog('[BOT-TURN] timer fired', {
          cancelled,
          currentPlayer: matchRef.current.currentPlayer,
        });
        botTurnInFlightRef.current = true;
        try {
          if (!isLocalRunCurrent(runToken)) return;

          let isFirstAction = true;
          while (!cancelled && isLocalRunCurrent(runToken)) {
            const liveAtTurn = matchRef.current;
            if (
              !shouldContinueBotTurnAtTimer({
                match: liveAtTurn,
                isDailyFritzMode,
                dailyFritzSetResult: dailyFritzPackage?.set_result,
              })
            ) {
              break;
            }

            if (!isFirstAction) {
              // Score/double keeps Fritz's turn — enforce the same think beat
              // instead of racing a remounted effect (which felt instant).
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

            actionResolved = true;
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
    }, botTurnDelayMs);

    const maxThinkingTimer = setTimeout(() => {
      if (botTurnInFlightRef.current || actionResolved || cancelled) return;
      const outcome = executeBotThinkingFallback({
        live: matchRef.current,
        ports,
        runToken,
        isLocalRunCurrent,
        matchRef,
        finishLocalRun,
        setBotChainPaused: (paused) => {
          botChainPauseRef.current = paused;
        },
        cancelled,
        actionResolved,
        isDailyFritzMode,
        fritzDifficulty,
      });
      cancelled = outcome.cancelled;
      actionResolved = outcome.actionResolved;
    }, BOT_MAX_THINKING_MS);

    return () => {
      const drawActive = drawSequenceActiveRef.current;
      const inFlight = botTurnInFlightRef.current;
      console.log('[BOT-EFFECT] cleanup called', {
        drawSequenceActive: drawActive,
        botTurnInFlight: inFlight,
      });
      clearTimeout(timer);
      clearTimeout(maxThinkingTimer);
      if (botActionRetryTimerRef.current) {
        clearTimeout(botActionRetryTimerRef.current);
        botActionRetryTimerRef.current = null;
      }
      // While a draw/pass or chain continue is running, keep the local-run token
      // alive so remounts cannot abort mid-animation / mid-chain.
      if (!drawActive && !inFlight) {
        cancelled = true;
        finishLocalRun(runToken);
      }
    };
  }, [
    match,
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
    setBotTurnRetryNonce,
    botActionRetryRef,
    botActionRetryTimerRef,
    setMatch,
    onDrawVisualStep,
    triggerDrawStepAnimation,
    drawStepMs,
  ]);
}
