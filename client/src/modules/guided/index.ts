// Public surface of modules/guided — the 8 symbols consumed from outside this
// module (verified: bot/ and modules/match/ only). Everything else lives on its
// own file and is imported by path; internal guided files never route through
// this barrel. Trimmed from 53 exports under CQ9.2 F3 / D-CQ-6 (2026-09-08);
// full Step-1/Step-2 map in CODE_QUALITY_PLAN.md §CQ9.1.7 / §CQ9.2.F3.
export { useAuthoringCapture } from './useAuthoringCapture.ts';
export { useGuidedLessonBoot } from './useGuidedLessonBoot.ts';
export type { UseGuidedLessonBootResult } from './useGuidedLessonBoot.ts';
export { useGuidedMatchRuntime } from './useGuidedMatchRuntime.ts';
export { useGuidedMatchCommandEffects } from './useGuidedMatchCommandEffects.ts';
export { useGuidedMatchCaptureRuntime } from './useGuidedMatchCaptureRuntime.ts';
export { useGuidedV2CoordinationState } from './useGuidedV2CoordinationState.ts';
export type { GuidedPlacementResult } from './guidedPlacementHandlers.ts';
