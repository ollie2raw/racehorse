export { buildBotMatchStateFromV2Event, parseV2EventHands, resolveNextPlayerAfterV2Event } from './guidedV2State.ts';
export {
  buildCoachPreviewText,
  formatLessonTileLabel,
  getGuidedV1AuthoredStepByIndex,
  getGuidedV1OrderedAuthoredSteps,
  guidedWinnerIdFromScores,
  notifyGuidedV2EventToasts,
  parseGuidedLessonCoachContent,
  parseGuidedTranscriptState,
  sameTileKeyMultiset,
  splitCoachingSummaryBlock,
  syncGuidedBoneyardCount,
} from './guidedBotMatchHelpers.ts';
export { useAuthoringCapture } from './useAuthoringCapture.ts';
export type {
  AuthoringFritzCapturePayload,
  UseAuthoringCaptureParams,
} from './useAuthoringCapture.ts';
export { useGuidedLessonBoot } from './useGuidedLessonBoot.ts';
export type { GuidedInitSource, UseGuidedLessonBootArgs, UseGuidedLessonBootResult } from './useGuidedLessonBoot.ts';
export { useGuidedMatchRuntime } from './useGuidedMatchRuntime.ts';
export type {
  GuidedPlacementResult,
  UseGuidedMatchRuntimeArgs,
  UseGuidedMatchRuntimeBaseResult,
  UseGuidedMatchRuntimeResult,
} from './useGuidedMatchRuntime.ts';
export { useGuidedV2CoordinationState } from './useGuidedV2CoordinationState.ts';
export type { GuidedV2CoordinationState } from './useGuidedV2CoordinationState.ts';
export { useGuidedMatchCommandEffects } from './useGuidedMatchCommandEffects.ts';
export type { UseGuidedMatchCommandEffectsArgs } from './useGuidedMatchCommandEffects.ts';
export { computeGuidedCoachTip, computeGuidedScoringTiles } from './computeGuidedCoachTip.ts';
export {
  buildGuidedCoachPresentation,
  buildGuidedCoachingFlags,
  buildLessonCoachPanelContent,
  buildLessonCoachVm,
  buildLessonRecommendedTileKey,
  computeActivePlacementMoves,
} from './buildGuidedCoachPresentation.ts';
export type {
  BuildGuidedCoachPresentationInput,
  GuidedCoachPresentation,
  GuidedCoachingFlags,
  LessonCoachPanelContent,
} from './guidedCoachPresentationTypes.ts';
export { useGuidedV2PlaybackEffects } from './useGuidedV2PlaybackEffects.ts';
export type { UseGuidedV2PlaybackEffectsArgs } from './useGuidedV2PlaybackEffects.ts';
export { useGuidedV1ReplayEffect } from './useGuidedV1ReplayEffect.ts';
export type { UseGuidedV1ReplayEffectArgs } from './useGuidedV1ReplayEffect.ts';
export { useGuidedWindowDebugApis } from './useGuidedWindowDebugApis.ts';
export type { UseGuidedWindowDebugApisArgs } from './useGuidedWindowDebugApis.ts';
export { useGuidedMatchCaptureRuntime } from './useGuidedMatchCaptureRuntime.ts';
export type { UseGuidedMatchCaptureRuntimeArgs, UseGuidedMatchCaptureRuntimeResult } from './useGuidedMatchCaptureRuntime.ts';
export { useGuidedPlacementHandlers } from './guidedPlacementHandlers.ts';
export type { GuidedPlacementHandlerDeps } from './guidedPlacementHandlers.ts';