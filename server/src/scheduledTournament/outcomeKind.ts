/**
 * How a completed tournament match was decided, for clients (Phase 3B.2).
 * Clients read this instead of parsing `status_reason`.
 *
 *   played         a game was played to its end (game over, no reason)
 *   forfeit        a player left the match
 *   missed_turns   a player missed too many turns in a row
 *   no_show        a human did not join their match
 *   administrative decided by the system, not by the game: higher seed /
 *                  higher live score at the match cap or the event backstop,
 *                  a start that failed, an advance nobody could have played,
 *                  or a "no-show" that names a Fritz seat (Fritz never joins;
 *                  the human who did join simply advanced)
 *   bye            a walkover against an empty seat
 *   bot_simulated  Fritz against Fritz
 *
 * Derived from the stored fields only (winner_source, status_reason,
 * no_show_user_id, the players); no migration. Every status_reason the server
 * writes for a completed match is listed explicitly below. A reason not listed
 * (future code) is reported as `administrative` — never as a competitive
 * result — and logged.
 */
import { childLogger } from '../logger';
import type { MatchRow } from './types';

const log = childLogger('tournament:outcome');

export type TournamentOutcomeKind =
  | 'played'
  | 'forfeit'
  | 'missed_turns'
  | 'no_show'
  | 'administrative'
  | 'bye'
  | 'bot_simulated';

const isBot = (id: string | null | undefined): boolean => Boolean(id && id.startsWith('bot:fritz:'));

const IN_PROGRESS_LABEL_SUFFIXES = [
  'higher_score',
  'higher_seed',
  'missing_session_higher_seed',
  'pregame_higher_seed',
  'unrecoverable_result_higher_seed',
] as const;

/** game_over results the system decided (match cap / event backstop): engine MATCH_CAP_LABELS, eventBackstop EVENT_BACKSTOP_LABELS. */
export const ADMINISTRATIVE_GAME_OVER_REASONS: ReadonlySet<string> = new Set([
  ...IN_PROGRESS_LABEL_SUFFIXES.map((s) => `match_cap_${s}`),
  ...IN_PROGRESS_LABEL_SUFFIXES.map((s) => `event_backstop_${s}`),
]);

/** no_show results naming one absent seat: reconciler and event backstop (playerNoShowReason). */
export const SEAT_NO_SHOW_REASONS: ReadonlySet<string> = new Set([
  'player1_no_show',
  'player2_no_show',
  'event_backstop_player1_no_show',
  'event_backstop_player2_no_show',
]);

/** no_show results with nobody (or nobody human) to blame: always administrative. */
export const ADMINISTRATIVE_NO_SHOW_REASONS: ReadonlySet<string> = new Set([
  'double_no_show',
  'double_no_show_higher_seed_advanced',
  'start_failed_after_retry_higher_seed_advanced',
  'not_started_higher_seed_advanced',
  'event_backstop_double_no_show_higher_seed_advanced',
  'event_backstop_not_started_higher_seed_advanced',
  'event_backstop_undispatched_human_advanced',
  'event_backstop_undispatched_higher_seed',
  'event_backstop_window_open_human_advanced',
  'event_backstop_window_open_higher_seed',
]);

export const FORFEIT_REASONS: ReadonlySet<string> = new Set(['player1_forfeit', 'player2_forfeit']);

type OutcomeInput = Pick<MatchRow, 'status' | 'winner_id' | 'player1_id' | 'player2_id' | 'status_reason'> & {
  winner_source?: MatchRow['winner_source'] | null;
  no_show_user_id?: string | null;
};

function unlisted(match: OutcomeInput): TournamentOutcomeKind {
  log.warn({ winnerSource: match.winner_source ?? null, statusReason: match.status_reason ?? null }, 'unlisted tournament outcome reason: reported as administrative');
  return 'administrative';
}

/** The outcome of a completed match; null while it has no result. */
export function tournamentOutcomeKind(match: OutcomeInput): TournamentOutcomeKind | null {
  if (match.status !== 'completed' || !match.winner_id) return null;
  const reason = match.status_reason ?? null;
  const source = match.winner_source ?? null;

  if (reason === 'bot_simulated') return 'bot_simulated';
  if (source === null) {
    // complete_tournament_match with p_bye_walkover: no winner_source.
    return !match.player1_id || !match.player2_id ? 'bye' : unlisted(match);
  }
  if (source === 'game_over') {
    if (reason === null) return 'played';
    if (ADMINISTRATIVE_GAME_OVER_REASONS.has(reason)) return 'administrative';
    return unlisted(match);
  }
  if (source === 'forfeit') {
    if (reason === 'missed_turns') return 'missed_turns';
    if (reason === null || FORFEIT_REASONS.has(reason)) return 'forfeit';
    return unlisted(match);
  }
  if (source === 'no_show') {
    if (reason !== null && SEAT_NO_SHOW_REASONS.has(reason)) {
      // Fritz never "joins": a no-show naming a Fritz seat is a human who
      // joined advancing past a game that could not start.
      const absent = match.no_show_user_id ?? null;
      return absent && !isBot(absent) ? 'no_show' : 'administrative';
    }
    if (reason !== null && ADMINISTRATIVE_NO_SHOW_REASONS.has(reason)) return 'administrative';
    return unlisted(match);
  }
  return unlisted(match);
}

/** The user's own result in a tournament: their last decided match (highest round). */
export type UserMatchOutcome = {
  matchId: string;
  round: 1 | 2 | 3;
  won: boolean;
  outcomeKind: TournamentOutcomeKind;
  opponentId: string | null;
  /** The match's Fritz tier when the opponent is Fritz (display via the tier, never the id). */
  opponentBotTier: MatchRow['bot_tier'];
};

export function userLastMatchOutcome(
  matches: ReadonlyArray<Pick<MatchRow, 'id' | 'round' | 'match_number' | 'status' | 'winner_id' | 'player1_id' | 'player2_id' | 'status_reason' | 'winner_source' | 'no_show_user_id' | 'bot_tier'>>,
  userId: string,
): UserMatchOutcome | null {
  const mine = matches
    .filter((m) => (m.player1_id === userId || m.player2_id === userId) && m.status === 'completed' && m.winner_id)
    .sort((a, b) => b.round - a.round || b.match_number - a.match_number);
  const last = mine[0];
  if (!last) return null;
  const opponentId = last.player1_id === userId ? last.player2_id : last.player1_id;
  return {
    matchId: last.id,
    round: last.round,
    won: last.winner_id === userId,
    outcomeKind: tournamentOutcomeKind(last) ?? 'administrative',
    opponentId,
    opponentBotTier: isBot(opponentId) ? last.bot_tier ?? null : null,
  };
}
