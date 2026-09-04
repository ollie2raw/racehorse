import { createHash } from 'crypto';
import {
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  DAILY_FRITZ_VERIFIER_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  isSupportedFritzPolicyVersion,
} from '@racehorse/game-core';
import {
  dailyFritzDrawTilesMatchWinner,
  generateSingleDailyFritzGameHand,
  getDailyFritzDrawTiles,
  getDailyFritzDrawWinner,
  getDailyFritzGameSeed,
  getDailyFritzSeed,
  type DailyFritzDrawTiles,
  type DailyFritzDrawWinner,
  type DailyFritzHandDeal,
  type DailyFritzRunStatus,
  type DailyFritzSetGameNumber,
  type DailyFritzTier,
} from './dailyFritz';
import {
  buildDailyFritzChallengeId,
  DAILY_FRITZ_RULES_VERSION,
  DAILY_FRITZ_SEED_VERSION,
  DAILY_FRITZ_TIME_ZONE,
} from './dailyFritzIdentity';

export const DAILY_FRITZ_CHALLENGE_CONTRACT_VERSION = 1 as const;
export const DAILY_FRITZ_GENERATION_VERSION = 1 as const;
export const DAILY_FRITZ_RANKING_VERSION = 1 as const;
export const DAILY_FRITZ_PUBLISHED_HAND_SLOTS = 12 as const;
export const DAILY_FRITZ_HAND_GENERATION_CONTRACT =
  'double-six-v1:{gameSeed}:hand:{handIndex}' as const;

export type DailyFritzPublishedGame = {
  gameNumber: DailyFritzSetGameNumber;
  seed: string;
  drawWinner: DailyFritzDrawWinner;
  drawTiles: DailyFritzDrawTiles;
  handGenerationContract: typeof DAILY_FRITZ_HAND_GENERATION_CONTRACT;
  hands: DailyFritzHandDeal[];
  contentDigest: string;
};

export type DailyFritzPublishedChallengeContent = {
  contractVersion: typeof DAILY_FRITZ_CHALLENGE_CONTRACT_VERSION;
  challengeId: string;
  runDate: string;
  timeZone: typeof DAILY_FRITZ_TIME_ZONE;
  generationVersion: typeof DAILY_FRITZ_GENERATION_VERSION;
  seedVersion: typeof DAILY_FRITZ_SEED_VERSION;
  productRulesVersion: typeof DAILY_FRITZ_RULES_VERSION;
  gameRulesVersion: typeof GAME_RULES_VERSION;
  transcriptProtocolVersion: typeof DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION;
  verifierVersion: typeof DAILY_FRITZ_VERIFIER_VERSION;
  fritzPolicyVersion: typeof FRITZ_POLICY_VERSION;
  fritzPolicyContract: string;
  rankingVersion: typeof DAILY_FRITZ_RANKING_VERSION;
  seed: string;
  fritzTier: DailyFritzTier;
  dealSize: 7 | 14;
  winningScore: number;
  games: [DailyFritzPublishedGame, DailyFritzPublishedGame, DailyFritzPublishedGame];
};

export type DailyFritzPublishedChallenge = DailyFritzPublishedChallengeContent & {
  status: DailyFritzRunStatus;
  contentDigest: string;
  publishedAt: string;
  invalidatedAt: string | null;
  invalidationReason: string | null;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function canonicalizeDailyFritzChallenge(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function digestDailyFritzChallengeContent(value: unknown): string {
  return createHash('sha256')
    .update(canonicalizeDailyFritzChallenge(value))
    .digest('hex');
}

function tileKey(value: { low: number; high: number }): string {
  return `${Math.min(value.low, value.high)}|${Math.max(value.low, value.high)}`;
}

function assertValidTile(value: unknown, path: string): asserts value is { low: number; high: number } {
  if (!value || typeof value !== 'object') throw new Error(`${path} is not a tile.`);
  const tile = value as Record<string, unknown>;
  if (
    !Number.isInteger(tile.low)
    || !Number.isInteger(tile.high)
    || Number(tile.low) < 0
    || Number(tile.high) < 0
    || Number(tile.low) > 6
    || Number(tile.high) > 6
    || Number(tile.low) > Number(tile.high)
  ) {
    throw new Error(`${path} is not a canonical double-six tile.`);
  }
}

function assertValidHand(deal: DailyFritzHandDeal, dealSize: 7 | 14, path: string): void {
  if (deal.player_tiles.length !== dealSize || deal.fritz_tiles.length !== dealSize) {
    throw new Error(`${path} has the wrong deal size.`);
  }
  const deckTiles = [
    ...deal.player_tiles,
    ...deal.fritz_tiles,
    ...deal.boneyard,
  ];
  if (deckTiles.length !== 28) throw new Error(`${path} does not conserve the double-six deck.`);
  deckTiles.forEach((tile, index) => assertValidTile(tile, `${path}.tiles[${index}]`));
  const keys = deckTiles.map(tileKey);
  if (new Set(keys).size !== 28) throw new Error(`${path} contains duplicate tiles.`);
  deal.locked.forEach((tile, index) => {
    assertValidTile(tile, `${path}.locked[${index}]`);
    if (!deal.boneyard.some((candidate) => tileKey(candidate) === tileKey(tile))) {
      throw new Error(`${path} has a locked tile outside the boneyard.`);
    }
  });
}

export function getDailyFritzPublishedChallengeContent(
  challenge: DailyFritzPublishedChallenge,
): DailyFritzPublishedChallengeContent {
  const {
    status: _status,
    contentDigest: _contentDigest,
    publishedAt: _publishedAt,
    invalidatedAt: _invalidatedAt,
    invalidationReason: _invalidationReason,
    ...content
  } = challenge;
  return content;
}

export function assertValidDailyFritzPublishedChallenge(
  challenge: DailyFritzPublishedChallenge,
): void {
  if (challenge.contractVersion !== DAILY_FRITZ_CHALLENGE_CONTRACT_VERSION) {
    throw new Error('Unsupported Daily Fritz challenge contract version.');
  }
  if (challenge.challengeId !== buildDailyFritzChallengeId(challenge.runDate)) {
    throw new Error('Daily Fritz challenge identity does not match its date and versions.');
  }
  if (challenge.seed !== getDailyFritzSeed(challenge.runDate)) {
    throw new Error('Daily Fritz challenge seed does not match its date.');
  }
  if (
    challenge.timeZone !== DAILY_FRITZ_TIME_ZONE
    || challenge.generationVersion !== DAILY_FRITZ_GENERATION_VERSION
    || challenge.seedVersion !== DAILY_FRITZ_SEED_VERSION
    || challenge.productRulesVersion !== DAILY_FRITZ_RULES_VERSION
    || challenge.gameRulesVersion !== GAME_RULES_VERSION
    || challenge.transcriptProtocolVersion !== DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION
    || challenge.verifierVersion !== DAILY_FRITZ_VERIFIER_VERSION
    // GC-6 (HARDENING_PLAN §7.3): a stored challenge may be pinned to any
    // *supported* Fritz policy version (its own contract must match its own
    // version) — the verifier handles per-version verification and accepts any
    // top-score play, so a v3 deploy must not fail to read a v2 challenge and
    // strand an in-flight attempt. New challenges are still published at the
    // current `FRITZ_POLICY_VERSION` (see `buildDailyFritzPublishedChallenge`).
    || !isSupportedFritzPolicyVersion(challenge.fritzPolicyVersion)
    || challenge.fritzPolicyContract !== getFritzPolicyContract(challenge.fritzPolicyVersion)
    || challenge.rankingVersion !== DAILY_FRITZ_RANKING_VERSION
  ) {
    throw new Error('Daily Fritz challenge versions are incompatible with this publisher.');
  }
  if (challenge.games.length !== 3) throw new Error('Daily Fritz requires exactly three games.');
  for (const [index, game] of challenge.games.entries()) {
    const gameNumber = (index + 1) as DailyFritzSetGameNumber;
    if (game.gameNumber !== gameNumber || game.seed !== getDailyFritzGameSeed(challenge.runDate, gameNumber)) {
      throw new Error(`Daily Fritz game ${gameNumber} identity is invalid.`);
    }
    if (game.handGenerationContract !== DAILY_FRITZ_HAND_GENERATION_CONTRACT) {
      throw new Error(`Daily Fritz game ${gameNumber} generation contract is invalid.`);
    }
    if (!dailyFritzDrawTilesMatchWinner(game.drawTiles, game.drawWinner)) {
      throw new Error(`Daily Fritz game ${gameNumber} draw package is inconsistent.`);
    }
    if (game.hands.length !== DAILY_FRITZ_PUBLISHED_HAND_SLOTS) {
      throw new Error(`Daily Fritz game ${gameNumber} is missing published hand slots.`);
    }
    game.hands.forEach((hand, handIndex) => {
      assertValidHand(hand, challenge.dealSize, `games[${index}].hands[${handIndex}]`);
    });
    const { contentDigest, ...gameContent } = game;
    if (digestDailyFritzChallengeContent(gameContent) !== contentDigest) {
      throw new Error(`Daily Fritz game ${gameNumber} digest is invalid.`);
    }
  }
  if (digestDailyFritzChallengeContent(getDailyFritzPublishedChallengeContent(challenge)) !== challenge.contentDigest) {
    throw new Error('Daily Fritz challenge digest is invalid.');
  }
  if (challenge.status === 'invalidated' && !challenge.invalidatedAt) {
    throw new Error('Invalidated Daily Fritz challenge is missing invalidation metadata.');
  }
}

function buildPublishedGame(input: {
  runDate: string;
  gameNumber: DailyFritzSetGameNumber;
  dealSize: 7 | 14;
}): DailyFritzPublishedGame {
  const gameContent = {
    gameNumber: input.gameNumber,
    seed: getDailyFritzGameSeed(input.runDate, input.gameNumber),
    drawWinner: getDailyFritzDrawWinner(input.runDate, input.gameNumber),
    drawTiles: getDailyFritzDrawTiles(input.runDate, input.gameNumber),
    handGenerationContract: DAILY_FRITZ_HAND_GENERATION_CONTRACT,
    hands: Array.from({ length: DAILY_FRITZ_PUBLISHED_HAND_SLOTS }, (_, handIndex) =>
      generateSingleDailyFritzGameHand(
        input.runDate,
        input.gameNumber,
        handIndex,
        input.dealSize,
      )),
  };
  return {
    ...gameContent,
    contentDigest: digestDailyFritzChallengeContent(gameContent),
  };
}

export function buildDailyFritzPublishedChallenge(input: {
  runDate: string;
  fritzTier?: DailyFritzTier;
  dealSize?: 7 | 14;
  winningScore?: number;
  publishedAt?: string;
}): DailyFritzPublishedChallenge {
  const dealSize = input.dealSize ?? 7;
  const games = ([1, 2, 3] as const).map((gameNumber) =>
    buildPublishedGame({ runDate: input.runDate, gameNumber, dealSize })) as [
      DailyFritzPublishedGame,
      DailyFritzPublishedGame,
      DailyFritzPublishedGame,
    ];
  const content: DailyFritzPublishedChallengeContent = {
    contractVersion: DAILY_FRITZ_CHALLENGE_CONTRACT_VERSION,
    challengeId: buildDailyFritzChallengeId(input.runDate),
    runDate: input.runDate,
    timeZone: DAILY_FRITZ_TIME_ZONE,
    generationVersion: DAILY_FRITZ_GENERATION_VERSION,
    seedVersion: DAILY_FRITZ_SEED_VERSION,
    productRulesVersion: DAILY_FRITZ_RULES_VERSION,
    gameRulesVersion: GAME_RULES_VERSION,
    transcriptProtocolVersion: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
    verifierVersion: DAILY_FRITZ_VERIFIER_VERSION,
    fritzPolicyVersion: FRITZ_POLICY_VERSION,
    fritzPolicyContract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
    rankingVersion: DAILY_FRITZ_RANKING_VERSION,
    seed: getDailyFritzSeed(input.runDate),
    fritzTier: input.fritzTier ?? 'elite',
    dealSize,
    winningScore: input.winningScore ?? 60,
    games,
  };
  const challenge: DailyFritzPublishedChallenge = {
    ...content,
    status: 'live',
    contentDigest: digestDailyFritzChallengeContent(content),
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    invalidatedAt: null,
    invalidationReason: null,
  };
  assertValidDailyFritzPublishedChallenge(challenge);
  return challenge;
}
