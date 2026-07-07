import { projectMultiplayerGameState } from '../boardSnapshotGuards';
import { evaluateSequenceWatermark } from '../socketGuards';
import type { SpectateProjectionContext, SpectateProjectionOutcome } from './projectionTypes';

/** Pure state:spectate projection — no React, refs, sockets, or side effects. */
export function projectStateSpectate(
  context: SpectateProjectionContext,
): SpectateProjectionOutcome {
  const { payload, maxSequenceWatermark, youId, joinedRoom } = context;

  const rawState = payload?.state ?? null;
  if (rawState?.playerIds?.includes(youId)) {
    return { kind: 'drop', reason: 'spectator_in_roster' };
  }

  let nextState = rawState;
  if (nextState !== null) {
    const projected = projectMultiplayerGameState(nextState);
    if (!projected) {
      return {
        kind: 'drop',
        reason: 'invalid_spectator_snapshot',
        fetchReason: 'invalid_spectator_snapshot',
      };
    }
    nextState = projected;
  }

  let updatedWatermark = maxSequenceWatermark;
  if (nextState) {
    const decision = evaluateSequenceWatermark(maxSequenceWatermark, nextState.sequence);
    if (decision.action === 'reject_regression') {
      return {
        kind: 'drop',
        reason: 'sequence_regression',
        fetchReason: 'sequence_regression',
      };
    }
    if (decision.action === 'reject_stale') {
      return {
        kind: 'drop',
        reason: 'sequence_stale',
        fetchReason: 'stale_state_update',
      };
    }
    if (typeof nextState.sequence === 'number' && Number.isFinite(nextState.sequence)) {
      updatedWatermark = decision.sequence;
    }
  }

  return {
    kind: 'apply',
    result: {
      nextState,
      sessionRefs: {
        isSeatedPlayerClear: true,
        maxSequenceWatermark: updatedWatermark,
      },
      showRecoveryIdleHint: Boolean(joinedRoom),
      forcedDrawStaging: {
        kind: 'clear',
        rawBoneyardLength: payload?.state?.boneyard?.length ?? null,
      },
    },
  };
}