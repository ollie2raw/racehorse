import {
  getMatchableOpenEnds,
  type BotActionResult,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import { fairnessLog } from '../match/runtime/fairnessLog.ts';

/** Merge opponent draw/pass tracking when the player draws or passes. */
export function mergePlayerDrawPassTracking(
  prev: BotMatchState,
  adjustedState: BotMatchState,
  result: BotActionResult,
): BotMatchState {
  const trackedDraw = result.drew?.player === 'you' ? 1 : 0;
  const trackedPass = result.passed?.player === 'you' ? 1 : 0;
  if (trackedDraw === 0 && trackedPass === 0) {
    return adjustedState;
  }

  const openEnds = adjustedState.board
    ? getMatchableOpenEnds(adjustedState.board).map((end) => end.matchValue)
    : [];

  return {
    ...adjustedState,
    opponentPassedOnEnds: [
      ...(prev.opponentPassedOnEnds ?? []),
      ...Array.from({ length: trackedDraw + trackedPass }, () => openEnds).flat(),
    ],
    opponentDrawCount: (prev.opponentDrawCount ?? 0) + trackedDraw,
    opponentKnownMissing: prev.opponentKnownMissing ?? adjustedState.opponentKnownMissing ?? [],
  };
}

export function logPlayerDrawFairness(result: BotActionResult, adjustedState: BotMatchState): void {
  if (!result.drew) return;
  fairnessLog('draw', {
    player: result.drew.player,
    tile: `${result.drew.tile.low}-${result.drew.tile.high}`,
    handNumber: adjustedState.handNumber,
    boneyardRemaining: adjustedState.boneyard.length,
  });
}