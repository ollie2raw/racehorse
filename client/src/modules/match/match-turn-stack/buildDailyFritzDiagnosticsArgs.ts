import type { UseDailyFritzDiagnosticsArgs } from '../../daily/useDailyFritzDiagnostics.ts';
import type { UseHandLifecycleResult } from '../hand-lifecycle/types.ts';
import type { MatchTurnStackSources } from './types.ts';

export function buildDailyFritzDiagnosticsArgs(
  sources: MatchTurnStackSources,
  handLifecycle: Pick<UseHandLifecycleResult, 'getDebugSnapshot'>,
): UseDailyFritzDiagnosticsArgs {
  const { bootstrap, refs, guidedBoot, dailyFritz } = sources;
  const {
    dailyFritzScriptedDrawReady,
    preGameDrawEligibilityInput,
    initialPersistedDailyFritzMatch,
    preGameDrawEligibleBase,
    preGameDrawEligible,
    preGameDrawCompleted,
    preGameDrawActive,
    matchInstanceKey,
    match,
    mode,
    dealSize,
    isDailyFritzMode,
    dailyFritzPackage,
  } = bootstrap;

  return {
    isDailyFritzMode,
    matchInstanceKey: matchInstanceKey ?? null,
    dailyFritzPackage,
    dailyFritzScriptedDrawReady,
    match,
    mode,
    dealSize,
    isGuidedMode: guidedBoot.isGuidedMode,
    isAuthoringMode: guidedBoot.isAuthoringMode,
    preGameDrawEligibilityInput,
    initialPersistedDailyFritzMatch,
    preGameDrawEligibleBase,
    preGameDrawEligible,
    preGameDrawCompleted,
    preGameDrawActive,
    scriptedPlayerTileId: dailyFritz.scriptedPlayerTileId,
    scriptedFritzTileId: dailyFritz.scriptedFritzTileId,
    lastDailyFlowLabelRef: refs.lastDailyFlowLabelRef,
    getDebugSnapshot: handLifecycle.getDebugSnapshot,
  };
}