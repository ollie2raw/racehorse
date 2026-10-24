/* eslint-disable react-hooks/refs -- test harness mirrors production wiring (ref-synced match, ref-backed draw lock); the rule cannot see across the hook boundary */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import { useBotMatchRefs } from '../match/hooks/useBotMatchRefs.ts';
import { createRunDrawSequence } from './drawSequence.ts';
import { useLocalRunSession } from './localRunSession.ts';
import { useBotTurnEffect } from './useBotTurnEffect.ts';
import {
  IDLE_FRITZ_PRESENTATION,
  isFritzTurnHeldByPresentation,
  type FritzPresentationState,
} from './fritzPresentation.ts';
import type { BotTurnPorts } from './types.ts';

/** What the player can actually see/do on a given committed render. */
export type VisibleModel = {
  /** Face-down Fritz rack size shown in the HUD. */
  fritzRackCount: number;
  boneyardCount: number;
  botTurn: boolean;
  drawSequenceActive: boolean;
  /** Same predicate the hand tray uses to enable tiles (BotHandTray). */
  humanCanAct: boolean;
  currentPlayer: 'you' | 'bot';
};

export function createMatchStore(initial: BotMatchState) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: BotMatchState | ((prev: BotMatchState) => BotMatchState)) {
      state = typeof next === 'function' ? next(state) : next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export type HarnessOptions = {
  store: ReturnType<typeof createMatchStore>;
  isDailyFritzMode?: boolean;
  drawStepMs: number;
  onRender: (model: VisibleModel) => void;
  onAppend?: (kind: string) => void;
  /** Receives imperative handles for restart/abort scenarios. */
  controlsRef?: { current: HarnessControls | null };
  /** Counts every overlay write so stale continuations are observable. */
  onVisualStep?: (player: 'you' | 'bot', handCount: number) => void;
};

export type HarnessControls = {
  invalidateLocalRuns: () => void;
  setDrawSequenceActiveBoth: (v: boolean) => void;
};

/** Real useBotTurnEffect + real draw sequence + real overlay refs; stub ports. */
export function useForcedDrawHarness(options: HarnessOptions): VisibleModel {
  const { store } = options;
  const match = useSyncExternalStore(store.subscribe, store.get, store.get);
  const matchRef = useRef(match);
  matchRef.current = match;
  const setMatch = useCallback(
    (next: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => {
      store.set(next);
      matchRef.current = store.get();
    },
    [store],
  );

  const refs = useBotMatchRefs();
  const localRun = useLocalRunSession(refs.setDrawSequenceActiveBoth);
  const { controlsRef } = options;
  useEffect(() => {
    if (controlsRef) {
      controlsRef.current = {
        invalidateLocalRuns: localRun.invalidateLocalRuns,
        setDrawSequenceActiveBoth: refs.setDrawSequenceActiveBoth,
      };
    }
  }, [controlsRef, localRun.invalidateLocalRuns, refs.setDrawSequenceActiveBoth]);
  const onDrawVisualStep = useCallback(
    (player: 'you' | 'bot', state: BotMatchState) => {
      options.onVisualStep?.(player, state.players[player].hand.length);
      refs.onDrawVisualStep(player, state);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- options is a fresh object per render; the callback only reads its latest fields
    [refs.onDrawVisualStep],
  );
  const [presentation, setPresentation] = useState<FritzPresentationState>(IDLE_FRITZ_PRESENTATION);
  const botChainPauseRef = useRef(false);
  const botTurnInFlightRef = useRef(false);
  const preGameDrawActiveRef = useRef(false);

  const triggerDrawStepAnimation = useCallback(() => {}, []);
  const runDrawSequence = createRunDrawSequence({
    setMatch,
    onDrawVisualStep,
    isMuted: true,
    isLocalRunCurrent: localRun.isLocalRunCurrent,
    triggerDrawStepAnimation,
    drawStepMs: options.drawStepMs,
  });

  const ports = {
    applyAndNotify: (result) => setMatch(result.state),
    appendMove: () => options.onAppend?.('move'),
    appendGhostMove: () => {},
    captureGuidedMatchCandidateAction: () => {},
    recordBotReviewDecision: () => {},
    flashLastPlayed: () => {},
    setSelectedTile: () => {},
    setDrawSequenceActiveBoth: refs.setDrawSequenceActiveBoth,
    setLastBotChoice: () => {},
    setGhostPlayedTile: () => {},
    showBoardToast: () => {},
    clearBoardToast: () => {},
  } as BotTurnPorts;

  useBotTurnEffect({
    match,
    matchRef,
    ports,
    localRun,
    runDrawSequence,
    fritzDifficulty: 'casual',
    isDailyFritzMode: options.isDailyFritzMode ?? true,
    dailyFritzPackage: null,
    isGuidedTranscriptMode: false,
    isGuidedV2Mode: false,
    isGuidedV2OffLine: false,
    preGameDrawActiveRef,
    drawSequenceActiveRef: refs.drawSequenceActiveRef,
    isGhostMode: false,
    ghostProfile: null,
    isMuted: true,
    moveCounterRef: refs.moveCounterRef,
    botChainPauseRef,
    botTurnInFlightRef,
    setMatch,
    onDrawVisualStep,
    triggerDrawStepAnimation,
    drawStepMs: options.drawStepMs,
    opponentLabel: 'Fritz',
    setFritzPresentation: setPresentation,
  });

  const handActive = !match.handOver && !match.gameOver;
  // Same composition as assembleBotMatchViewModel: engine turn OR presentation hold.
  const botTurn =
    (match.currentPlayer === 'bot' && handActive)
    || isFritzTurnHeldByPresentation({
      handActive,
      presentation,
      drawSequenceActive: refs.drawSequenceActive,
    });
  const model: VisibleModel = {
    fritzRackCount: refs.drawStepBotHandCount ?? match.players.bot.hand.length,
    boneyardCount: refs.boneyardDisplayCount ?? match.boneyard.length,
    botTurn,
    drawSequenceActive: refs.drawSequenceActive,
    humanCanAct: handActive && !botTurn && !refs.drawSequenceActive,
    currentPlayer: match.currentPlayer,
  };
  options.onRender(model);
  return model;
}
