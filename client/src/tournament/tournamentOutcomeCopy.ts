/**
 * Player-facing words for how a tournament match was decided (Phase 3D),
 * from the server's `outcomeKind` only — never `status_reason` /
 * `winner_source`. Internal names ("administrative", "missed_turns") are never
 * shown; a match nobody played is never described as a win or a loss.
 */
import { tournamentStageShortLabel } from './displayNames';
import type { TournamentOutcomeKind } from './types';

/**
 * The short note on a decided bracket match. Null for a played match (its
 * score says it all) and for an undecided one.
 */
export function bracketOutcomeNote(kind: TournamentOutcomeKind | null | undefined): string | null {
  switch (kind) {
    case 'forfeit': return 'Forfeit';
    case 'missed_turns': return 'Missed turns';
    case 'no_show': return 'No-show';
    case 'administrative': return 'Advanced by rule';
    case 'bye': return 'Bye';
    case 'bot_simulated': return 'Fritz advanced';
    default: return null;
  }
}

/** Whether the score shows a real game (a forfeit's 30–0 is not one). */
export function outcomeHasPlayedScore(kind: TournamentOutcomeKind | null | undefined): boolean {
  return kind === 'played' || kind == null;
}

export type MatchOutcomeCopy = {
  /** The headline: "You won", "You advanced", "Match forfeited", "Eliminated in the Semifinal"… */
  title: string;
  /** The second line: "Advanced to the Final", "Opponent forfeited", "Lost to Elite Fritz"… */
  detail: string;
  /** Won, advanced or champion (tone / iconography; always also said in words). */
  positive: boolean;
};

const NEXT_STAGE: Record<1 | 2, string> = { 1: 'Semifinal', 2: 'Final' };

/**
 * The player's own decided match: what it means for them, in words.
 * `opponentLabel` comes from the shared display helper ("Elite Fritz").
 */
export function myMatchOutcomeCopy(input: {
  round: 1 | 2 | 3;
  won: boolean;
  outcomeKind: TournamentOutcomeKind | null | undefined;
  opponentLabel: string | null;
}): MatchOutcomeCopy {
  const { round, won } = input;
  const kind = input.outcomeKind ?? 'played';
  const stage = tournamentStageShortLabel(round);
  const isFinal = round === 3;
  const opponent = input.opponentLabel ?? 'your opponent';

  if (won) {
    const onward = isFinal ? 'You won the tournament' : `Advanced to the ${NEXT_STAGE[round as 1 | 2]}`;
    if (kind === 'played') return { title: isFinal ? 'Champion' : 'You won', detail: isFinal ? `You beat ${opponent} in the Final` : onward, positive: true };
    const why =
      kind === 'forfeit' ? 'Opponent forfeited'
        : kind === 'missed_turns' ? 'Opponent missed too many turns'
          : kind === 'no_show' ? "Opponent didn't join"
            : kind === 'bye' ? 'Bye'
              : 'Opponent unavailable';
    return { title: isFinal ? 'Champion' : 'You advanced', detail: isFinal ? `${why} · You won the tournament` : `${why} · ${onward}`, positive: true };
  }

  switch (kind) {
    case 'played':
      return {
        title: isFinal ? 'Runner-up' : `Eliminated in the ${stage}`,
        detail: `Lost to ${opponent}${isFinal ? ' in the Final' : ''}`,
        positive: false,
      };
    case 'forfeit':
      return { title: 'Match forfeited', detail: `Out in the ${stage}`, positive: false };
    case 'missed_turns':
      return { title: 'Eliminated', detail: 'Match ended after missed turns', positive: false };
    case 'no_show':
      return { title: 'Match missed', detail: `You didn't join your ${stage}`, positive: false };
    default:
      return { title: `Eliminated in the ${stage}`, detail: 'Decided by tournament rules', positive: false };
  }
}
