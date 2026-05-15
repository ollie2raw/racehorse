import type { GameState } from '../types';

/** True when server handCounts say we have tiles but the masked hand payload is empty. */
export function hasHandIdentityMismatch(
  state: GameState | null | undefined,
  youRef: string,
): boolean {
  if (!state?.playerIds?.includes(youRef)) return false;
  const myHandLen = state.players?.[youRef]?.hand?.length ?? 0;
  const myHandCount = state.handCounts?.[youRef];
  return typeof myHandCount === 'number' && myHandCount > 0 && myHandLen === 0;
}
