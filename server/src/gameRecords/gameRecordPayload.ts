import { isSafeRankedMoveSequence, type RankedMoveSequenceEntry } from '../ghost/rankedDealAuthority';

/**
 * Saved game record (docs/review-game-record-architecture.md, Phase 2): the minimum needed to replay a game. Analysis,
 * coaching and board snapshots are derived from this later and are never stored in it.
 */
export type GameRecordMode = 'pvf';
export type GameRecordVerification = 'replay_verified' | 'replay_mismatch' | 'unverified';

export interface GameRecordInput {
  userId: string;
  sourceMatchId: string;
  localMatchId: string | null;
  mode: GameRecordMode;
  fritzTier: string | null;
  dealSize: 7 | 14 | null;
  winningScore: number | null;
  matchStarter: 'you' | 'bot' | null;
  dealSeed: string | null;
  result: { you: number; opponent: number; winner: 'you' | 'opponent' | null };
  moves: RankedMoveSequenceEntry[];
  playedAt: string | null;
}

export const GAME_RECORD_VERSION = 1;
export const GAME_RECORD_MAX_MOVES = 4000;

const MAX_ID_LENGTH = 128;

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 200;
}

/**
 * Validates an untyped request body. Moves must be a safe ranked move sequence (the same shape the server already
 * replays for ranked matches), so a record can be handed straight to the replayer.
 */
export function parseGameRecordRequestBody(body: unknown, userId: string): GameRecordInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Request body must be an object.' };
  const raw = body as Record<string, unknown>;

  const sourceMatchId = cleanString(raw.sourceMatchId, MAX_ID_LENGTH);
  if (!sourceMatchId) return { error: 'sourceMatchId is required.' };
  if (raw.mode !== 'pvf') return { error: "mode must be 'pvf'." };

  const localMatchId = raw.localMatchId == null ? null : cleanString(raw.localMatchId, MAX_ID_LENGTH);
  if (raw.localMatchId != null && !localMatchId) return { error: 'localMatchId is invalid.' };

  const result = raw.result as Record<string, unknown> | undefined;
  if (!result || typeof result !== 'object' || !isScore(result.you) || !isScore(result.opponent)) {
    return { error: 'result.you and result.opponent must be integers between 0 and 200.' };
  }
  const winner = result.winner === 'you' || result.winner === 'opponent' ? result.winner : null;

  const dealSize = raw.dealSize === 7 || raw.dealSize === 14 ? raw.dealSize : null;
  if (raw.dealSize != null && dealSize === null) return { error: 'dealSize must be 7 or 14.' };

  const winningScore = raw.winningScore == null ? null : Number(raw.winningScore);
  if (winningScore !== null && (!Number.isInteger(winningScore) || winningScore < 1 || winningScore > 200)) {
    return { error: 'winningScore must be an integer between 1 and 200.' };
  }

  const matchStarter = raw.matchStarter === 'you' || raw.matchStarter === 'bot' ? raw.matchStarter : null;
  if (raw.matchStarter != null && matchStarter === null) return { error: "matchStarter must be 'you' or 'bot'." };

  const dealSeed = raw.dealSeed == null ? null : cleanString(raw.dealSeed, 256);
  if (raw.dealSeed != null && !dealSeed) return { error: 'dealSeed is invalid.' };

  const fritzTier = raw.fritzTier == null ? null : cleanString(raw.fritzTier, 32);
  if (raw.fritzTier != null && !fritzTier) return { error: 'fritzTier is invalid.' };

  if (!Array.isArray(raw.moves) || raw.moves.length === 0 || raw.moves.length > GAME_RECORD_MAX_MOVES) {
    return { error: `moves must be a non-empty array of at most ${GAME_RECORD_MAX_MOVES} entries.` };
  }
  if (!isSafeRankedMoveSequence(raw.moves)) return { error: 'moves is not a valid move sequence.' };

  let playedAt: string | null = null;
  if (raw.playedAt != null) {
    const parsed = typeof raw.playedAt === 'string' ? Date.parse(raw.playedAt) : NaN;
    if (!Number.isFinite(parsed)) return { error: 'playedAt is invalid.' };
    playedAt = new Date(parsed).toISOString();
  }

  return {
    userId,
    sourceMatchId,
    localMatchId,
    mode: 'pvf',
    fritzTier,
    dealSize,
    winningScore,
    matchStarter,
    dealSeed,
    result: { you: result.you, opponent: result.opponent, winner },
    moves: raw.moves as RankedMoveSequenceEntry[],
    playedAt,
  };
}

export interface GameRecordInsertPayload {
  user_id: string;
  source_match_id: string;
  local_match_id: string | null;
  mode: GameRecordMode;
  fritz_tier: string | null;
  deal_size: number | null;
  winning_score: number | null;
  match_starter: string | null;
  deal_seed: string | null;
  result: GameRecordInput['result'];
  moves: RankedMoveSequenceEntry[];
  move_count: number;
  record_version: number;
  verification: GameRecordVerification;
  played_at: string | null;
}

export function buildGameRecordInsertPayload(
  input: GameRecordInput,
  verification: GameRecordVerification,
): GameRecordInsertPayload {
  return {
    user_id: input.userId,
    source_match_id: input.sourceMatchId,
    local_match_id: input.localMatchId,
    mode: input.mode,
    fritz_tier: input.fritzTier,
    deal_size: input.dealSize,
    winning_score: input.winningScore,
    match_starter: input.matchStarter,
    deal_seed: input.dealSeed,
    result: input.result,
    moves: input.moves,
    move_count: input.moves.length,
    record_version: GAME_RECORD_VERSION,
    verification,
    played_at: input.playedAt,
  };
}
