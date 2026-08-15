import type { DailyFritzDrawWinner, DailyFritzHandDeal, DailyFritzTier } from '../dailyFritz';
import { buildHonestDailyFritzHandTranscript } from './dailyFritzTranscriptDriver';

type Json = Record<string, unknown>;

export type DailyFritzLifecycleStart = Json & {
  attempt_id: string;
  verified_match_id: string;
  run_date: string;
  challenge_id: string;
  current_game_number: 1 | 2 | 3;
  current_hand_index: number;
  current_game_scores: { you: number; fritz: number };
  fritz_tier: DailyFritzTier;
  fritz_policy_version: 1 | 2;
  deal_size: 7 | 14;
  winning_score: number;
  first_hand: DailyFritzHandDeal;
  draw_winner: DailyFritzDrawWinner;
};

export type DailyFritzLifecycleRequest = (input: {
  path: string;
  method: 'POST';
  body: Json;
}) => Promise<Json>;

function gameNumber(value: unknown): 1 | 2 | 3 {
  const parsed = Number(value);
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed;
  throw new Error('Daily Fritz lifecycle response has an invalid game number.');
}

function readStart(value: Json): DailyFritzLifecycleStart {
  if (typeof value.attempt_id !== 'string' || typeof value.verified_match_id !== 'string'
    || typeof value.run_date !== 'string' || typeof value.challenge_id !== 'string') {
    throw new Error('Daily Fritz lifecycle response is missing authority identity.');
  }
  const tier = value.fritz_tier;
  const policy = Number(value.fritz_policy_version);
  const dealSize = Number(value.deal_size);
  const drawWinner = value.draw_winner;
  const scores = value.current_game_scores as { you?: unknown; fritz?: unknown } | undefined;
  if (tier !== 'rookie' && tier !== 'standard' && tier !== 'elite' && tier !== 'master') throw new Error('Invalid Fritz tier.');
  if (policy !== 1 && policy !== 2) throw new Error('Invalid Fritz policy version.');
  if (dealSize !== 7 && dealSize !== 14) throw new Error('Invalid Daily Fritz deal size.');
  if (drawWinner !== 'you' && drawWinner !== 'bot') throw new Error('Invalid Daily Fritz draw winner.');
  if (!scores || !Number.isFinite(Number(scores.you)) || !Number.isFinite(Number(scores.fritz))) throw new Error('Invalid Daily Fritz score state.');
  return {
    ...value,
    attempt_id: value.attempt_id,
    verified_match_id: value.verified_match_id,
    run_date: value.run_date,
    challenge_id: value.challenge_id,
    current_game_number: gameNumber(value.current_game_number),
    current_hand_index: Number(value.current_hand_index),
    current_game_scores: { you: Number(scores.you), fritz: Number(scores.fritz) },
    fritz_tier: tier,
    fritz_policy_version: policy,
    deal_size: dealSize,
    winning_score: Number(value.winning_score),
    first_hand: value.first_hand as DailyFritzHandDeal,
    draw_winner: drawWinner,
  };
}

/** Drives the published Daily Fritz best-of-three through verified HTTP commands. */
export async function driveDailyFritzAttempt(input: {
  start: DailyFritzLifecycleStart;
  startBody: Json;
  request: DailyFritzLifecycleRequest;
  maxHands?: number;
}): Promise<{ attemptId: string; gamesPlayed: number; handsPlayed: number; setResult: Json }> {
  const attemptId = input.start.attempt_id;
  let current = input.start;
  let gamesPlayed = 0;
  let handsPlayed = 0;
  const maxHands = input.maxHands ?? 96;

  while (handsPlayed < maxHands) {
    const driven = buildHonestDailyFritzHandTranscript({
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
      clientRelease: 'daily-fritz-lifecycle-driver',
    });
    handsPlayed += 1;
    if (!driven.terminalState.gameOver) {
      const advanced = await input.request({
        path: '/api/daily-fritz/next-hand',
        method: 'POST',
        body: {
          attempt_id: attemptId,
          verified_match_id: current.verified_match_id,
          run_date: current.run_date,
          game_number: current.current_game_number,
          completed_hand_index: current.current_hand_index,
          transcript: driven.transcript,
        },
      });
      current = readStart({
        ...current,
        current_game_number: advanced.current_game_number,
        current_hand_index: advanced.current_hand_index,
        current_game_scores: advanced.current_game_scores,
        first_hand: advanced.hand,
      });
      continue;
    }

    const recordBody = {
      attempt_id: attemptId,
      verified_match_id: current.verified_match_id,
      run_date: current.run_date,
      game_number: current.current_game_number,
      transcript: driven.transcript,
    };
    const recorded = await input.request({ path: '/api/daily-fritz/record-game', method: 'POST', body: recordBody });
    const replayed = await input.request({ path: '/api/daily-fritz/record-game', method: 'POST', body: recordBody });
    if (replayed.replayed !== true) throw new Error('Daily Fritz record-game replay was not idempotent.');
    gamesPlayed += 1;
    const setResult = recorded.set_result as Json | undefined;
    if (!setResult) throw new Error('Daily Fritz record-game omitted its set result.');
    if (setResult.setWinner) {
      const completionBody = {
        attempt_id: attemptId,
        verified_match_id: current.verified_match_id,
        run_date: current.run_date,
      };
      await input.request({ path: '/api/daily-fritz/complete', method: 'POST', body: completionBody });
      const completionReplay = await input.request({ path: '/api/daily-fritz/complete', method: 'POST', body: completionBody });
      if (completionReplay.replayed !== true) throw new Error('Daily Fritz completion replay was not idempotent.');
      return { attemptId, gamesPlayed, handsPlayed, setResult };
    }
    current = readStart(await input.request({
      path: '/api/daily-fritz/start',
      method: 'POST',
      body: input.startBody,
    }));
  }
  throw new Error(`Daily Fritz lifecycle exceeded ${maxHands} hands.`);
}

export function parseDailyFritzLifecycleStart(value: Json): DailyFritzLifecycleStart {
  return readStart(value);
}
