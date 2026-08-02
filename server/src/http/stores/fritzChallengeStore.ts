import {
  FritzChallengeError,
  createGeneratedFritzChallenge,
  generateFritzChallengeHand,
  type FritzChallengeStatus,
  type GeneratedFritzChallenge,
} from '../../fritzChallenge';
import type {
  DailyFritzHandDeal,
  DailyFritzSetGameNumber,
  DailyFritzTier,
} from '../../dailyFritz';
import { supabaseFetch } from '../../supabaseUtils';

export type FritzChallengeRow = {
  id: string;
  share_code: string;
  creator_user_id: string;
  opponent_user_id: string | null;
  seed: string;
  format: 'best_of_3';
  fritz_tier: DailyFritzTier;
  deal_size: 7 | 14;
  winning_score: number;
  rules_version: number;
  fritz_policy_version: number;
  verifier_version: number;
  generator_version: number;
  status: FritzChallengeStatus;
  created_at: string;
  expires_at: string;
  completed_at: string | null;
};

type ClaimFritzChallengeRow = {
  challenge_id: string;
  opponent_user_id: string;
  challenge_status: FritzChallengeStatus;
};

export type FritzChallengeAttemptStatus = 'started' | 'completed' | 'abandoned';

export type FritzChallengeAttemptRow = {
  attempt_id: string;
  challenge_id: string;
  user_id: string;
  attempt_status: FritzChallengeAttemptStatus;
  current_game_number: DailyFritzSetGameNumber;
  current_hand_index: number;
  attempt_result: Record<string, unknown> | null;
  final_score: number | null;
  opponent_score: number | null;
  point_diff: number | null;
  won: boolean | null;
  moves_used: number | null;
  hands_played: number | null;
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  revision: number;
};

export type FritzChallengeAttemptRecord = {
  id: string;
  challengeId: string;
  userId: string;
  status: FritzChallengeAttemptStatus;
  currentGameNumber: DailyFritzSetGameNumber;
  currentHandIndex: number;
  result: Record<string, unknown> | null;
  finalScore: number | null;
  opponentScore: number | null;
  pointDiff: number | null;
  won: boolean | null;
  movesUsed: number | null;
  handsPlayed: number | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  revision: number;
};

export type FritzChallengeAttemptAdvanceInput = {
  attemptId: string;
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
  result: Record<string, unknown>;
  playerScore: number;
  fritzScore: number;
  movesUsed: number;
  handsPlayed: number;
};

export type FritzChallengeGameRecordInput = {
  attemptId: string;
  gameNumber: DailyFritzSetGameNumber;
  result: Record<string, unknown>;
  finalScore: number;
  opponentScore: number;
  pointDiff: number;
  won: boolean;
  movesUsed: number;
  handsPlayed: number;
  completed: boolean;
  nextGameNumber: DailyFritzSetGameNumber | null;
};

type FritzChallengeHandRow = {
  challenge_id: string;
  game_number: DailyFritzSetGameNumber;
  hand_index: number;
  deal: DailyFritzHandDeal;
  generated_at: string;
};

export type FritzChallengeStoreDeps = {
  fetch: typeof supabaseFetch;
};

const DEFAULT_DEPS: FritzChallengeStoreDeps = {
  fetch: supabaseFetch,
};

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeJson(entry)]),
    );
  }
  return value;
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalizeJson(left)) === JSON.stringify(canonicalizeJson(right));
}

const CHALLENGE_SELECT = [
  'id',
  'share_code',
  'creator_user_id',
  'opponent_user_id',
  'seed',
  'format',
  'fritz_tier',
  'deal_size',
  'winning_score',
  'rules_version',
  'fritz_policy_version',
  'verifier_version',
  'generator_version',
  'status',
  'created_at',
  'expires_at',
  'completed_at',
].join(',');

export function toFritzChallengeRecord(row: FritzChallengeRow): GeneratedFritzChallenge {
  return {
    id: row.id,
    shareCode: row.share_code,
    creatorUserId: row.creator_user_id,
    opponentUserId: row.opponent_user_id,
    seed: row.seed,
    status: row.status,
    config: {
      fritzTier: row.fritz_tier,
      dealSize: row.deal_size,
      winningScore: row.winning_score,
    },
    versions: {
      rulesVersion: row.rules_version,
      fritzPolicyVersion: row.fritz_policy_version,
      verifierVersion: row.verifier_version,
      generatorVersion: row.generator_version,
    },
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

export function toFritzChallengeRow(challenge: GeneratedFritzChallenge): FritzChallengeRow {
  return {
    id: challenge.id,
    share_code: challenge.shareCode,
    creator_user_id: challenge.creatorUserId,
    opponent_user_id: challenge.opponentUserId,
    seed: challenge.seed,
    format: 'best_of_3',
    fritz_tier: challenge.config.fritzTier,
    deal_size: challenge.config.dealSize,
    winning_score: challenge.config.winningScore,
    rules_version: challenge.versions.rulesVersion,
    fritz_policy_version: challenge.versions.fritzPolicyVersion,
    verifier_version: challenge.versions.verifierVersion,
    generator_version: challenge.versions.generatorVersion,
    status: challenge.status,
    created_at: challenge.createdAt,
    expires_at: challenge.expiresAt,
    completed_at: null,
  };
}

function toFritzChallengeAttemptRecord(
  row: FritzChallengeAttemptRow,
): FritzChallengeAttemptRecord {
  return {
    id: row.attempt_id,
    challengeId: row.challenge_id,
    userId: row.user_id,
    status: row.attempt_status,
    currentGameNumber: row.current_game_number,
    currentHandIndex: row.current_hand_index,
    result: row.attempt_result,
    finalScore: row.final_score,
    opponentScore: row.opponent_score,
    pointDiff: row.point_diff,
    won: row.won,
    movesUsed: row.moves_used,
    handsPlayed: row.hands_played,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    revision: Number(row.revision ?? 0),
  };
}

function isShareCodeCollision(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('share_code') && (
    message.includes('duplicate')
    || message.includes('unique')
    || message.includes('23505')
  );
}

export async function createFritzChallenge(
  input: {
    creatorUserId: string;
    fritzTier: DailyFritzTier;
    dealSize: 7 | 14;
    now?: Date;
  },
  deps: FritzChallengeStoreDeps = DEFAULT_DEPS,
): Promise<GeneratedFritzChallenge> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const challenge = createGeneratedFritzChallenge(input);
    try {
      const rows = await deps.fetch<FritzChallengeRow[]>(
        '/rest/v1/fritz_challenges',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify([toFritzChallengeRow(challenge)]),
        },
      );
      const row = rows?.[0];
      if (!row) {
        throw new FritzChallengeError('Challenge creation was not confirmed.', 'persistence_failed');
      }
      return toFritzChallengeRecord(row);
    } catch (error) {
      if (attempt < 2 && isShareCodeCollision(error)) continue;
      if (error instanceof FritzChallengeError) throw error;
      throw new FritzChallengeError(
        error instanceof Error ? error.message : 'Challenge creation failed.',
        'persistence_failed',
      );
    }
  }
  throw new FritzChallengeError('Unable to allocate a challenge code.', 'persistence_failed');
}

export async function getFritzChallengeByCode(
  shareCode: string,
  deps: FritzChallengeStoreDeps = DEFAULT_DEPS,
): Promise<GeneratedFritzChallenge | null> {
  const rows = await deps.fetch<FritzChallengeRow[]>(
    `/rest/v1/fritz_challenges?select=${CHALLENGE_SELECT}`
      + `&share_code=eq.${encodeURIComponent(shareCode)}&limit=1`,
  );
  return rows?.[0] ? toFritzChallengeRecord(rows[0]) : null;
}

export async function claimFritzChallengeOpponent(
  input: {
    challenge: GeneratedFritzChallenge;
    userId: string;
    now?: Date;
  },
  deps: FritzChallengeStoreDeps = DEFAULT_DEPS,
): Promise<GeneratedFritzChallenge> {
  const now = input.now ?? new Date();
  if (new Date(input.challenge.expiresAt).getTime() <= now.getTime()) {
    throw new FritzChallengeError('This challenge has expired.', 'expired');
  }
  if (input.challenge.creatorUserId === input.userId) {
    throw new FritzChallengeError(
      'The challenge creator cannot claim the opponent slot.',
      'creator_cannot_join',
    );
  }
  if (
    input.challenge.opponentUserId
    && input.challenge.opponentUserId !== input.userId
  ) {
    throw new FritzChallengeError(
      'Another player has already joined this challenge.',
      'opponent_already_claimed',
    );
  }

  const claimed = await deps.fetch<ClaimFritzChallengeRow[]>(
    '/rest/v1/rpc/claim_fritz_challenge_opponent',
    {
      method: 'POST',
      body: JSON.stringify({
        p_challenge_id: input.challenge.id,
        p_user_id: input.userId,
      }),
    },
  );
  if (!claimed?.[0]) {
    throw new FritzChallengeError(
      'Another player has already joined this challenge.',
      'opponent_already_claimed',
    );
  }

  const updated = await getFritzChallengeByCode(input.challenge.shareCode, deps);
  if (!updated || updated.opponentUserId !== input.userId) {
    throw new FritzChallengeError('Challenge join was not confirmed.', 'persistence_failed');
  }
  return updated;
}

export async function startOrResumeFritzChallengeAttempt(
  input: {
    challenge: GeneratedFritzChallenge;
    userId: string;
    now?: Date;
  },
  deps: FritzChallengeStoreDeps = DEFAULT_DEPS,
): Promise<FritzChallengeAttemptRecord> {
  const now = input.now ?? new Date();
  if (new Date(input.challenge.expiresAt).getTime() <= now.getTime()) {
    throw new FritzChallengeError('This challenge has expired.', 'expired');
  }
  const isParticipant = input.userId === input.challenge.creatorUserId
    || input.userId === input.challenge.opponentUserId;
  if (!isParticipant) {
    throw new FritzChallengeError(
      'Join this challenge before starting it.',
      'not_participant',
    );
  }

  const rows = await deps.fetch<FritzChallengeAttemptRow[]>(
    '/rest/v1/rpc/start_fritz_challenge_attempt',
    {
      method: 'POST',
      body: JSON.stringify({
        p_challenge_id: input.challenge.id,
        p_user_id: input.userId,
      }),
    },
  );
  const row = rows?.[0];
  if (!row) {
    throw new FritzChallengeError(
      'Challenge attempt could not be started.',
      'persistence_failed',
    );
  }
  return toFritzChallengeAttemptRecord(row);
}

export async function getOrCreateFritzChallengeHand(
  input: {
    challenge: GeneratedFritzChallenge;
    gameNumber: DailyFritzSetGameNumber;
    handIndex: number;
  },
  deps: FritzChallengeStoreDeps = DEFAULT_DEPS,
): Promise<DailyFritzHandDeal> {
  const expected = generateFritzChallengeHand(
    input.challenge.seed,
    input.gameNumber,
    input.handIndex,
    input.challenge.config.dealSize,
  );
  const rows = await deps.fetch<FritzChallengeHandRow[]>(
    '/rest/v1/rpc/get_or_create_fritz_challenge_hand',
    {
      method: 'POST',
      body: JSON.stringify({
        p_challenge_id: input.challenge.id,
        p_game_number: input.gameNumber,
        p_hand_index: input.handIndex,
        p_deal: expected,
      }),
    },
  );
  const persisted = rows?.[0];
  if (!persisted) {
    throw new FritzChallengeError(
      'Challenge hand persistence was not confirmed.',
      'persistence_failed',
    );
  }
  if (!jsonValuesEqual(persisted.deal, expected)) {
    throw new FritzChallengeError(
      'Stored challenge hand does not match its deterministic authority.',
      'hand_integrity_failed',
    );
  }
  return persisted.deal;
}

export async function getFritzChallengeAttempt(
  input: { challengeId: string; userId: string },
  deps: FritzChallengeStoreDeps = DEFAULT_DEPS,
): Promise<FritzChallengeAttemptRecord | null> {
  const rows = await deps.fetch<FritzChallengeAttemptRow[]>(
    `/rest/v1/fritz_challenge_attempts?select=*&challenge_id=eq.${encodeURIComponent(input.challengeId)}`
      + `&user_id=eq.${encodeURIComponent(input.userId)}&limit=1`,
  );
  return rows?.[0] ? toFritzChallengeAttemptRecord(rows[0]) : null;
}

export async function advanceFritzChallengeHand(
  input: FritzChallengeAttemptAdvanceInput,
  deps: FritzChallengeStoreDeps = DEFAULT_DEPS,
): Promise<FritzChallengeAttemptRecord> {
  const rows = await deps.fetch<FritzChallengeAttemptRow[]>(
    '/rest/v1/rpc/advance_fritz_challenge_hand',
    {
      method: 'POST',
      body: JSON.stringify({
        p_attempt_id: input.attemptId,
        p_game_number: input.gameNumber,
        p_hand_index: input.handIndex,
        p_attempt_result: input.result,
        p_player_score: input.playerScore,
        p_fritz_score: input.fritzScore,
        p_moves_used: input.movesUsed,
        p_hands_played: input.handsPlayed,
      }),
    },
  );
  const row = rows?.[0];
  if (!row) throw new FritzChallengeError('Challenge hand is no longer current.', 'persistence_failed');
  return toFritzChallengeAttemptRecord(row);
}

export async function recordFritzChallengeGame(
  input: FritzChallengeGameRecordInput,
  deps: FritzChallengeStoreDeps = DEFAULT_DEPS,
): Promise<FritzChallengeAttemptRecord> {
  const rows = await deps.fetch<FritzChallengeAttemptRow[]>(
    '/rest/v1/rpc/record_fritz_challenge_game',
    {
      method: 'POST',
      body: JSON.stringify({
        p_attempt_id: input.attemptId,
        p_game_number: input.gameNumber,
        p_attempt_result: input.result,
        p_final_score: input.finalScore,
        p_opponent_score: input.opponentScore,
        p_point_diff: input.pointDiff,
        p_won: input.won,
        p_moves_used: input.movesUsed,
        p_hands_played: input.handsPlayed,
        p_completed: input.completed,
        p_next_game_number: input.nextGameNumber,
      }),
    },
  );
  const row = rows?.[0];
  if (!row) throw new FritzChallengeError('Challenge game is no longer current.', 'persistence_failed');
  return toFritzChallengeAttemptRecord(row);
}
