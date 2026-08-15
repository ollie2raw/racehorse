import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  DAILY_FRITZ_VERIFIER_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  createDeterministicDoubleSixDeal,
} from '@racehorse/game-core';
import {
  getDailyFritzDrawTilesFromGameSeed,
  getDailyFritzDrawWinnerFromGameSeed,
  type DailyFritzDrawTiles,
  type DailyFritzDrawWinner,
  type DailyFritzHandDeal,
  type DailyFritzSetGameNumber,
  type DailyFritzTier,
} from './dailyFritz';

export const FRITZ_CHALLENGE_FORMAT = 'best_of_3' as const;
export const FRITZ_CHALLENGE_GENERATOR_VERSION = 1 as const;
export const FRITZ_CHALLENGE_DEFAULT_WINNING_SCORE = 60 as const;
export const FRITZ_CHALLENGE_EXPIRY_DAYS = 7 as const;

const SHARE_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SHARE_CODE_LENGTH = 8;

export type FritzChallengeStatus =
  | 'open'
  | 'active'
  | 'completed'
  | 'expired'
  | 'cancelled';

export type FritzChallengeConfig = {
  fritzTier: DailyFritzTier;
  dealSize: 7 | 14;
  winningScore: number;
};

export type FritzChallengeVersionSet = {
  rulesVersion: number;
  fritzPolicyVersion: number;
  verifierVersion: number;
  generatorVersion: number;
};

export type GeneratedFritzChallenge = {
  id: string;
  shareCode: string;
  creatorUserId: string;
  opponentUserId: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
  seed: string;
  status: FritzChallengeStatus;
  config: FritzChallengeConfig;
  versions: FritzChallengeVersionSet;
  createdAt: string;
  expiresAt: string;
};

export class FritzChallengeError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'invalid_config'
      | 'not_found'
      | 'expired'
      | 'creator_cannot_join'
      | 'opponent_already_claimed'
      | 'invite_required'
      | 'invite_not_accepted'
      | 'recipient_not_friend'
      | 'active_invite_exists'
      | 'not_participant'
      | 'version_mismatch'
      | 'hand_integrity_failed'
      | 'persistence_failed',
  ) {
    super(message);
    this.name = 'FritzChallengeError';
  }
}

export function normalizeFritzChallengeTier(value: unknown): DailyFritzTier | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'rookie'
    || normalized === 'standard'
    || normalized === 'elite'
    || normalized === 'master'
    ? normalized
    : null;
}

export function normalizeFritzChallengeDealSize(value: unknown): 7 | 14 | null {
  const parsed = Number(value);
  return parsed === 7 || parsed === 14 ? parsed : null;
}

export function normalizeFritzChallengeShareCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[23456789A-HJ-NP-Z]{8}$/.test(normalized) ? normalized : null;
}

export function createFritzChallengeShareCode(bytes = randomBytes(SHARE_CODE_LENGTH)): string {
  let code = '';
  for (let index = 0; index < SHARE_CODE_LENGTH; index += 1) {
    code += SHARE_CODE_ALPHABET[bytes[index]! % SHARE_CODE_ALPHABET.length];
  }
  return code;
}

export function getFritzChallengeGameSeed(
  seed: string,
  gameNumber: DailyFritzSetGameNumber,
): string {
  return `fritz-challenge:${seed}:game:${gameNumber}`;
}

export function getFritzChallengeDrawWinner(
  seed: string,
  gameNumber: DailyFritzSetGameNumber,
): DailyFritzDrawWinner {
  return getDailyFritzDrawWinnerFromGameSeed(getFritzChallengeGameSeed(seed, gameNumber));
}

export function getFritzChallengeDrawTiles(
  seed: string,
  gameNumber: DailyFritzSetGameNumber,
): DailyFritzDrawTiles {
  const gameSeed = getFritzChallengeGameSeed(seed, gameNumber);
  return getDailyFritzDrawTilesFromGameSeed(
    gameSeed,
    getDailyFritzDrawWinnerFromGameSeed(gameSeed),
  );
}

export function generateFritzChallengeHand(
  seed: string,
  gameNumber: DailyFritzSetGameNumber,
  handIndex: number,
  dealSize: 7 | 14,
): DailyFritzHandDeal {
  if (!Number.isInteger(handIndex) || handIndex < 0) {
    throw new FritzChallengeError('Hand index must be a non-negative integer.', 'invalid_config');
  }
  const deal = createDeterministicDoubleSixDeal({
    seed: `${getFritzChallengeGameSeed(seed, gameNumber)}:hand:${handIndex}`,
    tilesPerPlayer: dealSize,
  });
  return {
    player_tiles: deal.playerTiles,
    fritz_tiles: deal.opponentTiles,
    boneyard: deal.boneyard,
    locked: deal.deadTiles,
  };
}

export function buildFritzChallengeIdentity(challenge: Pick<
  GeneratedFritzChallenge,
  'id' | 'versions'
>): string {
  const { versions } = challenge;
  return [
    'fritz-challenge',
    challenge.id,
    `r${versions.rulesVersion}`,
    `p${versions.fritzPolicyVersion}`,
    `v${versions.verifierVersion}`,
    `g${versions.generatorVersion}`,
  ].join(':');
}

export function buildFritzChallengeFingerprint(challenge: GeneratedFritzChallenge): string {
  return createHash('sha256')
    .update(JSON.stringify({
      id: challenge.id,
      seed: challenge.seed,
      config: challenge.config,
      versions: challenge.versions,
      createdAt: challenge.createdAt,
    }))
    .digest('hex')
    .slice(0, 32);
}

export function createGeneratedFritzChallenge(input: {
  creatorUserId: string;
  recipientUserId?: string | null;
  fritzTier: DailyFritzTier;
  dealSize: 7 | 14;
  id?: string;
  shareCode?: string;
  seed?: string;
  now?: Date;
}): GeneratedFritzChallenge {
  if (!input.creatorUserId.trim()) {
    throw new FritzChallengeError('Creator identity is required.', 'invalid_config');
  }
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + FRITZ_CHALLENGE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  return {
    id: input.id ?? randomUUID(),
    shareCode: input.shareCode ?? createFritzChallengeShareCode(),
    creatorUserId: input.creatorUserId,
    opponentUserId: input.recipientUserId?.trim() || null,
    invitedAt: input.recipientUserId?.trim() ? now.toISOString() : null,
    acceptedAt: null,
    seed: input.seed ?? randomBytes(32).toString('hex'),
    status: 'open',
    config: {
      fritzTier: input.fritzTier,
      dealSize: input.dealSize,
      winningScore: FRITZ_CHALLENGE_DEFAULT_WINNING_SCORE,
    },
    versions: {
      rulesVersion: GAME_RULES_VERSION,
      fritzPolicyVersion: FRITZ_POLICY_VERSION,
      verifierVersion: DAILY_FRITZ_VERIFIER_VERSION,
      generatorVersion: FRITZ_CHALLENGE_GENERATOR_VERSION,
    },
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}
