import {
  createMatchCapabilities,
  type LocalMatchMode,
  type MatchCapabilities,
  type MatchExperienceOverlay,
} from '@racehorse/match-protocol';
import type { BotDealSize } from './runtime/botEngine.ts';

export type BotMatchCapabilityInput = {
  mode: LocalMatchMode;
  dealSize: BotDealSize;
  winningScore: number;
  isGuidedMode: boolean;
  isAuthoringMode: boolean;
  isAuthoringV2Mode: boolean;
  isGuidedV2Mode: boolean;
  isJourneyTrial: boolean;
  isDailyPuzzleRun: boolean;
  isStandaloneFritzMatch: boolean;
  enableGuidedMatchCandidateCapture: boolean;
  preGameDrawActive: boolean;
};

export function buildMatchCapabilitiesFromBotProps(
  input: BotMatchCapabilityInput,
): MatchCapabilities {
  const overlays = new Set<MatchExperienceOverlay>();

  if (input.isGuidedMode && !input.isAuthoringMode && !input.isGuidedV2Mode) {
    overlays.add('guided-v1');
  }
  if (input.isGuidedV2Mode) {
    overlays.add('guided-v2');
  }
  if (input.isAuthoringMode) {
    overlays.add('authoring-v1');
  }
  if (input.isAuthoringV2Mode) {
    overlays.add('authoring-v2');
  }
  if (input.isJourneyTrial) {
    overlays.add('journey-trial');
  }
  if (input.isStandaloneFritzMatch) {
    overlays.add('ranked-pvf');
  }
  if (input.isDailyPuzzleRun) {
    overlays.add('daily-puzzle-legacy');
  }
  if (input.enableGuidedMatchCandidateCapture) {
    overlays.add('guided-capture');
  }

  return createMatchCapabilities({
    mode: input.mode,
    overlays,
    dealSize: input.dealSize,
    winningScore: input.winningScore,
    preGameDraw: input.preGameDrawActive,
    postGameReview: true,
    verifiedRanking: input.isStandaloneFritzMatch,
  });
}