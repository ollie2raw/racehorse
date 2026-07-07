import type { Tile } from '../../../types.ts';
import type { BotChoice } from '../../fritz/botHeuristics.ts';
import type { HandLifecyclePorts } from '../hand-lifecycle/types.ts';

export type BuildHandLifecyclePortsInput = {
  invalidateLocalRuns: HandLifecyclePorts['invalidateLocalRuns'];
  flashLastPlayed: (tile: Tile | null) => void;
  setSelectedTile: (tile: Tile | null) => void;
  setLastBotChoice: (choice: BotChoice | null) => void;
  pushToast: HandLifecyclePorts['pushToast'];
  showScoreToast: HandLifecyclePorts['showScoreToast'];
  showBoardToast: HandLifecyclePorts['showBoardToast'];
  captureGuidedMatchCandidateNextHand: HandLifecyclePorts['captureGuidedMatchCandidateNextHand'];
};

export function buildHandLifecyclePorts(input: BuildHandLifecyclePortsInput): HandLifecyclePorts {
  return {
    invalidateLocalRuns: input.invalidateLocalRuns,
    flashLastPlayed: input.flashLastPlayed,
    setSelectedTile: input.setSelectedTile,
    setLastBotChoice: input.setLastBotChoice,
    pushToast: input.pushToast,
    showScoreToast: input.showScoreToast,
    showBoardToast: input.showBoardToast,
    captureGuidedMatchCandidateNextHand: input.captureGuidedMatchCandidateNextHand,
  };
}