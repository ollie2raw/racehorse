import type { MatchOutcome } from './glicko2';
import { readRankedRatingContext, type RankedRatingContext, type RankedPlayerSnapshot, type RankedCompletionCause, type RankedRatingTreatment } from './ratingContext';

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
  /** Persisted before rating processing; no transient override is accepted. */
  ratingTreatment: RankedRatingTreatment;
  completionCause: RankedCompletionCause;
  playerState: RankedPlayerSnapshot;
  opponentRating: number;
  opponentRd: number;
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
  outcome: MatchOutcome;
  rating_context: RankedRatingContext;
}

export function buildRankedGameInsertPayload(input: RankedGameInsertInput): RankedGameInsertPayload {
  const outcome = input.outcome ?? (input.playerScore > input.opponentScore ? 'win' : input.playerScore < input.opponentScore ? 'loss' : 'draw');
  const context = readRankedRatingContext({ version: 1, treatment: input.ratingTreatment, cause: input.completionCause, outcome, player: input.playerState,
    opponent: { rating: input.opponentRating, rd: input.opponentRd } })!;
  const payload: RankedGameInsertPayload = {
    rating_context: context,
    outcome,
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
