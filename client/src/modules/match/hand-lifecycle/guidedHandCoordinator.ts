import {
  startNextBotHand,
  startNextFixedBotHand,
  type BotMatchState,
} from '../runtime/botEngine.ts';
import { canApplyNextHand } from './handLifecycleRules.ts';
import { generateAuthoringHandDeal, type FrozenLesson } from '../../../learn/guidedAuthoring.ts';

export type LocalHandAdvancePlan = {
  previousState: BotMatchState;
  nextState: BotMatchState;
};

/** Resolve the next hand for bot / guided v1 / authoring modes (non-Daily-Fritz). */
export function planLocalHandAdvance(
  previousState: BotMatchState,
  options: {
    isAuthoringMode: boolean;
    isGuidedMode: boolean;
    frozenLesson: FrozenLesson | null;
  },
): LocalHandAdvancePlan | null {
  if (!canApplyNextHand(previousState)) return null;
  const useSeededDeal =
    options.isAuthoringMode || (options.isGuidedMode && options.frozenLesson !== null);
  const nextCore = useSeededDeal
    ? startNextFixedBotHand(previousState, generateAuthoringHandDeal(previousState.handNumber))
    : startNextBotHand(previousState);
  return {
    previousState,
    nextState: {
      ...nextCore,
      opponentPassedOnEnds: [],
      opponentDrawCount: 0,
      opponentKnownMissing: [],
    },
  };
}