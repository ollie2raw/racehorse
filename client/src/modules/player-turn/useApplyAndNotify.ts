import { useCallback } from 'react';
import type { BotActionResult, BotMatchState } from '../match/runtime/botEngine.ts';
import {
  logPlayerDrawFairness,
  mergePlayerDrawPassTracking,
} from './applyPlayerActionResult.ts';

export function useApplyAndNotify(
  setMatch: (updater: BotMatchState | ((prev: BotMatchState) => BotMatchState)) => void,
  notifyBotActionResult: (result: BotActionResult) => void,
  onActionError: (message: string) => void,
) {
  return useCallback((result: BotActionResult) => {
    if (result.error) {
      onActionError(result.error.message);
      return;
    }
    const adjustedState = result.state;
    setMatch((prev) => mergePlayerDrawPassTracking(prev, adjustedState, result));
    logPlayerDrawFairness(result, adjustedState);
    notifyBotActionResult({ ...result, state: adjustedState });
  }, [notifyBotActionResult, onActionError, setMatch]);
}
