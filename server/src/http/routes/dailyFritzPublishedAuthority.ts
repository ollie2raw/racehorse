import {
  DAILY_FRITZ_GENERATION_VERSION,
  assertValidDailyFritzPublishedChallenge,
  type DailyFritzPublishedChallenge,
} from '../../dailyFritzPublishedChallenge';
import {
  generateSingleDailyFritzGameHand,
  type DailyFritzDrawTiles,
  type DailyFritzDrawWinner,
  type DailyFritzHandDeal,
  type DailyFritzSetGameNumber,
} from '../../dailyFritz';
import type {
  DailyFritzAttemptRecord,
  DailyFritzRunRecord,
} from '../stores/dailyFritzStore';
import { getDailyFritzPublishedChallenge } from '../stores/dailyFritzPublishedChallengeStore';

export type DailyFritzPublishedGameAuthority = {
  deal: DailyFritzHandDeal;
  drawWinner: DailyFritzDrawWinner;
  drawTiles: DailyFritzDrawTiles;
};

export function assertDailyFritzAttemptPinsPublishedChallenge(
  attempt: DailyFritzAttemptRecord,
  challenge: DailyFritzPublishedChallenge,
): void {
  const incompatible =
    attempt.challengeId !== challenge.challengeId
    || attempt.runDate !== challenge.runDate
    || attempt.challengeContractVersion !== challenge.contractVersion
    || attempt.generationVersion !== challenge.generationVersion
    || attempt.gameRulesVersion !== challenge.gameRulesVersion
    || attempt.transcriptProtocolVersion !== challenge.transcriptProtocolVersion
    || attempt.fritzPolicyVersion !== challenge.fritzPolicyVersion
    || attempt.rankingVersion !== challenge.rankingVersion;
  if (incompatible) throw new Error('daily_fritz_attempt_challenge_version_mismatch');
  if (challenge.status !== 'live') throw new Error('daily_fritz_published_challenge_unavailable');
}

export function assertDailyFritzRunMatchesPublishedChallenge(
  run: DailyFritzRunRecord,
  challenge: DailyFritzPublishedChallenge,
): void {
  if (
    run.runDate !== challenge.runDate
    || run.seed !== challenge.seed
    || run.fritzTier !== challenge.fritzTier
    || run.dealSize !== challenge.dealSize
    || run.winningScore !== challenge.winningScore
  ) {
    throw new Error('daily_fritz_legacy_run_publication_mismatch');
  }
}

export function resolveDailyFritzPublishedGameAuthority(input: {
  challenge: DailyFritzPublishedChallenge;
  gameNumber: DailyFritzSetGameNumber;
  handIndex: number;
}): DailyFritzPublishedGameAuthority {
  assertValidDailyFritzPublishedChallenge(input.challenge);
  if (!Number.isInteger(input.handIndex) || input.handIndex < 0) {
    throw new Error('daily_fritz_invalid_published_hand_index');
  }
  const game = input.challenge.games[input.gameNumber - 1];
  if (!game || game.gameNumber !== input.gameNumber) {
    throw new Error('daily_fritz_published_game_missing');
  }
  const deal = game.hands[input.handIndex]
    ?? (() => {
      if (input.challenge.generationVersion !== DAILY_FRITZ_GENERATION_VERSION) {
        throw new Error('daily_fritz_historical_generator_unavailable');
      }
      return generateSingleDailyFritzGameHand(
        input.challenge.runDate,
        input.gameNumber,
        input.handIndex,
        input.challenge.dealSize,
      );
    })();
  return {
    deal,
    drawWinner: game.drawWinner,
    drawTiles: game.drawTiles,
  };
}

export async function loadDailyFritzPublishedAuthority(input: {
  attempt: DailyFritzAttemptRecord;
  run: DailyFritzRunRecord;
}): Promise<DailyFritzPublishedChallenge | null> {
  if (!input.attempt.challengeId) return null;
  const challenge = await getDailyFritzPublishedChallenge(input.attempt.challengeId);
  if (!challenge) throw new Error('daily_fritz_published_challenge_missing');
  assertDailyFritzAttemptPinsPublishedChallenge(input.attempt, challenge);
  assertDailyFritzRunMatchesPublishedChallenge(input.run, challenge);
  return challenge;
}
