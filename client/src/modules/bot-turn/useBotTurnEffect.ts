import { useEffect, useRef, useState } from 'react';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { BotDifficulty } from '../fritz/botHeuristics.ts';
import { botMatchDebugLog } from '../match/runtime/botMatchDebug.ts';
import type { DailyFritzStartResponse } from '../daily/dailyFritzContracts.ts';
import type { GhostProfileSummary } from '../ghost/ghostContracts.ts';
import { executeBotThinkingFallback } from './botThinkingFallback.ts';
import { executeBotTurn, finalizeBotTurnExecution } from './botTurnExecutor.ts';
import type { RunDrawSequence } from './drawSequence.ts';
import type { LocalRunSession } from './localRunSession.ts';
import {
  resolveBotTurnDelayMs,
  shouldContinueBotTurnAtTimer,
  shouldScheduleBotTurn,
} from './botTurnGuards.ts';
import { asPlayMoves } from '../../game/tileUtils.ts';
import { getLegalMoves } from '../match/runtime/botEngine.ts';
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
      cancelled: false,
    });

    if (
      !shouldScheduleBotTurn({
        match: matchRef.current,
        drawSequenceActive: drawSequenceActiveRef.current,
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
    const hasLegalBotMove = asPlayMoves(getLegalMoves(matchRef.current, 'bot')).length > 0;
    const botTurnDelayMs = resolveBotTurnDelayMs(hasLegalBotMove);
    const runToken = beginLocalRun('bot-turn');
    botChainPauseRef.current = false;

    const timer = setTimeout(() => {
      void (async () => {
        botMatchDebugLog('[BOT-TURN] timer fired', {
          cancelled,
          currentPlayer: matchRef.current.currentPlayer,
        });
        try {
          if (!isLocalRunCurrent(runToken)) return;
          const liveAtTurn = matchRef.current;
          if (
            !shouldContinueBotTurnAtTimer({
              match: liveAtTurn,
              isDailyFritzMode,
              dailyFritzSetResult: dailyFritzPackage?.set_result,
            })
          ) {
            return;
          }

          const execution = await executeBotTurn({
            liveAtTurn,
            matchSnapshotSource: match,
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

          if (cancelled || actionResolved || !isLocalRunCurrent(runToken)) return;
          if (execution.result) {
            const finalized = finalizeBotTurnExecution({
              execution,
              ports,
              matchRef,
              matchSnapshotSource: match,
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
              return;
            }
            actionResolved = true;
          }
        } finally {
          if (isLocalRunCurrent(runToken)) {
            finishLocalRun(runToken);
          }
          ports.setDrawSequenceActiveBoth(false);
        }
      })();
    }, botTurnDelayMs);

    const maxThinkingTimer = hasLegalBotMove
      ? setTimeout(() => {
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
        }, BOT_MAX_THINKING_MS)
      : null;

    return () => {
      console.log('[BOT-EFFECT] cleanup called', { drawSequenceActive: drawSequenceActiveRef.current });
      if (!drawSequenceActiveRef.current) {
        cancelled = true;
      }
      clearTimeout(timer);
      if (maxThinkingTimer) clearTimeout(maxThinkingTimer);
      if (botActionRetryTimerRef.current) {
        clearTimeout(botActionRetryTimerRef.current);
        botActionRetryTimerRef.current = null;
      }
      // Effect re-runs (match identity churn) must release the token or a stale
      // beginLocalRun leaves Fritz permanently stuck on "thinking".
      finishLocalRun(runToken);
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
    fritzDifficulty,
    moveCounterRef,
    botChainPauseRef,
    setBotTurnRetryNonce,
    botActionRetryRef,
    botActionRetryTimerRef,
  ]);
}
