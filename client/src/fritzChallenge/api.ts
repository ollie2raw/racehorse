import { apiGet, apiPost, type ApiResult } from '../api/client';
import type { FritzTier } from '../modules/fritz/fritzConfig';
import type { BotDealSize, BotHandDeal } from '../modules/match/runtime/botEngine';
import {
  DailyFritzEndOfRunError,
  type DailyFritzNextHandResponse,
  type DailyFritzStartResponse,
} from '../dailyFritz/api';

export type FritzChallengeViewerRole = 'creator' | 'opponent' | null;
export type FritzChallengeStatus = 'open' | 'active' | 'completed' | 'expired' | 'cancelled';

export type FritzChallengeView = {
  id: string;
  share_code: string;
  challenge_id: string;
  fingerprint: string;
  status: FritzChallengeStatus;
  format: 'best_of_3';
  fritz_tier: FritzTier;
  deal_size: BotDealSize;
  winning_score: number;
  has_opponent: boolean;
  invite_sent: boolean;
  recipient_accepted: boolean;
  viewer_role: FritzChallengeViewerRole;
  created_at: string;
  expires_at: string;
  attempt?: FritzChallengeAttemptView;
};

type ChallengeEnvelope = {
  ok: true;
  challenge: FritzChallengeView;
};

export type CreateFritzChallengeResponse = ChallengeEnvelope & {
  share_path: string;
};

export type FritzChallengeAttemptView = {
  id: string;
  status: 'started' | 'completed' | 'abandoned';
  current_game_number: 1 | 2 | 3;
  current_hand_index: number;
  revision: number;
  final_score?: number | null;
  opponent_score?: number | null;
  point_diff?: number | null;
  won?: boolean | null;
  set_result?: {
    setWinner?: 'player' | 'fritz';
    playerGamesWon?: number;
    fritzGamesWon?: number;
    totalPointDiff?: number;
    games?: Array<{
      gameNumber: number;
      playerWon: boolean;
      playerScore: number;
      fritzScore: number;
      pointDiff: number;
    }>;
  } | null;
};

export type StartFritzChallengeResponse = ChallengeEnvelope & {
  attempt: FritzChallengeAttemptView;
  challenge_id: string;
  fingerprint: string;
  verification_protocol_version: number;
  game_rules_version: number;
  fritz_policy_version: number;
  verifier_version: number;
  current_game_number: 1 | 2 | 3;
  current_hand_index: number;
  current_game_scores: { you: number; fritz: number };
  fritz_tier: FritzTier;
  deal_size: BotDealSize;
  winning_score: number;
  first_hand: BotHandDeal;
  draw_winner: 'you' | 'bot';
  draw_player_tile: { low: number; high: number };
  draw_fritz_tile: { low: number; high: number };
  challenge_code: string;
  run_date: string;
  verified_match_id: string;
};

function unwrap<T>(result: ApiResult<T>): T {
  if (result.error || !result.data) {
    const error = new Error(result.error ?? 'Fritz Challenge request failed.');
    Object.assign(error, {
      status: result.status,
      code: result.errorCode,
    });
    throw error;
  }
  return result.data;
}

export async function createFritzChallenge(input: {
  fritzTier: FritzTier;
  dealSize: BotDealSize;
  recipientUserId: string;
}): Promise<CreateFritzChallengeResponse> {
  return unwrap(await apiPost<CreateFritzChallengeResponse>('/api/fritz-challenges', {
    fritz_tier: input.fritzTier,
    deal_size: input.dealSize,
    recipient_user_id: input.recipientUserId,
  }));
}

export async function getFritzChallenge(code: string): Promise<FritzChallengeView> {
  return unwrap(
    await apiGet<ChallengeEnvelope>(`/api/fritz-challenges/${encodeURIComponent(code)}`),
  ).challenge;
}

export async function joinFritzChallenge(code: string): Promise<FritzChallengeView> {
  return unwrap(
    await apiPost<ChallengeEnvelope>(
      `/api/fritz-challenges/${encodeURIComponent(code)}/join`,
      {},
    ),
  ).challenge;
}

export async function startFritzChallenge(
  code: string,
): Promise<StartFritzChallengeResponse> {
  const core = await import('@racehorse/game-core');
  return unwrap(await apiPost<StartFritzChallengeResponse>(
    `/api/fritz-challenges/${encodeURIComponent(code)}/start`,
    {
      verification_protocol_version: core.DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
      game_rules_version: core.GAME_RULES_VERSION,
      fritz_policy_version: core.FRITZ_POLICY_VERSION,
      verifier_version: core.DAILY_FRITZ_VERIFIER_VERSION,
    },
  ));
}

export function toDailyFritzChallengePackage(
  response: StartFritzChallengeResponse,
): DailyFritzStartResponse {
  return {
    ok: true,
    attempt_id: response.attempt.id,
    verified_match_id: response.verified_match_id,
    run_date: response.run_date,
    challenge_id: response.challenge_id,
    run_fingerprint: response.fingerprint,
    verification_protocol_version: response.verification_protocol_version,
    game_rules_version: response.game_rules_version,
    fritz_policy_version: response.fritz_policy_version,
    verifier_version: response.verifier_version,
    current_hand_index: response.current_hand_index,
    current_game_scores: response.current_game_scores,
    current_game_number: response.current_game_number,
    authority_revision: response.attempt.revision,
    set_result: null,
    fritz_tier: response.fritz_tier,
    deal_size: response.deal_size,
    winning_score: response.winning_score,
    first_hand: response.first_hand,
    draw_winner: response.draw_winner,
    draw_player_tile: response.draw_player_tile,
    draw_fritz_tile: response.draw_fritz_tile,
    challenge_code: response.challenge_code,
  };
}

export async function nextFritzChallengeHand(input: {
  code: string;
  attemptId: string;
  verifiedMatchId: string;
  gameNumber: 1 | 2 | 3;
  completedHandIndex: number;
  transcript: import('@racehorse/game-core').DailyFritzTranscript;
  completedHandScores: { you: number; fritz: number };
}): Promise<DailyFritzNextHandResponse> {
  try {
    return unwrap(await apiPost<DailyFritzNextHandResponse>(
      `/api/fritz-challenges/${encodeURIComponent(input.code)}/next-hand`,
      {
        attempt_id: input.attemptId,
        verified_match_id: input.verifiedMatchId,
        game_number: input.gameNumber,
        completed_hand_index: input.completedHandIndex,
        transcript: input.transcript,
        completed_hand_scores: input.completedHandScores,
      },
    ));
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === 'attempt_inactive') {
      throw new DailyFritzEndOfRunError('This challenge has already been completed.');
    }
    // A response can be lost after the authority committed the hand, or a
    // second tab can advance first. Resume from the durable attempt instead
    // of making the player manually refresh through a recoverable conflict.
    if (error instanceof Error && (error as Error & { code?: string }).code === 'stale_revision') {
      const resumed = await startFritzChallenge(input.code);
      if (resumed.current_game_number !== input.gameNumber) {
        throw new DailyFritzEndOfRunError('This challenge advanced in another session. Resume the authoritative game.');
      }
      return {
        ok: true,
        run_date: resumed.run_date,
        game_number: resumed.current_game_number,
        current_game_number: resumed.current_game_number,
        current_hand_index: resumed.current_hand_index,
        authority_revision: resumed.attempt.revision,
        current_game_scores: resumed.current_game_scores,
        hand: resumed.first_hand,
        draw_winner: resumed.draw_winner,
        draw_player_tile: resumed.draw_player_tile,
        draw_fritz_tile: resumed.draw_fritz_tile,
        replayed: true,
      };
    }
    throw error;
  }
}

export type FritzChallengeGameRecordResponse = {
  ok: true;
  hand_advanced?: boolean;
  set_result?: NonNullable<DailyFritzStartResponse['set_result']>;
  next_game_number?: 1 | 2 | 3 | null;
  authority_revision?: number;
  current_hand_index?: number;
  current_game_scores?: { you: number; fritz: number };
  hand?: BotHandDeal;
  draw_winner?: 'you' | 'bot';
  draw_player_tile?: { low: number; high: number };
  draw_fritz_tile?: { low: number; high: number };
};

export async function recordFritzChallengeGame(input: {
  code: string;
  attemptId: string;
  gameNumber: 1 | 2 | 3;
  finalScore: number;
  opponentScore: number;
  transcript: import('@racehorse/game-core').DailyFritzTranscript;
}): Promise<FritzChallengeGameRecordResponse> {
  const submit = () => apiPost<FritzChallengeGameRecordResponse>(`/api/fritz-challenges/${encodeURIComponent(input.code)}/record-game`, {
    attempt_id: input.attemptId,
    game_number: input.gameNumber,
    final_score: input.finalScore,
    opponent_score: input.opponentScore,
    transcript: input.transcript,
  });

  try {
    return unwrap(await submit());
  } catch (error) {
    if (error instanceof Error && (error as Error & { code?: string }).code === 'attempt_inactive') {
      throw new DailyFritzEndOfRunError('This challenge has already been completed.');
    }
    // A lost response or another tab may have committed this exact game first.
    // Refresh the authoritative attempt, then replay the same operation once;
    // the server's game receipt makes the retry idempotent.
    if (error instanceof Error && (error as Error & { code?: string }).code === 'stale_revision') {
      await startFritzChallenge(input.code);
      return unwrap(await submit());
    }
    throw error;
  }
}
