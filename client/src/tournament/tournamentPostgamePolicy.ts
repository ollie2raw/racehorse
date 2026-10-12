import type { AppMode } from '../types';

/** Defer bracket navigation until the player dismisses the live tournament game-over overlay. */
export function shouldDeferTournamentMatchFinalize(input: {
  appMode: AppMode;
  attachedMatchId: string | null;
  payloadMatchId: string;
  /** How the match was decided (`tournament:match_completed`'s winnerSource). */
  winnerSource?: string | null;
  /** The match was decided against this player. */
  lostByMe?: boolean;
}): boolean {
  if (input.appMode !== 'multiplayer' || input.attachedMatchId !== input.payloadMatchId) return false;
  // Only a game finished on the board has a game-over overlay to wait for. A
  // forfeit (missed turns, leaving) or a no-show ends without one, so the
  // player it went against would wait on the board forever (Phase 4A dev
  // finding); the winner is taken to the bracket by room:match_abandoned.
  if (input.lostByMe && input.winnerSource && input.winnerSource !== 'game_over') return false;
  return true;
}

export function shouldShowTournamentGameOverOverlay(input: {
  gameOver: boolean;
  matchId: string | null | undefined;
  consumedMatchIds: ReadonlySet<string>;
}): boolean {
  if (!input.gameOver || !input.matchId) return false;
  return !input.consumedMatchIds.has(input.matchId);
}
