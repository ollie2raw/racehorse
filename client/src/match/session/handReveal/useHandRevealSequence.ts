import { logger } from '../../../utils/logger';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../../types';
import { emitHandReady } from '../../../multiplayer/roomTransport';
import { tileListEquals } from '../../boardSessionUtils';
import type { HandEndedPayload } from '../liveMatchSessionTypes';
import type { PreGameDrawState } from '../../preGameDraw/preGameDrawLogic';
import { stepsForViewChange, type HandLifecycleEffect, type HandLifecycleEvent, type HandView } from './handLifecycleMachine';
import { createHandLifecycleDriver } from './handLifecycleDriver';

export type UseHandRevealSequenceParams = {
  socket: Socket | null;
  joinedRoom: string | null;
  you: string;
  state: GameState | null;
  handReveal: HandEndedPayload | null;
  setHandReveal: Dispatch<SetStateAction<HandEndedPayload | null>>;
  preGameDraw: PreGameDrawState | null;
  inGame: boolean;
  handRevealShownRef: MutableRefObject<number | null>;
  handRevealTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  showToast: (message: string, duration?: number) => void;
};

export type UseHandRevealSequenceResult = {
  handRevealAutoProgress: number;
  continueAfterHandReveal: () => void;
  continueAfterHandRevealRef: MutableRefObject<() => void>;
  handReadyRecoveryRef: MutableRefObject<boolean>;
};

/** A stable number per object, so the machine can tell "a new socket" or "a new state" without holding either. */
function useIdentityCounter(value: unknown): number {
  const last = useRef<{ value: unknown; id: number }>({ value: undefined, id: 0 });
  // eslint-disable-next-line react-hooks/refs -- derives a per-render identity from a ref; the counter must change in the same render the value does
  if (last.current.value !== value) last.current = { value, id: last.current.id + 1 };
  // eslint-disable-next-line react-hooks/refs -- see above
  return last.current.id;
}

/**
 * Adapter for the hand lifecycle machine (handLifecycleMachine.ts): it tells the machine what React and the socket report, and carries out
 * the timers, the hand:ready sends and the reveal open/close the machine asks for. Every decision lives in the machine.
 */
export function useHandRevealSequence(
  params: UseHandRevealSequenceParams,
): UseHandRevealSequenceResult {
  const {
    socket,
    joinedRoom,
    you,
    state,
    handReveal,
    setHandReveal,
    preGameDraw,
    inGame,
  } = params;

  const [handRevealAutoProgress, setHandRevealAutoProgress] = useState(1);
  const handRevealAutoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handRevealAutoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handReadyRecoveryRef = useRef(false);

  const lastViewRef = useRef<HandView | null>(null);

  // Identities the machine sees as numbers: the match state object (an echo of the same hand is a new object), the reveal object (a tile
  // sync is a new object and restarts the countdown), and the socket.
  const stateVersion = useIdentityCounter(state);
  const revealVersion = useIdentityCounter(handReveal);
  const socketId = useIdentityCounter(socket);

  const latestRef = useRef({ params, stateVersion, revealVersion, socketId });
  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers; moving the write to an effect would defer it past paint
  latestRef.current = { params, stateVersion, revealVersion, socketId };

  const buildView = useCallback((): HandView => {
    const { params: p, stateVersion: sv, revealVersion: rv, socketId: sid } = latestRef.current;
    return {
      inGame: p.inGame,
      hand: p.state
        ? { handNumber: p.state.handNumber, handOver: Boolean(p.state.handOver), gameOver: Boolean(p.state.gameOver), version: sv }
        : null,
      preGameDraw: Boolean(p.preGameDraw),
      reveal: p.handReveal ? { handNumber: p.handReveal.handNumber, version: rv } : null,
      roomJoined: Boolean(p.joinedRoom),
      socketId: p.socket ? sid : null,
      socketConnected: Boolean(p.socket?.connected),
    };
  }, []);

  type RevealContext = { armedState: GameState | null; armedYou: string };
  const dispatchRef = useRef<(event: HandLifecycleEvent, context?: RevealContext) => void>(() => undefined);

  const runEffect = useCallback((effect: HandLifecycleEffect, context: RevealContext | undefined) => {
    const { params: p } = latestRef.current;
    switch (effect.type) {
      case 'armRevealTimer': {
        // The reveal is built from the state of the render that armed it; a later tile sync (below) brings it up to date.
        const armed: RevealContext = { armedState: p.state, armedYou: p.you };
        if (p.handRevealTimerRef.current) clearTimeout(p.handRevealTimerRef.current);
        p.handRevealTimerRef.current = window.setTimeout(() => {
          dispatchRef.current({ type: 'revealTimerFired', handNumber: effect.handNumber }, armed);
        }, effect.delayMs);
        return;
      }
      case 'cancelRevealTimer':
        if (p.handRevealTimerRef.current) {
          clearTimeout(p.handRevealTimerRef.current);
          p.handRevealTimerRef.current = null;
        }
        return;
      case 'openReveal': {
        const armedState = context?.armedState;
        const armedYou = context?.armedYou ?? p.you;
        if (!armedState) return;
        const opponentIdFromState = armedState.playerIds.find((pid) => pid !== armedYou) ?? null;
        p.setHandReveal((prev) => {
          if (prev && prev.handNumber === armedState.handNumber) {
            return prev;
          }
          return {
            handNumber: armedState.handNumber,
            yourRemainingTiles: armedState.players[armedYou]?.hand ?? [],
            opponentRemainingTiles: opponentIdFromState
              ? (armedState.players[opponentIdFromState]?.hand ?? [])
              : [],
            pointsAwarded: { you: 0, opponent: 0 },
          };
        });
        return;
      }
      case 'closeReveal':
        p.setHandReveal(null);
        return;
      case 'cancelAutoContinue':
        if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
        if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);
        handRevealAutoTimeoutRef.current = null;
        handRevealAutoIntervalRef.current = null;
        setHandRevealAutoProgress(1);
        return;
      case 'armAutoContinue': {
        const start = Date.now();
        setHandRevealAutoProgress(1);
        handRevealAutoIntervalRef.current = setInterval(() => {
          const elapsed = Date.now() - start;
          setHandRevealAutoProgress(Math.max(0, 1 - elapsed / effect.durationMs));
        }, 50);
        handRevealAutoTimeoutRef.current = setTimeout(() => {
          dispatchRef.current({ type: 'autoContinueFired' });
        }, effect.durationMs);
        return;
      }
      case 'sendReady': {
        const socketNow = p.socket;
        const room = p.joinedRoom;
        if (!socketNow || !room) return;
        if (effect.source === 'recovery' && import.meta.env.DEV) {
          logger.operational('hand:ready', 'recovering lost hand:ready signal after reconnect');
        }
        emitHandReady(socketNow, room, effect.handNumber).catch((error) => {
          dispatchRef.current({ type: 'readySettled', handNumber: effect.handNumber ?? null, source: effect.source, ok: false });
          if (import.meta.env.DEV) {
            console.warn(
              effect.source === 'recovery' ? '[hand:ready] recovery failed:' : '[hand:ready] failed:',
              error instanceof Error ? error.message : error,
            );
          }
        });
        return;
      }
      case 'warnReadyFailed':
        p.showToast('Could not signal hand ready. Reconnecting…', 2500);
        return;
    }
  }, []);

  // The shared refs are also read and cleared elsewhere (the hand:ended handler, the unmount cleanup, tests), so they stay the source of truth
  // for the facts the machine shares with them.
  const driverRef = useRef<ReturnType<typeof createHandLifecycleDriver<ReturnType<typeof setTimeout>, RevealContext>> | null>(null);
  const getDriver = useCallback(() => {
    driverRef.current ??= createHandLifecycleDriver<ReturnType<typeof setTimeout>, RevealContext>(
      {
        // Read and written at call time, through the latest params.
        shown: {
          get current() {
            return latestRef.current.params.handRevealShownRef.current;
          },
          set current(value) {
            latestRef.current.params.handRevealShownRef.current = value;
          },
        },
        timer: {
          get current() {
            return latestRef.current.params.handRevealTimerRef.current;
          },
          set current(value) {
            latestRef.current.params.handRevealTimerRef.current = value;
          },
        },
        recoveryLatched: handReadyRecoveryRef,
      },
      runEffect,
    );
    return driverRef.current;
  }, [runEffect]);
  const dispatch = useCallback(
    (event: HandLifecycleEvent, context?: RevealContext) => getDriver().dispatch(event, context),
    [getDriver],
  );
  // eslint-disable-next-line react-hooks/refs -- the timers and send callbacks above dispatch through the latest function
  dispatchRef.current = dispatch;

  const sendView = useCallback(() => {
    const view = buildView();
    const steps = stepsForViewChange(lastViewRef.current, view);
    lastViewRef.current = view;
    dispatch({ type: 'view', view, steps });
  }, [buildView, dispatch]);

  const continueAfterHandReveal = useCallback(() => {
    // The machine reads the hand and reveal as of now, not as of the last effect.
    getDriver().setView(buildView());
    dispatch({ type: 'continue' });
  }, [buildView, dispatch, getDriver]);

  const continueAfterHandRevealRef = useRef(continueAfterHandReveal);
  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers; moving the write to an effect would defer it past paint
  continueAfterHandRevealRef.current = continueAfterHandReveal;

  // The decisions (recover a lost hand:ready, arm the reveal, drop a reveal for an earlier hand, auto-continue) are the machine's; this tells
  // it the view whenever one of their inputs changed.
  useEffect(() => {
    sendView();
  }, [
    sendView,
    inGame,
    state,
    preGameDraw,
    handReveal,
    joinedRoom,
    socket,
    state?.handOver,
    state?.gameOver,
    state?.handNumber,
  ]);

  // Keep the reveal's remaining tiles in step with the state (data for the modal, not a lifecycle decision).
  useEffect(() => {
    if (!handReveal || !state || state.gameOver || !state.handOver || preGameDraw) return;
    const opponentIdFromState = state.playerIds.find((pid) => pid !== you) ?? null;
    const nextYourRemaining = state.players[you]?.hand ?? [];
    const nextOpponentRemaining = opponentIdFromState
      ? (state.players[opponentIdFromState]?.hand ?? [])
      : [];
    if (
      tileListEquals(handReveal.yourRemainingTiles, nextYourRemaining) &&
      tileListEquals(handReveal.opponentRemainingTiles, nextOpponentRemaining)
    ) {
      return;
    }
    setHandReveal((prev) =>
      prev
        ? {
            ...prev,
            yourRemainingTiles: nextYourRemaining,
            opponentRemainingTiles: nextOpponentRemaining,
          }
        : prev,
    );
  }, [handReveal, state, you, preGameDraw, setHandReveal]);

  // The progress timers are torn down with the hook.
  useEffect(
    () => () => {
      if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
      if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);
    },
    [],
  );

  return {
    handRevealAutoProgress,
    continueAfterHandReveal,
    continueAfterHandRevealRef,
    handReadyRecoveryRef,
  };
}
