import type { TournamentMatch } from './types';

type BracketMatchSlice = Pick<
  TournamentMatch,
  'round' | 'status' | 'winner_id' | 'player1_id' | 'player2_id'
>;

export type BracketDisplayContext = {
  isBracketLobby: boolean;
  youUserId: string | null;
  matches: BracketMatchSlice[];
};

function isDataComplete(match: BracketMatchSlice): boolean {
  return match.status === 'completed' || Boolean(match.winner_id);
}

function matchInvolvesUser(match: BracketMatchSlice, userId: string): boolean {
  return match.player1_id === userId || match.player2_id === userId;
}

/**
 * How many bracket rounds may show completed styling for matches the human is not in.
 * Bot results stay in API data but are hidden until the human finishes that stage (or is out).
 */
export function computeBracketRevealThroughRound(
  matches: BracketMatchSlice[],
  youUserId: string | null,
): { revealThroughRound: number; revealAll: boolean } {
  if (!youUserId) {
    return { revealThroughRound: 3, revealAll: true };
  }

  const humanMatches = matches.filter((m) => matchInvolvesUser(m, youUserId));
  const completedHuman = humanMatches.filter(isDataComplete);

  if (completedHuman.length === 0) {
    return { revealThroughRound: 0, revealAll: false };
  }

  const lastCompleted = completedHuman.reduce((best, m) => (m.round > best.round ? m : best));
  const humanWon = lastCompleted.winner_id === youUserId;

  if (!humanWon) {
    return { revealThroughRound: 3, revealAll: true };
  }

  return { revealThroughRound: lastCompleted.round, revealAll: false };
}

/**
 * During bracket lobby, hide completed styling for semifinal/final slots so stale or
 * premature bot simulations do not read as "future rounds already done".
 *
 * For round 1+, hide other matches' completions until the human has finished that round
 * (or has been eliminated — then show the full resolved bracket).
 */
export function isBracketMatchCompletedForDisplay(
  match: BracketMatchSlice,
  ctx: BracketDisplayContext,
): boolean {
  if (!isDataComplete(match)) {
    return false;
  }

  if (ctx.isBracketLobby && match.round > 1) {
    return false;
  }

  const { revealThroughRound, revealAll } = computeBracketRevealThroughRound(
    ctx.matches,
    ctx.youUserId,
  );

  if (revealAll) {
    return true;
  }

  if (ctx.youUserId && matchInvolvesUser(match, ctx.youUserId)) {
    return true;
  }

  if (ctx.isBracketLobby) {
    return false;
  }

  return match.round <= revealThroughRound;
}
