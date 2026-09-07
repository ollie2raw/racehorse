import {
  applyMove as applyCoreMove,
  canDraw as coreCanDraw,
  DEFAULT_CONFIG,
  getLegalMoves as coreGetLegalMoves,
} from '@racehorse/game-core';
import type { GameState, Move, PlacementPosition, Tile } from '../../../types';

export type OptimisticResult = {
  nextState: GameState;
  /** Legal moves for the actor after the action — non-empty only for a
   *  scoring/double play that keeps the turn; `[]` when the turn passed. */
  nextLegalMoves: Move[];
  nextCanDraw: boolean;
  /** True when the turn stayed with the actor (scoring/double play). The caller
   *  releases the pending-action lock immediately so the continued turn is not
   *  blocked for a round-trip. */
  turnRetained: boolean;
};

/**
 * MP-JIT-2: predict the actor's own action with the same engine the server runs.
 * Pure — no React, no refs. Returns `null` when the action is not applicable /
 * the engine rejects it (→ the caller falls back to the plain server round-trip,
 * unchanged behaviour). See docs/mp-jit-2-optimistic-local-apply-plan.md.
 *
 * The masked live `GameState` carries only a 2-field `config`; game-core needs
 * the full `Config`, so it is merged over `DEFAULT_CONFIG` (the missing fields —
 * `deadTileCount` etc. — only affect the reconcile-only forced-draw path).
 */
function toCoreInput(state: GameState): Parameters<typeof applyCoreMove>[0] {
  return {
    ...state,
    config: { ...DEFAULT_CONFIG, ...state.config },
  } as unknown as Parameters<typeof applyCoreMove>[0];
}

function projectForActor(
  next: Parameters<typeof applyCoreMove>[0] & { playerIds: readonly string[]; currentPlayerIndex: number },
  you: string,
): OptimisticResult | null {
  // Defer terminal / hand-boundary results to the server — they drive
  // hand-reveal / game-over UI and are latency-insensitive (a mandatory pause
  // follows), mirroring MP-JIT-1's server-side carve-out.
  if ((next as { handOver?: boolean }).handOver || (next as { gameOver?: boolean }).gameOver) {
    return null;
  }
  const turnStillYours = next.playerIds[next.currentPlayerIndex] === you;
  const nextLegalMoves = turnStillYours
    ? (coreGetLegalMoves(next, you) as unknown as Move[])
    : [];
  const nextCanDraw = turnStillYours ? coreCanDraw(next, you) : false;
  return {
    nextState: next as unknown as GameState,
    nextLegalMoves,
    nextCanDraw,
    // Only report "turn retained" when the actor can actually do something next
    // (a play or a draw). If the turn technically stays but there's nothing to
    // do — scored on a near-last tile with a locked boneyard — leave the lock on
    // and let the server's auto-resolution reconcile.
    turnRetained: turnStillYours && (nextLegalMoves.length > 0 || nextCanDraw),
  };
}

export function computeOptimisticPlayState(
  state: GameState,
  you: string,
  tile: Tile,
  position: PlacementPosition,
): OptimisticResult | null {
  if (state.gameOver || state.handOver) return null;
  if (state.playerIds[state.currentPlayerIndex] !== you) return null;
  try {
    const result = applyCoreMove(toCoreInput(state), you, { type: 'play', tile, position });
    // A pending forced draw needs draws the client cannot predict (masked
    // boneyard is length-correct but `{-1,-1}` placeholders) — defer to the
    // authoritative update + game:draw_animation.
    if (result.forcedDraw != null) return null;
    return projectForActor(result.state as never, you);
  } catch {
    return null;
  }
}

export function computeOptimisticPassState(
  state: GameState,
  you: string,
): OptimisticResult | null {
  if (state.gameOver || state.handOver) return null;
  if (state.playerIds[state.currentPlayerIndex] !== you) return null;
  try {
    const result = applyCoreMove(toCoreInput(state), you, { type: 'pass' });
    return projectForActor(result.state as never, you);
  } catch {
    return null;
  }
}
