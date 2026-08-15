import type { DailyFritzDrawWinner, DailyFritzHandDeal, DailyFritzTier } from '../dailyFritz';
import { buildHonestDailyFritzHandTranscript } from './dailyFritzTranscriptDriver';

type JsonObject = Record<string, unknown>;

export type FritzChallengeLifecycleRequest = (input: {
  path: string;
  method: 'POST';
  body: JsonObject;
}) => Promise<JsonObject>;

export type FritzChallengeLifecycleStart = JsonObject & {
  challenge_id: string;
  verified_match_id: string;
  current_game_number: 1 | 2 | 3;
  current_hand_index: number;
  current_game_scores: { you: number; fritz: number };
  fritz_tier: DailyFritzTier;
  deal_size: 7 | 14;
  winning_score: number;
  first_hand: DailyFritzHandDeal;
  draw_winner: DailyFritzDrawWinner;
  fritz_policy_version: 1 | 2;
};

export type FritzChallengeLifecycleResult = {
  attemptId: string;
  gamesPlayed: number;
  handsPlayed: number;
  setResult: JsonObject;
};

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function asNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} must be numeric.`);
  return parsed;
}

function asGameNumber(value: unknown): 1 | 2 | 3 {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  throw new Error('Challenge lifecycle response has an invalid game number.');
}

function readStart(value: JsonObject): FritzChallengeLifecycleStart {
  const gameNumber = asGameNumber(value.current_game_number);
  const handIndex = asNumber(value.current_hand_index, 'current_hand_index');
  const scores = asObject(value.current_game_scores, 'current_game_scores');
  const tier = value.fritz_tier;
  const dealSize = Number(value.deal_size);
  const drawWinner = value.draw_winner;
  const policyVersion = Number(value.fritz_policy_version);
  if (tier !== 'rookie' && tier !== 'standard' && tier !== 'elite' && tier !== 'master') {
    throw new Error('Challenge lifecycle response has an invalid Fritz tier.');
  }
  if (dealSize !== 7 && dealSize !== 14) throw new Error('Challenge lifecycle response has an invalid deal size.');
  if (drawWinner !== 'you' && drawWinner !== 'bot') throw new Error('Challenge lifecycle response has an invalid draw winner.');
  if (policyVersion !== 1 && policyVersion !== 2) throw new Error('Challenge lifecycle response has an invalid policy version.');
  if (typeof value.challenge_id !== 'string' || typeof value.verified_match_id !== 'string') {
    throw new Error('Challenge lifecycle response is missing authority identity.');
  }
  return {
    ...value,
    challenge_id: value.challenge_id,
    verified_match_id: value.verified_match_id,
    current_game_number: gameNumber,
    current_hand_index: handIndex,
    current_game_scores: {
      you: asNumber(scores.you, 'current_game_scores.you'),
      fritz: asNumber(scores.fritz, 'current_game_scores.fritz'),
    },
    fritz_tier: tier,
    deal_size: dealSize,
    winning_score: asNumber(value.winning_score, 'winning_score'),
    first_hand: asObject(value.first_hand, 'first_hand') as unknown as DailyFritzHandDeal,
    draw_winner: drawWinner,
    fritz_policy_version: policyVersion,
  };
}

/**
 * Drives one participant through the real Challenge HTTP command contract.
 * The caller owns authentication and transport so this can be reused by
 * Playwright, soak tests, and process-level integration tests.
 */
export async function driveFritzChallengeAttempt(input: {
  shareCode: string;
  start: FritzChallengeLifecycleStart;
  request: FritzChallengeLifecycleRequest;
  maxHands?: number;
  assertRecordReplay?: boolean;
}): Promise<FritzChallengeLifecycleResult> {
  const attemptId = input.start.verified_match_id;
  const maxHands = input.maxHands ?? 96;
  let current = input.start;
  let handsPlayed = 0;
  let gamesPlayed = 0;

  while (handsPlayed < maxHands) {
    const built = buildHonestDailyFritzHandTranscript({
      challengeId: current.challenge_id,
      attemptId,
      gameNumber: current.current_game_number,
      handIndex: current.current_hand_index,
      deal: current.first_hand,
      drawWinner: current.draw_winner,
      winningScore: current.winning_score,
      dealSize: current.deal_size,
      playerScore: current.current_game_scores.you,
      fritzScore: current.current_game_scores.fritz,
      fritzTier: current.fritz_tier,
      fritzPolicyVersion: current.fritz_policy_version,
      clientRelease: 'fritz-challenge-lifecycle-driver',
    });
    handsPlayed += 1;

    if (!built.terminalState.gameOver) {
      const advanced = await input.request({
        path: `/api/fritz-challenges/${input.shareCode}/next-hand`,
        method: 'POST',
        body: {
          attempt_id: attemptId,
          verified_match_id: attemptId,
          game_number: current.current_game_number,
          completed_hand_index: current.current_hand_index,
          transcript: built.transcript,
        },
      });
      current = readStart({
        ...current,
        current_game_number: advanced.current_game_number,
        current_hand_index: advanced.current_hand_index,
        current_game_scores: advanced.current_game_scores,
        first_hand: advanced.hand,
        draw_winner: advanced.draw_winner,
      });
      continue;
    }

    const recordBody = {
      attempt_id: attemptId,
      game_number: current.current_game_number,
      transcript: built.transcript,
    };
    const recorded = await input.request({
      path: `/api/fritz-challenges/${input.shareCode}/record-game`,
      method: 'POST',
      body: recordBody,
    });
    gamesPlayed += 1;
    if (input.assertRecordReplay !== false) {
      const replayed = await input.request({
        path: `/api/fritz-challenges/${input.shareCode}/record-game`,
        method: 'POST',
        body: recordBody,
      });
      if (replayed.replayed !== true) throw new Error('Challenge record-game replay was not idempotent.');
    }

    if (recorded.next_game_number === null) {
      return {
        attemptId,
        gamesPlayed,
        handsPlayed,
        setResult: asObject(recorded.set_result, 'set_result'),
      };
    }

    const resumed = await input.request({
      path: `/api/fritz-challenges/${input.shareCode}/start`,
      method: 'POST',
      body: {
        verification_protocol_version: current.verification_protocol_version,
        game_rules_version: current.game_rules_version,
        fritz_policy_version: current.fritz_policy_version,
        verifier_version: current.verifier_version,
      },
    });
    current = readStart(resumed);
  }

  throw new Error(`Challenge lifecycle exceeded ${maxHands} hands.`);
}

export function parseFritzChallengeLifecycleStart(value: JsonObject): FritzChallengeLifecycleStart {
  return readStart(value);
}
