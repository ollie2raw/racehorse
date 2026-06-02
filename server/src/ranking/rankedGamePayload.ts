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
}

export function isRankedGameSourceColumnsEnabled(): boolean {
  return process.env.RANKED_GAMES_SOURCE_COLUMNS_ENABLED === 'true';
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

  const sourceMatchId = input.source?.sourceMatchId?.trim();
  if (isRankedGameSourceColumnsEnabled() && input.source && sourceMatchId) {
    payload.source_type = input.source.sourceType;
    payload.source_match_id = sourceMatchId;
  }

  return payload;
}
