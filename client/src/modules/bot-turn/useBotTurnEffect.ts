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

/** Turn-tenure identity only — never include hand/board/boneyard sizes (mid-turn churn). */
export function buildBotTurnScheduleKey(input: {
  currentPlayer: string;
  handNumber: number;
  handOver: boolean;
  gameOver: boolean;
  retryNonce: number;
}): string {
  return [
    input.currentPlayer,
    input.handNumber,
    input.handOver,
    input.gameOver,
    input.retryNonce,
  ].join(':');
}

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
 * lock. The effect only re-runs when the turn schedule key changes — unstable ports /
 * presentation callbacks must not abort mid-think (that freezes Fritz on "thinking…").
 */
export function useBotTurnEffect(args: UseBotTurnEffectArgs): void {
  const {
    match,
    matchRef,
    botChainPauseRef,
    botTurnInFlightRef,
    localRun,
  } = args;

  const {
    beginLocalRun,
    isLocalRunCurrent,
    finishLocalRun,
  } = localRun;
  const [botTurnRetryNonce, setBotTurnRetryNonce] = useState(0);
  const botActionRetryRef = useRef({ key: '', attempts: 0 });
  const botActionRetryTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  // Live inputs for the async tenure — updated every render, never in effect deps.
  const liveRef = useRef(args);
  liveRef.current = args;

  // Tenure identity only. Hand/board/boneyard lengths MUST NOT be here — they change
  // mid-Fritz-turn (draw/play/chain) and would abort the loop into a permanent "thinking…" stall.
  const botScheduleKey = buildBotTurnScheduleKey({
    currentPlayer: match.currentPlayer,
    handNumber: match.handNumber,
    handOver: match.handOver,
    gameOver: match.gameOver,
    retryNonce: botTurnRetryNonce,
  });

  useEffect(() => {
    const live = () => liveRef.current;

    botMatchDebugLog('[BOT-EFFECT] fired', {
      botScheduleKey,
      currentPlayer: matchRef.current.currentPlayer,
      drawSequenceActive: live().drawSequenceActiveRef.current,
      botTurnInFlight: botTurnInFlightRef.current,
    });

    const snapshot = live();
    if (
      !shouldScheduleBotTurn({
        match: matchRef.current,
        drawSequenceActive: snapshot.drawSequenceActiveRef.current,
        botTurnInFlight: botTurnInFlightRef.current,
        preGameDrawActive: snapshot.preGameDrawActiveRef.current,
        isDailyFritzMode: snapshot.isDailyFritzMode,
        dailyFritzSetResult: snapshot.dailyFritzPackage?.set_result,
        isGuidedTranscriptMode: snapshot.isGuidedTranscriptMode,
        isGuidedV2Mode: snapshot.isGuidedV2Mode,
        isGuidedV2OffLine: snapshot.isGuidedV2OffLine,
      })
    ) {
      return;
    }

    let cancelled = false;
    const retryKey = botScheduleKey;
    if (botActionRetryRef.current.key !== retryKey) {
      botActionRetryRef.current = { key: retryKey, attempts: 0 };
    }

    // Claim immediately so the schedule-key effect owns the tenure.
    botTurnInFlightRef.current = true;
    botChainPauseRef.current = false;
    const runToken = beginLocalRun('bot-turn');
    let turnScoreTotal = 0;

    const setPhase = (patch: Partial<FritzPresentationState> & { phase: FritzPresentationState['phase'] }) => {
      live().setFritzPresentation({
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
          const current = live();
          if (
            !shouldContinueBotTurnAtTimer({
              match: matchRef.current,
              isDailyFritzMode: current.isDailyFritzMode,
              dailyFritzSetResult: current.dailyFritzPackage?.set_result,
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
                isDailyFritzMode: current.isDailyFritzMode,
                dailyFritzSetResult: current.dailyFritzPackage?.set_result,
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
          const theaterRunDrawSequence: RunDrawSequence = async (
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
            return live().runDrawSequence(
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
            live().onDrawVisualStep?.(player, state);
          };

          const step = live();
          const execution = await executeBotTurn({
            liveAtTurn: matchRef.current,
            matchSnapshotSource: matchRef.current,
            ports: step.ports,
            matchRef,
            runDrawSequence: theaterRunDrawSequence,
            runToken,
            isLocalRunCurrent,
            cancelled: () => cancelled,
            isGhostMode: step.isGhostMode,
            ghostProfile: step.ghostProfile,
            fritzDifficulty: step.fritzDifficulty,
            isDailyFritzMode: step.isDailyFritzMode,
            fritzPolicyVersion: step.dailyFritzPackage?.fritz_policy_version,
            isMuted: step.isMuted,
            moveCounter: step.moveCounterRef.current,
            setBotChainPaused: (paused) => {
              botChainPauseRef.current = paused;
            },
          });

          if (cancelled || !isLocalRunCurrent(runToken)) break;
          if (!execution.result) break;

          // Commit move-log + authoritative match BEFORE any presentation await.
          // Presenting first used to setMatch mid-animation; effect cleanup could
          // abort before finalize and leave live state ahead of the transcript
          // (Daily Fritz end-of-hand fritz_action_mismatch with divergent tiles).
          const drawnTiles = execution.playBeforeState
            ? listEmbeddedForcedDrawTiles(
              execution.playBeforeState,
              execution.result.state,
            )
            : [];

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

          const finalizeLive = live();
          const finalized = finalizeBotTurnExecution({
            execution,
            ports: finalizeLive.ports,
            matchRef,
            // Prefer pre-play state (after any pre-play draws) so place evidence
            // is not keyed off a stale matchRef that never received mid-draw setMatch.
            matchSnapshotSource: execution.playBeforeState ?? matchRef.current,
            isGhostMode: finalizeLive.isGhostMode,
            isDailyFritzMode: finalizeLive.isDailyFritzMode,
            moveCounter: finalizeLive.moveCounterRef.current,
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

          if (drawnTiles.length > 0 && execution.playBeforeState) {
            setPhase({
              phase: 'drawing',
              drawCount: drawnTiles.length,
              turnScoreTotal,
              lastScorePoints: scoredPoints,
            });
            const drawLive = live();
            await presentEmbeddedForcedDraws({
              player: 'bot',
              beforePlay: execution.playBeforeState,
              afterPlay: execution.result.state,
              drawnTiles,
              setMatch: drawLive.setMatch,
              onDrawVisualStep: wrappedOnDrawVisualStep,
              triggerDrawStepAnimation: drawLive.triggerDrawStepAnimation,
              setDrawSequenceActiveBoth: drawLive.ports.setDrawSequenceActiveBoth,
              drawStepMs: drawLive.drawStepMs,
              isMuted: drawLive.isMuted,
            });
            // Evidence already committed — cancel only skips settle/chain wait.
            if (cancelled || !isLocalRunCurrent(runToken)) break;
          }

          // One score surface: sticky running total while Fritz still holds the turn.
          if (scoredPoints > 0 && !finalizeLive.isDailyFritzMode) {
            finalizeLive.ports.showBoardToast(
              buildFritzScoreCeremonyMessage(
                finalizeLive.opponentLabel,
                scoredPoints,
                turnScoreTotal,
              ),
              'bot',
              {
                sticky: true,
                points: scoredPoints,
                turnTotal: turnScoreTotal,
                actorLabel: finalizeLive.opponentLabel.toUpperCase().slice(0, 10),
              },
            );
          } else if (scoredPoints === 0 && finalizeLive.isDailyFritzMode) {
            // A non-scoring chain step must not leave the prior +N on screen.
            finalizeLive.ports.clearBoardToast();
          }

          const settleMs = willPlace || scoredPoints > 0
            ? resolveBotPostActionSettleMs(scoredPoints)
            : 0;
          if (settleMs > 0) {
            await waitMs(settleMs);
            if (cancelled || !isLocalRunCurrent(runToken)) break;
          }

          if (!computeBotChainPaused(execution.result)) {
            if (!live().isDailyFritzMode) {
              live().ports.clearBoardToast();
            }
            break;
          }
        }
      } finally {
        botTurnInFlightRef.current = false;
        live().setFritzPresentation(IDLE_FRITZ_PRESENTATION);
        if (isLocalRunCurrent(runToken)) {
          finishLocalRun(runToken);
        }
        live().ports.setDrawSequenceActiveBoth(false);
      }
    })();

    return () => {
      // Schedule-key changed (or unmount): abort this tenure so the next key can claim.
      cancelled = true;
      botMatchDebugLog('[BOT-EFFECT] cleanup', { cancelled: true, botScheduleKey });
      if (botActionRetryTimerRef.current) {
        clearTimeout(botActionRetryTimerRef.current);
        botActionRetryTimerRef.current = null;
      }
      botTurnInFlightRef.current = false;
      finishLocalRun(runToken);
      // Don't leave draw lock stuck — that blocks the next schedule forever.
      live().ports.setDrawSequenceActiveBoth(false);
    };
  // Intentionally schedule-key only — liveRef carries ports/callbacks without aborting tenure.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botScheduleKey]);
}
