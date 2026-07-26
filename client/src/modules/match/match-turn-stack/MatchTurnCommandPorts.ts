import type { MoveEntry } from '../../../game/moveLogger.ts';
import type { BotActionResult, BotMatchState, BotPlayerId } from '../runtime/botEngine.ts';
import type { BotHandReveal } from '../types.ts';

export type MatchTurnCommandPorts = {
  notifyBotActionResult: (result: BotActionResult) => void;
  applyAndNotify: (result: BotActionResult) => void;
  appendMove: (entry: Omit<MoveEntry, 'moveNumber' | 'handNumber'>, handNumber?: number) => void;
  recordAuthoringStep: (chosenMove: string | null) => void;
  scheduleHandReveal: (reveal: BotHandReveal, delayMs: number) => void;
  clearHandReveal: () => void;
  triggerDrawStepAnimation: (drawer: BotPlayerId, nextState: BotMatchState) => void;
  scheduleDrawStepAnimation: (drawer: BotPlayerId, nextState: BotMatchState) => void;
};

export type BuildMatchTurnCommandPortsInput = {
  notifyBotActionResult: MatchTurnCommandPorts['notifyBotActionResult'];
  applyAndNotify: MatchTurnCommandPorts['applyAndNotify'];
  appendMove: MatchTurnCommandPorts['appendMove'];
  recordAuthoringStep: MatchTurnCommandPorts['recordAuthoringStep'];
  scheduleHandReveal: MatchTurnCommandPorts['scheduleHandReveal'];
  clearHandReveal: MatchTurnCommandPorts['clearHandReveal'];
  triggerDrawStepAnimation: MatchTurnCommandPorts['triggerDrawStepAnimation'];
  scheduleDrawStepAnimation: MatchTurnCommandPorts['scheduleDrawStepAnimation'];
};

export function buildMatchTurnCommandPorts(
  input: BuildMatchTurnCommandPortsInput,
): MatchTurnCommandPorts {
  return {
    notifyBotActionResult: input.notifyBotActionResult,
    applyAndNotify: input.applyAndNotify,
    appendMove: input.appendMove,
    recordAuthoringStep: input.recordAuthoringStep,
    scheduleHandReveal: input.scheduleHandReveal,
    clearHandReveal: input.clearHandReveal,
    triggerDrawStepAnimation: input.triggerDrawStepAnimation,
    scheduleDrawStepAnimation: input.scheduleDrawStepAnimation,
  };
}
