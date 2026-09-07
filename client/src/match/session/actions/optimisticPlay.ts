import { applyMove as applyCoreMove, DEFAULT_CONFIG } from '@racehorse/game-core';
import type { GameState, PlacementPosition, Tile } from '../../../types';

/**
 * MP-JIT-2: predict the actor's own MOVE with the same engine the server runs.
 * Pure — no React, no refs. Returns the predicted next state, or `null` when the
 * move is not applicable / the engine rejects it (in which case the caller falls
 * back to the plain server round-trip, unchanged behaviour).
 *
 * The masked live `GameState` carries only a 2-field `config`; game-core needs
 * the full `Config`. `deadTileCount` / `blockedHandRule` / etc. only affect the
 * reconcile-only forced-draw path here, so `DEFAULT_CONFIG` is a safe fill.
 * See docs/mp-jit-2-optimistic-local-apply-plan.md.
 */
export function computeOptimisticPlayState(
  state: GameState,
  you: string,
  tile: Tile,
  position: PlacementPosition,
): GameState | null {
  if (state.gameOver || state.handOver) return null;
  if (state.playerIds[state.currentPlayerIndex] !== you) return null;

  try {
    const coreInput = {
      ...state,
      config: { ...DEFAULT_CONFIG, ...state.config },
    } as unknown as Parameters<typeof applyCoreMove>[0];
    const result = applyCoreMove(coreInput, you, { type: 'play', tile, position });
    const next = result.state as unknown as GameState;
    // Defer terminal / hand-boundary moves to the server: they trigger
    // hand-reveal / game-over UI, are latency-insensitive (a mandatory
    // hand-over pause follows), and mirror MP-JIT-1's server-side carve-out.
    if (next.handOver || next.gameOver) return null;
    // Forced-draw pending (scoring/double play that keeps the turn but needs
    // draws we cannot predict) — show nothing speculative; let the
    // authoritative update + game:draw_animation drive it.
    if (result.forcedDraw != null) return null;
    return next;
  } catch {
    return null;
  }
}
