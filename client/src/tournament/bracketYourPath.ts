/**
 * "Your path" at the top of the bracket (Phase 3D): the player's current
 * round, opponent (with Fritz identity) and state, so they never hunt
 * through the tree. The Join / Resume call comes from /my's playable match
 * (only it knows whether this player joined); the bracket rows supply the
 * rest.
 */
import { bracketSlotDisplay, tournamentStageShortLabel, type TournamentPlayerDisplay } from './displayNames';
import { myMatchOutcomeCopy, type MatchOutcomeCopy } from './tournamentOutcomeCopy';
import type { TournamentMatch } from './types';

export type YourPathState = 'ready' | 'in_progress' | 'waiting' | 'advanced' | 'eliminated' | 'champion';

export type YourPath = {
  state: YourPathState;
  round: 1 | 2 | 3;
  matchId: string;
  opponent: TournamentPlayerDisplay | null;
  /** How the player's last decided match went, in words (advanced / eliminated / champion). */
  outcome: MatchOutcomeCopy | null;
  headline: string;
};

export function deriveYourPath(input: {
  matches: TournamentMatch[];
  userId: string | null;
  usernames: ReadonlyMap<string, string | null | undefined>;
  /** /my's playable match for this tournament, if any. */
  playable: { matchId: string; matchStatus: string } | null;
}): YourPath | null {
  const { userId } = input;
  if (!userId) return null;
  const mine = input.matches
    .filter((m) => m.player1_id === userId || m.player2_id === userId)
    .sort((a, b) => b.round - a.round);
  const latest = mine[0];
  if (!latest) return null;

  const opponentId = latest.player1_id === userId ? latest.player2_id : latest.player1_id;
  const opponent = opponentId ? bracketSlotDisplay(opponentId, input.usernames.get(opponentId) ?? null, latest) : null;
  const stage = tournamentStageShortLabel(latest.round);
  const base = { round: latest.round, matchId: latest.id, opponent };

  if (latest.winner_id) {
    const won = latest.winner_id === userId;
    const outcome = myMatchOutcomeCopy({ round: latest.round, won, outcomeKind: latest.outcomeKind ?? 'played', opponentLabel: opponent?.label ?? null });
    if (!won) return { ...base, state: 'eliminated', outcome, headline: outcome.title };
    if (latest.round === 3) return { ...base, state: 'champion', outcome, headline: 'Champion' };
    const next = tournamentStageShortLabel((latest.round + 1) as 2 | 3);
    return { ...base, state: 'advanced', outcome, headline: `Through to the ${next}` };
  }

  const playable = input.playable?.matchId === latest.id ? input.playable : null;
  if (playable?.matchStatus === 'in_progress') {
    return { ...base, state: 'in_progress', outcome: null, headline: `Your ${stage} is in progress` };
  }
  if (playable?.matchStatus === 'ready' || (!input.playable && latest.status === 'ready' && opponentId)) {
    return { ...base, state: 'ready', outcome: null, headline: `Your ${stage} is ready` };
  }
  return {
    ...base,
    state: 'waiting',
    outcome: null,
    headline: opponentId ? `Your ${stage} is being set up` : `${stage} · waiting for your opponent`,
  };
}

/** Which round tab opens first on a phone: the player's current round, else the Quarterfinals. */
export function initialRoundTab(path: YourPath | null): 1 | 2 | 3 {
  if (!path) return 1;
  if (path.state === 'advanced') return Math.min(3, path.round + 1) as 2 | 3;
  return path.round;
}
