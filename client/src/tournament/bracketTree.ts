/**
 * What the bracket tree draws between and on its match cards, derived from the matches alone (no layout, no DOM):
 * the state badge on each card, which lines are lit, and what happened to each player in a decided match.
 *
 * Round 2 match i is fed by round 1 matches 2i and 2i+1 (the server pairs them in match_number order), and the final
 * by both semifinals, so "fed" and "decided" are all the connector styling needs.
 */
import type { TournamentMatch } from './types';

export type MatchBadge = 'live' | 'ready' | 'upcoming' | 'waiting' | 'done' | 'bye';

export const MATCH_BADGE_LABEL: Record<MatchBadge, string> = {
  live: 'Live',
  ready: 'Ready',
  upcoming: 'Upcoming',
  waiting: 'Waiting',
  done: 'Complete',
  bye: 'Bye',
};

/** `completed` is the display rule's answer (a hidden result is not "done" yet), not just match.status. */
export function matchBadge(match: TournamentMatch, completed: boolean): MatchBadge {
  if (match.status === 'bye') return 'bye';
  if (completed) return 'done';
  if (match.status === 'in_progress') return 'live';
  if (match.status === 'ready') return 'ready';
  return match.player1_id && match.player2_id ? 'upcoming' : 'waiting';
}

export type ConnectorState = {
  /** This match has a winner who moves on: its outgoing line is solid. */
  decided: boolean;
  /** ...and that winner is the viewer: the line is the viewer's colour. */
  youAdvanced: boolean;
  /** At least one feeder match is decided: the line into this match is solid. */
  fedDecided: boolean;
  /** ...and at least one of those winners is the viewer. */
  fedYou: boolean;
};

const IDLE: ConnectorState = { decided: false, youAdvanced: false, fedDecided: false, fedYou: false };

export function deriveConnectorStates(input: {
  rounds: readonly [readonly TournamentMatch[], readonly TournamentMatch[], readonly TournamentMatch[]];
  isCompleted: (match: TournamentMatch) => boolean;
  youUserId: string | null;
}): ReadonlyMap<string, ConnectorState> {
  const { rounds, isCompleted, youUserId } = input;
  const states = new Map<string, ConnectorState>();
  const decidedBy = (match: TournamentMatch | undefined): { decided: boolean; you: boolean } => {
    const decided = Boolean(match && match.winner_id && isCompleted(match));
    return { decided, you: decided && Boolean(youUserId) && match!.winner_id === youUserId };
  };
  rounds.forEach((matches, roundIndex) => {
    matches.forEach((match, index) => {
      const own = decidedBy(match);
      const feeders = roundIndex === 0 ? [] : [rounds[roundIndex - 1][index * 2], rounds[roundIndex - 1][index * 2 + 1]];
      const fed = feeders.map(decidedBy);
      states.set(match.id, {
        ...IDLE,
        decided: own.decided,
        youAdvanced: own.you,
        fedDecided: fed.some((f) => f.decided),
        fedYou: fed.some((f) => f.you),
      });
    });
  });
  return states;
}

/** The champion slot is fed by the final alone. */
export function championConnector(final: TournamentMatch | null, isCompleted: (match: TournamentMatch) => boolean, youUserId: string | null): ConnectorState {
  const decided = Boolean(final && final.winner_id && isCompleted(final));
  return { ...IDLE, fedDecided: decided, fedYou: decided && Boolean(youUserId) && final!.winner_id === youUserId };
}

export type SlotResult = 'won' | 'lost' | null;

/** What a decided match meant for one player; null while it is undecided (or for an empty slot). */
export function slotResult(match: TournamentMatch, playerId: string | null, completed: boolean): SlotResult {
  if (!playerId || !completed || !match.winner_id) return null;
  return match.winner_id === playerId ? 'won' : 'lost';
}

/** The seed to show beside a name: a real registration seed only (Fritz seats have none). */
export function seedFor(playerId: string | null, seeds: ReadonlyMap<string, number | null | undefined>): number | null {
  if (!playerId) return null;
  const seed = seeds.get(playerId);
  return typeof seed === 'number' && Number.isFinite(seed) && seed > 0 ? seed : null;
}
