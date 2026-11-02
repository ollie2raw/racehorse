import { tournamentOutcomeKind } from './outcomeKind';
import type { MatchRow } from './types';

/**
 * What the PUBLIC bracket says about a match (roadmap 3.8). `GET /api/tournaments/:id/bracket` needs no sign-in, so it answers with an
 * explicit list of fields rather than spreading the database row: anything added to the row later stays private until someone decides it
 * should not.
 *
 * Left out on purpose:
 *   room_code            the room a match is played in. Joining and spectating go by room code, and the screens that need one get it from the
 *                        player's own state and socket events, never from the public bracket.
 *   ready_at, ready_deadline_at, player1_joined_at, player2_joined_at   operational timing of the lobby
 *   forfeit_user_id, no_show_user_id, status_reason                     why a match ended is `outcomeKind`, which is derived and public
 *   winner_source                                                       replaced by `outcomeKind`
 */
export type PublicBracketMatch = Pick<
  MatchRow,
  | 'id'
  | 'tournament_id'
  | 'round'
  | 'match_number'
  | 'player1_id'
  | 'player2_id'
  | 'winner_id'
  | 'status'
  | 'bot_tier'
  | 'started_at'
  | 'completed_at'
  | 'player1_score'
  | 'player2_score'
> & { outcomeKind: ReturnType<typeof tournamentOutcomeKind> };

export function publicBracketMatch(match: MatchRow): PublicBracketMatch {
  return {
    id: match.id,
    tournament_id: match.tournament_id,
    round: match.round,
    match_number: match.match_number,
    player1_id: match.player1_id,
    player2_id: match.player2_id,
    winner_id: match.winner_id,
    status: match.status,
    bot_tier: match.bot_tier,
    started_at: match.started_at,
    completed_at: match.completed_at,
    player1_score: match.player1_score,
    player2_score: match.player2_score,
    outcomeKind: tournamentOutcomeKind(match),
  };
}

/** The history list is a page, not everything: a player with many tournaments must not cost three queries each, all at once. */
export const HISTORY_DEFAULT_LIMIT = 20;
export const HISTORY_MAX_LIMIT = 50;
/** How many tournaments' details are read at the same time within a page. */
export const HISTORY_READ_CONCURRENCY = 5;

export function parseHistoryPage(query: { limit?: unknown; offset?: unknown }): { limit: number; offset: number } {
  const limit = Math.floor(Number(query.limit));
  const offset = Math.floor(Number(query.offset));
  return {
    limit: Number.isFinite(limit) && limit >= 1 ? Math.min(limit, HISTORY_MAX_LIMIT) : HISTORY_DEFAULT_LIMIT,
    offset: Number.isFinite(offset) && offset >= 0 ? offset : 0,
  };
}

/** Maps `items` with at most `size` calls in flight, keeping the order. */
export async function mapInBatches<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return results;
}
