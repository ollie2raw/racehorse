import {
  startNextFixedBotHand,
  type BotMatchState,
} from '../runtime/botEngine.ts';
import {
  canApplyNextHand,
  DAILY_FRITZ_HAND_AUTO_ADVANCE_MS,
  DAILY_FRITZ_HAND_REVEAL_DELAY_MS,
  isChallengeHandOnlyGameOver,
  resolveHandRevealScheduleMode,
} from './handLifecycleRules.ts';
import {
  DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
  nextDailyFritzHand,
  type DailyFritzNextHandResponse,
  type DailyFritzSetGameNumber,
  type DailyFritzStartResponse,
} from '../../daily/dailyFritzContracts.ts';
import { dailyFritzDebugLog } from '../../daily/dailyFritzMatchDiagnostics.ts';
import type { BotActionResult } from '../runtime/botEngine.ts';
import type { DailyFritzPrefetchParams } from './types.ts';
import type { MoveEntry } from '../../../game/moveLogger.ts';
import { buildDailyFritzTranscript } from '../../../dailyFritz/dailyFritzTranscript.ts';
import { createDailyFritzChallengeIdentity } from '../../../dailyFritz/dailyFritzChallengeIdentity.ts';
import { nextFritzChallengeHand } from '../../../fritzChallenge/api.ts';

export function computeDailyFritzMinAdvanceAtOnHandComplete(): number {
  const scheduleMode = resolveHandRevealScheduleMode(true);
  const revealDelay = scheduleMode === 'immediate' ? 0 : DAILY_FRITZ_HAND_REVEAL_DELAY_MS;
  return Date.now() + revealDelay + DAILY_FRITZ_HAND_AUTO_ADVANCE_MS;
}

export function logDailyFritzHandComplete(result: BotActionResult): void {
  dailyFritzDebugLog('[daily-flow] hand complete detected', {
    handNumber: result.state.handNumber,
    winner: result.handEnded!.winner,
    reason: result.handEnded!.reason,
    pointsAwarded: result.handEnded!.pointsAwarded,
    yourScore: result.state.players.you.score,
    botScore: result.state.players.bot.score,
    isGameOver: result.state.gameOver,
  });
  dailyFritzDebugLog('[daily-flow] hand scoring applied', {
    pointsAwarded: result.handEnded!.pointsAwarded,
    winner: result.handEnded!.winner,
    yourScore: result.state.players.you.score,
    botScore: result.state.players.bot.score,
  });
}

/**
 * The shared challenge uses the same engine for each hand, but its engine
 * gameOver flag can be raised when a hand ends. Keep that flag scoped to the
 * hand until the fixed game target is actually reached so every client-side
 * lifecycle surface follows the normal next-hand path.
 */
export function normalizeChallengeHandEndForClient(
  result: BotActionResult,
  winningScore: number | null | undefined,
): BotActionResult {
  if (!result.handEnded || !isChallengeHandOnlyGameOver({
    gameOver: result.state.gameOver,
    youScore: result.state.players.you.score,
    botScore: result.state.players.bot.score,
    winningScore,
  })) {
    return result;
  }
  return {
    ...result,
    state: {
      ...result.state,
      gameOver: false,
      winnerId: null,
    },
  };
}

export function buildDailyFritzPrefetchParams(
  dailyFritzPackage: DailyFritzStartResponse,
  dailyFritzHandIndex: number,
  match: BotMatchState,
  moveLog: readonly MoveEntry[],
  transcriptProtocolVersion: 1 | 2 = 2,
): DailyFritzPrefetchParams {
  const gameNumber = (dailyFritzPackage.current_game_number ?? 1) as DailyFritzSetGameNumber;
  let transcript: DailyFritzPrefetchParams['transcript'] = null;
  let transcriptError: string | undefined;
  try {
    transcript = buildDailyFritzTranscript({
      challengeId: dailyFritzPackage.challenge_id
        ?? createDailyFritzChallengeIdentity(dailyFritzPackage.run_date).challengeId,
      attemptId: dailyFritzPackage.attempt_id,
      gameNumber,
      handIndex: dailyFritzHandIndex,
      handNumber: match.handNumber,
      moveLog,
      protocolVersion: transcriptProtocolVersion,
      fritzPolicyVersion: dailyFritzPackage.fritz_policy_version,
      sealBlockedHand: match.handOver
        && match.players.you.hand.length > 0
        && match.players.bot.hand.length > 0
        && match.boneyard.length <= match.deadTiles.length,
    });
  } catch (error) {
    transcriptError = error instanceof Error
      ? error.message
      : 'Daily Fritz verification evidence could not be built.';
  }
  return {
    dailyFritzPackage,
    dailyFritzHandIndex,
    gameNumber,
    transcript,
    ...(transcriptError ? { transcriptError } : {}),
    completedHandScores: { you: match.players.you.score, fritz: match.players.bot.score },
  };
}

export function buildDailyFritzCompletedHandEvidenceKey(
  dailyFritzPackage: Pick<DailyFritzStartResponse, 'attempt_id'>,
  gameNumber: DailyFritzSetGameNumber,
  handIndex: number,
  handNumber: number,
): string {
  return `${dailyFritzPackage.attempt_id}:${gameNumber}:${handIndex}:${handNumber}`;
}

export function createDailyFritzNextHandRequest(
  params: DailyFritzPrefetchParams,
): Promise<DailyFritzNextHandResponse> {
  const { dailyFritzPackage, dailyFritzHandIndex, gameNumber, transcript, completedHandScores } = params;
  if (params.transcriptError && dailyFritzPackage.verification_status !== 'legacy_unverified') {
    return Promise.reject(new Error(
      'Daily Fritz verification evidence could not be built. Reload the latest deployment and resume this attempt.',
    ));
  }
  const request = {
    attemptId: dailyFritzPackage.attempt_id,
    verifiedMatchId: dailyFritzPackage.verified_match_id,
    gameNumber,
    completedHandIndex: dailyFritzHandIndex,
    transcript,
    completedHandScores,
  };
  if (dailyFritzPackage.challenge_code) {
    if (!transcript) return Promise.reject(new Error('Challenge verification evidence could not be built.'));
    return nextFritzChallengeHand({
      code: dailyFritzPackage.challenge_code,
      attemptId: request.attemptId,
      verifiedMatchId: request.verifiedMatchId,
      gameNumber: request.gameNumber,
      completedHandIndex: request.completedHandIndex,
      transcript,
      completedHandScores: request.completedHandScores,
    });
  }
  return nextDailyFritzHand({ ...request, runDate: dailyFritzPackage.run_date, timeoutMs: DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS });
}

export type ApplyDailyFritzNextHandResult =
  | { applied: true; nextState: BotMatchState }
  | { applied: false };

/** Pure state transition: apply server next-hand deal when local match is ready. */
export function tryApplyDailyFritzNextHand(
  prev: BotMatchState,
  hand: DailyFritzNextHandResponse['hand'],
  scores?: DailyFritzNextHandResponse['current_game_scores'],
): ApplyDailyFritzNextHandResult {
  if (!canApplyNextHand(prev)) {
    return { applied: false };
  }
  const nextHand = startNextFixedBotHand(prev, hand);
  return {
    applied: true,
    nextState: {
      ...nextHand,
      ...(scores ? { players: {
        you: { ...nextHand.players.you, score: scores.you },
        bot: { ...nextHand.players.bot, score: scores.fritz },
      } } : {}),
      opponentPassedOnEnds: [],
      opponentDrawCount: 0,
      opponentKnownMissing: [],
    },
  };
}

/** Mark the Daily Fritz set/run complete when the server signals end-of-run. */
export function createEndOfRunMatchState(prev: BotMatchState): BotMatchState {
  const yourScore = prev.players.you.score;
  const botScore = prev.players.bot.score;
  // Align with server: ties are rejected; never invent a winner from `>=`.
  const winnerId = yourScore > botScore ? 'you' : yourScore < botScore ? 'bot' : null;
  return { ...prev, handOver: false, gameOver: true, winnerId };
}
