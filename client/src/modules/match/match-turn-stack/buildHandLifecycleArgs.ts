import type { HandLifecyclePorts } from '../hand-lifecycle/types.ts';
import type { GuidedV2CoordinationState } from '../../guided/useGuidedV2CoordinationState.ts';
import type { UseHandLifecycleArgs } from '../hand-lifecycle/types.ts';
import type { MatchTurnStackSources } from './types.ts';

export function buildHandLifecycleArgs(
  sources: MatchTurnStackSources,
  guidedV2Coordination: Pick<
    GuidedV2CoordinationState,
    'fritzV2LastAppliedIndexRef' | 'setGuidedV2EventIndex' | 'setIsGuidedV2OffLine' | 'isGuidedV2OffLine'
  >,
  ports: HandLifecyclePorts,
): UseHandLifecycleArgs {
  const { bootstrap, refs, guidedBoot, chrome } = sources;
  const { frozenV2Lesson, frozenLesson } = guidedBoot;
  const { isGuidedMode, isGuidedV2Mode, isAuthoringMode } = guidedBoot;
  const { isGuidedV2OffLine } = guidedV2Coordination;

  return {
    match: bootstrap.match,
    setMatch: bootstrap.setMatch,
    matchRef: bootstrap.matchRef,
    lifecycle: bootstrap.matchRuntime.lifecycle,
    mode: bootstrap.mode,
    isDailyFritzMode: bootstrap.isDailyFritzMode,
    isGuidedMode,
    isGuidedV2Mode,
    isGuidedV2OffLine,
    isAuthoringMode,
    isMuted: chrome.isMuted,
    opponentLabel: bootstrap.opponentLabel,
    dailyFritzPackage: bootstrap.dailyFritzPackage,
    dailyFritzTranscriptProtocolVersion: bootstrap.dailyFritzTranscriptProtocolVersion,
    dailyFritzHandIndex: sources.dailyFritz.dailyFritzHandIndex,
    setDailyFritzHandIndex: sources.dailyFritz.setDailyFritzHandIndex,
    initialDailyFritzHandResult: sources.dailyFritz.persistedHandResult,
    setDailyFritzHandResult: sources.dailyFritz.setPersistedHandResult,
    frozenV2Lesson,
    frozenLesson,
    fritzV2LastAppliedIndexRef: guidedV2Coordination.fritzV2LastAppliedIndexRef,
    setGuidedV2EventIndex: guidedV2Coordination.setGuidedV2EventIndex,
    setIsGuidedV2OffLine: guidedV2Coordination.setIsGuidedV2OffLine,
    lastDailyFlowLabelRef: refs.lastDailyFlowLabelRef,
    getMoveLog: () => sources.replayRecorder.getMoveLog(),
    ports,
  };
}
