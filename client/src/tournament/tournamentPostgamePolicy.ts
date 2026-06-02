import type { AppMode } from '../types';

/** Defer bracket navigation until the player dismisses the live tournament game-over overlay. */
export function shouldDeferTournamentMatchFinalize(input: {
  appMode: AppMode;
  attachedMatchId: string | null;
  payloadMatchId: string;
}): boolean {
  return input.appMode === 'multiplayer' && input.attachedMatchId === input.payloadMatchId;
}

export function shouldShowTournamentGameOverOverlay(input: {
  gameOver: boolean;
  matchId: string | null | undefined;
  consumedMatchIds: ReadonlySet<string>;
}): boolean {
  if (!input.gameOver || !input.matchId) return false;
  return !input.consumedMatchIds.has(input.matchId);
}
