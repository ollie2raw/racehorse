import { useEffect, type MutableRefObject } from 'react';
import type { GameState, Move } from '../../../types';
import { drawAudit } from '../../../multiplayer/drawAudit';
import type { RoomRecoveryState } from '../../../multiplayer/protocol';

export type UseAutoTurnEffectParams = {
  state: GameState | null;
  joinedRoom: string | null;
  you: string;
  isMyTurn: boolean;
  hasPlayMoves: boolean;
  canDrawNow: boolean;
  canPass: boolean;
  myHandLength: number;
  boneyardCount: number;
  legalMoves: Move[];
  canDraw: boolean;
  roomRecoveryState: RoomRecoveryState;
  isRecoveringConnection: boolean;
  pendingActionRef: MutableRefObject<boolean>;
  mpAutoDrawSuppressUntilSequenceRef: MutableRefObject<number | null>;
  autoTurnActionKeyRef: MutableRefObject<string>;
  draw: () => Promise<void>;
  pass: () => Promise<void>;
};

/**
 * Auto-draws or auto-passes when it's your turn but you have no play moves.
 * Extracted verbatim from useLiveMatchActions's trailing effect — same
 * suppression/dedupe key logic and drawAudit calls.
 */
export function useAutoTurnEffect(params: UseAutoTurnEffectParams): void {
  const {
    state,
    joinedRoom,
    you,
    isMyTurn,
    hasPlayMoves,
    canDrawNow,
    canPass,
    myHandLength,
    boneyardCount,
    legalMoves,
    canDraw,
    roomRecoveryState,
    isRecoveringConnection,
    pendingActionRef,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    draw,
    pass,
  } = params;

  useEffect(() => {
    const handActive = Boolean(state) && !state?.handOver && !state?.gameOver;

    if (
      joinedRoom &&
      mpAutoDrawSuppressUntilSequenceRef.current != null &&
      state &&
      typeof state.sequence === 'number'
    ) {
      if (state.sequence < mpAutoDrawSuppressUntilSequenceRef.current) {
        return;
      }
      mpAutoDrawSuppressUntilSequenceRef.current = null;
      autoTurnActionKeyRef.current = '';
    }

    if (
      !handActive ||
      !isMyTurn ||
      hasPlayMoves ||
      roomRecoveryState !== 'idle' ||
      isRecoveringConnection ||
      pendingActionRef.current
    ) {
      autoTurnActionKeyRef.current = '';
      return;
    }

    const autoAction: 'draw' | 'pass' | null = canDrawNow ? 'draw' : canPass ? 'pass' : null;
    if (!autoAction) return;

    const turnKey = `${state?.handNumber ?? 0}:${state?.currentPlayerIndex ?? -1}:${myHandLength}:${boneyardCount}:${autoAction}`;
    if (autoTurnActionKeyRef.current === turnKey) return;

    autoTurnActionKeyRef.current = turnKey;
    if (autoAction === 'draw') {
      drawAudit('forced-state-detected', {
        roomCode: joinedRoom ?? '',
        playerId: you,
        handCount: myHandLength,
        boneyardCount,
        legalMoveCount: legalMoves.filter((m) => m.type === 'play').length,
        canDraw,
        canPass,
        reason: 'auto_turn_effect',
      });
      draw();
    } else {
      drawAudit('auto-pass', {
        roomCode: joinedRoom ?? '',
        playerId: you,
        boneyardCount,
        reason: 'auto_turn_effect_blocked',
      });
      pass();
    }
  }, [
    state,
    joinedRoom,
    isMyTurn,
    hasPlayMoves,
    canDrawNow,
    canPass,
    myHandLength,
    boneyardCount,
    draw,
    pass,
    roomRecoveryState,
    isRecoveringConnection,
    legalMoves,
    canDraw,
    you,
    mpAutoDrawSuppressUntilSequenceRef,
    autoTurnActionKeyRef,
    pendingActionRef,
  ]);
}
