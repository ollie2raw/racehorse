import type { MatchOutcome } from './glicko2';

export type RankedGameSourceType =
  | 'live_room'
  | 'verified_single_player'
  | 'local_fritz_abandon'
  | 'scheduled_tournament';

export interface RankedGameSource {
  sourceType: RankedGameSourceType;
  sourceMatchId: string;
}

export interface RankedGameInsertInput {
  playerId: string;
  opponentId: string;
  playerScore: number;
  opponentScore: number;
  gameType: string;
  ratingBefore: number;
  rdBefore: number;
  playedAt: string;
  ratingAfter?: number | null;
  source?: RankedGameSource | null;
  /**
   * Authoritative result when the scoreboard does not decide it — a forfeit is
   * a loss for the player who quit even if they were ahead on points.
   * Persisted so the deferred rating-period path scores the row the same way
   * the inline path did. Requires RANKED_GAMES_OUTCOME_COLUMN_ENABLED=true.
   */
  outcome?: MatchOutcome | null;
}

export interface RankedGameInsertPayload {
  player_id: string;
  opponent_id: string;
  player_score: number;
  opponent_score: number;
  game_type: string;
  rating_before: number;
  rd_before: number;
  played_at: string;
  rating_after?: number | null;
  source_type?: RankedGameSourceType;
  source_match_id?: string;
  outcome?: MatchOutcome;
}

/**
 * The `outcome` column ships behind a flag so a server running ahead of the
 * migration does not fail every ranked insert on an unknown column. The inline
 * rating path passes the outcome in memory regardless, so the forfeit sign is
 * correct with the flag off; the flag only governs whether the deferred
 * rating-period path can recover it from the row.
 *
 * Manifest: docs/server-feature-flags.md (rollout / migration-gate).
 *
 * NOT made unconditional like the source-column write (RK-8, 2026-09-06). The
 * `outcome` column exists in prod (live query 2026-09-05: `select=outcome`
 * returns 200), but its migration is recent (2026-08-28, ~1wk) — not the
 * 11-week track record the source-columns flag has — and 0 prod rows carry a
 * non-NULL `outcome`, which is ambiguous between "flag off" and "no ranked
 * forfeit since it shipped" (only roomForfeit.ts writes it). Defaulting true
 * here would be a real behaviour change if the flag is currently off in prod,
 * not a strictly-safe no-op. Left as-is pending a cleaner live confirmation.
 *
 * remove-when: confirm the `outcome` migration is applied AND the flag's prod
 * state → then default true / make unconditional and delete.
 */
export function isRankedGameOutcomeColumnEnabled(): boolean {
  return process.env.RANKED_GAMES_OUTCOME_COLUMN_ENABLED === 'true';
}

export function buildRankedGameInsertPayload(input: RankedGameInsertInput): RankedGameInsertPayload {
  const payload: RankedGameInsertPayload = {
    player_id: input.playerId,
    opponent_id: input.opponentId,
    player_score: input.playerScore,
    opponent_score: input.opponentScore,
    game_type: input.gameType,
    rating_before: input.ratingBefore,
    rd_before: input.rdBefore,
    played_at: input.playedAt,
  };

  if (input.ratingAfter !== undefined) {
    payload.rating_after = input.ratingAfter;
  }

  if (isRankedGameOutcomeColumnEnabled() && input.outcome) {
    payload.outcome = input.outcome;
  }

  // RK-8 (HARDENING_PLAN.md §8.3): the source-column write is unconditional as
  // of 2026-09-06 — the (player_id, source_match_id) migration is long-applied
  // in prod and every ranked_games row since ~2026-08-10 carries a non-NULL
  // source_match_id. The `input.source && sourceMatchId` guard remains only for
  // the genuine no-match-identity path (completeGhostGame with a null matchId);
  // such a row goes in with source_match_id NULL, which the full unique index
  // treats as non-conflicting by design.
  const sourceMatchId = input.source?.sourceMatchId?.trim();
  if (input.source && sourceMatchId) {
    payload.source_type = input.source.sourceType;
    payload.source_match_id = sourceMatchId;
  }

  return payload;
}
