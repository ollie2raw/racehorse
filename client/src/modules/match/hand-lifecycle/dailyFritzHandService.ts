import {
  startNextFixedBotHand,
  type BotMatchState,
} from '../runtime/botEngine.ts';
import {
  canApplyNextHand,
  DAILY_FRITZ_HAND_AUTO_ADVANCE_MS,
  DAILY_FRITZ_HAND_REVEAL_DELAY_MS,
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

export function buildDailyFritzPrefetchParams(
  dailyFritzPackage: DailyFritzStartResponse,
  dailyFritzHandIndex: number,
  match: BotMatchState,
  moveLog: readonly MoveEntry[],
): DailyFritzPrefetchParams {
  const gameNumber = (dailyFritzPackage.current_game_number ?? 1) as DailyFritzSetGameNumber;
  let transcript: DailyFritzPrefetchParams['transcript'] = null;
  try {
    transcript = buildDailyFritzTranscript({
      challengeId: dailyFritzPackage.challenge_id
        ?? createDailyFritzChallengeIdentity(dailyFritzPackage.run_date).challengeId,
      attemptId: dailyFritzPackage.attempt_id,
      gameNumber,
      handIndex: dailyFritzHandIndex,
      handNumber: match.handNumber,
      moveLog,
    });
  } catch {
    // Pre-verifier persisted logs may not contain placement positions.
  }
  return {
    dailyFritzPackage,
    dailyFritzHandIndex,
    gameNumber,
    transcript,
    completedHandScores: { you: match.players.you.score, fritz: match.players.bot.score },
  };
}

export function createDailyFritzNextHandRequest(
  params: DailyFritzPrefetchParams,
): Promise<DailyFritzNextHandResponse> {
  const { dailyFritzPackage, dailyFritzHandIndex, gameNumber, transcript, completedHandScores } = params;
  return nextDailyFritzHand({
    attemptId: dailyFritzPackage.attempt_id,
    verifiedMatchId: dailyFritzPackage.verified_match_id,
    runDate: dailyFritzPackage.run_date,
    gameNumber,
    completedHandIndex: dailyFritzHandIndex,
    transcript,
    completedHandScores,
    timeoutMs: DAILY_FRITZ_NEXT_HAND_TIMEOUT_MS,
  });
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
  const winnerId = yourScore >= botScore ? 'you' : 'bot';
  return { ...prev, handOver: false, gameOver: true, winnerId };
}
