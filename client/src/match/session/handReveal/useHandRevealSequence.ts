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
    handRevealShownRef,
    handRevealTimerRef: _handRevealTimerRef,
    showToast,
  } = params;

  const [handRevealAutoProgress, setHandRevealAutoProgress] = useState(1);
  const handRevealAutoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handRevealAutoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const handReadyRecoveryRef = useRef(false);

  const continueAfterHandReveal = useCallback(() => {
    const readyHandNumber = handReveal?.handNumber ?? state?.handNumber;
    if (socket && joinedRoom) {
      emitHandReady(socket, joinedRoom, readyHandNumber).catch((error) => {
        if (import.meta.env.DEV) {
          console.warn('[hand:ready] failed:', error instanceof Error ? error.message : error);
        }
      });
    }
    setHandReveal(null);
  }, [socket, joinedRoom, handReveal?.handNumber, state?.handNumber, setHandReveal]);

  const continueAfterHandRevealRef = useRef(continueAfterHandReveal);
  continueAfterHandRevealRef.current = continueAfterHandReveal;

  useEffect(() => {
    const needsReady =
      Boolean(state?.handOver) &&
      !state?.gameOver &&
      !handReveal &&
      !preGameDraw &&
      handRevealShownRef.current !== state?.handNumber &&
      Boolean(joinedRoom) &&
      socket?.connected;
    if (!needsReady) {
      handReadyRecoveryRef.current = false;
      return;
    }
    if (handReadyRecoveryRef.current) return;
    handReadyRecoveryRef.current = true;
    if (import.meta.env.DEV) {
      console.log('[hand:ready] recovering lost hand:ready signal after reconnect');
    }
    emitHandReady(socket!, joinedRoom!, state?.handNumber).catch((error) => {
      handReadyRecoveryRef.current = false;
      showToast('Could not signal hand ready. Reconnecting…', 2500);
      if (import.meta.env.DEV) {
        console.warn(
          '[hand:ready] recovery failed:',
          error instanceof Error ? error.message : error,
        );
      }
    });
  }, [
    state?.handOver,
    state?.gameOver,
    state?.handNumber,
    handReveal,
    preGameDraw,
    joinedRoom,
    socket,
    showToast,
    handRevealShownRef,
  ]);

  useEffect(() => {
    if (!inGame || !state || state.gameOver || !state.handOver || preGameDraw) return;
    if (handRevealShownRef.current === state.handNumber) return;
    const opponentIdFromState = state.playerIds.find((pid) => pid !== you) ?? null;
    handRevealShownRef.current = state.handNumber;
    const tid = window.setTimeout(() => {
      setHandReveal((prev) => {
        if (prev && prev.handNumber === state.handNumber) {
          return prev;
        }
        return {
          handNumber: state.handNumber,
          yourRemainingTiles: state.players[you]?.hand ?? [],
          opponentRemainingTiles: opponentIdFromState
            ? (state.players[opponentIdFromState]?.hand ?? [])
            : [],
          pointsAwarded: { you: 0, opponent: 0 },
        };
      });
    }, 1400);
    return () => window.clearTimeout(tid);
  }, [inGame, state, you, preGameDraw, handRevealShownRef, setHandReveal]);

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

  useEffect(() => {
    if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
    if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);

    if (!handReveal || state?.gameOver) {
      setHandRevealAutoProgress(1);
      return;
    }

    const durationMs = 4000;
    const start = Date.now();
    setHandRevealAutoProgress(1);

    handRevealAutoIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const nextProgress = Math.max(0, 1 - elapsed / durationMs);
      setHandRevealAutoProgress(nextProgress);
    }, 50);

    handRevealAutoTimeoutRef.current = setTimeout(() => {
      continueAfterHandRevealRef.current();
    }, durationMs);

    return () => {
      if (handRevealAutoTimeoutRef.current) clearTimeout(handRevealAutoTimeoutRef.current);
      if (handRevealAutoIntervalRef.current) clearInterval(handRevealAutoIntervalRef.current);
    };
  }, [handReveal, state?.gameOver]);

  return {
    handRevealAutoProgress,
    continueAfterHandReveal,
    continueAfterHandRevealRef,
    handReadyRecoveryRef,
  };
}