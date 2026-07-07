import type { GameState } from '../../types';
import { projectMultiplayerGameState } from '../boardSnapshotGuards';
import { hasHandIdentityMismatch } from '../handIdentity';
import { evaluateSequenceWatermark } from '../socketGuards';
import { shouldDropPreProjectionStateReplay } from './projectionGates';
import type {
  ForcedDrawStaging,
  SessionRefProjection,
  StateUpdateProjectionContext,
  StateUpdateProjectionOutcome,
} from './projectionTypes';

function isActiveGameplayState(state: GameState | null): boolean {
  return Boolean(
    state &&
      Array.isArray(state.playerIds) &&
      state.playerIds.length >= 2 &&
      typeof state.sequence === 'number' &&
      Number.isFinite(state.sequence),
  );
}

function deriveForcedDrawStaging(
  payload: StateUpdateProjectionContext['payload'],
  nextState: GameState | null,
  youId: string,
): ForcedDrawStaging {
  const selfForcedRevealPending =
    typeof payload.forcedDrawCount === 'number' &&
    payload.forcedDrawCount > 0 &&
    payload.forcedDrawActorId === youId &&
    !!nextState;

  if (selfForcedRevealPending && nextState) {
    const fullHand = nextState.players[youId]?.hand ?? [];
    const drawnCount = payload.forcedDrawCount ?? 0;
    const stagedHand = fullHand.slice(0, Math.max(0, fullHand.length - drawnCount));
    const preDrawBoneyard = (nextState.boneyard?.length ?? 0) + drawnCount;
    return {
      kind: 'self',
      youId,
      drawnCount,
      sequence: nextState.sequence,
      stagedHand,
      pendingReveal: {
        sequence: nextState.sequence,
        fullHand: fullHand.map((tile) => ({ low: tile.low, high: tile.high })),
      },
      preDrawBoneyard,
    };
  }

  const opponentForcedRevealPending =
    typeof payload.forcedDrawCount === 'number' &&
    payload.forcedDrawCount > 0 &&
    typeof payload.forcedDrawActorId === 'string' &&
    payload.forcedDrawActorId !== youId &&
    !!nextState;

  if (opponentForcedRevealPending && nextState) {
    const drawnCount = payload.forcedDrawCount ?? 0;
    const opponentId = payload.forcedDrawActorId!;
    const finalCount =
      nextState.handCounts?.[opponentId] ??
      nextState.players[opponentId]?.hand?.length ??
      0;
    return {
      kind: 'opponent',
      opponentId,
      drawnCount,
      sequence: nextState.sequence,
      stagedOpponentHandCount: Math.max(0, finalCount - drawnCount),
      boneyardDisplay: (nextState.boneyard?.length ?? 0) + drawnCount,
    };
  }

  return {
    kind: 'clear',
    rawBoneyardLength: payload?.state?.boneyard?.length ?? null,
  };
}

/** Pure authoritative state:update projection — no React, refs, sockets, or side effects. */
export function projectStateUpdate(
  context: StateUpdateProjectionContext,
): StateUpdateProjectionOutcome {
  const {
    payload,
    maxSequenceWatermark,
    maxSequenceWatermarkBeforeMeta,
    youId,
    joinedRoom,
  } = context;

  const rawState = payload?.state ?? null;
  if (shouldDropPreProjectionStateReplay(maxSequenceWatermark, rawState?.sequence)) {
    return { kind: 'drop', reason: 'pre_projection_replay' };
  }

  let nextState = rawState;
  if (nextState !== null) {
    const projected = projectMultiplayerGameState(nextState);
    if (!projected) {
      return {
        kind: 'drop',
        reason: 'invalid_state_projection',
        fetchReason: 'invalid_state_projection',
      };
    }
    nextState = projected;
  }

  const eventMetaResetSequenceWatermark =
    maxSequenceWatermarkBeforeMeta !== maxSequenceWatermark && maxSequenceWatermark === -1;

  if (
    eventMetaResetSequenceWatermark &&
    nextState !== null &&
    (typeof nextState.sequence !== 'number' || !Number.isFinite(nextState.sequence))
  ) {
    return {
      kind: 'drop',
      reason: 'fresh_match_requires_sequence',
      fetchReason: 'fresh_match_requires_sequence',
    };
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

  let updatedYouId = youId;
  if (
    typeof payload.you === 'string' &&
    payload.you &&
    (!nextState?.playerIds || nextState.playerIds.includes(payload.you))
  ) {
    updatedYouId = payload.you;
  }

  const sessionRefs: SessionRefProjection = {
    maxSequenceWatermark: updatedWatermark,
  };

  if (nextState?.playerIds && !nextState.playerIds.includes(youId)) {
    sessionRefs.isSeatedPlayerClear = true;
  }

  let resyncAfterApply: 'hand_identity_mismatch' | undefined;
  if (hasHandIdentityMismatch(nextState, youId)) {
    resyncAfterApply = 'hand_identity_mismatch';
  }

  if (typeof payload.matchStarted === 'boolean') {
    sessionRefs.matchStarted = payload.matchStarted;
    if (payload.matchStarted && nextState?.playerIds?.includes(updatedYouId)) {
      sessionRefs.playerReadyEmitted = true;
    }
  }

  if (updatedYouId !== youId) {
    sessionRefs.youId = updatedYouId;
  }

  const forcedDrawStaging = deriveForcedDrawStaging(payload, nextState, updatedYouId);

  return {
    kind: 'apply',
    result: {
      nextState,
      sessionRefs,
      legalMoves: Array.isArray(payload?.legalMoves) ? payload.legalMoves : [],
      canDraw: Boolean(payload?.canDraw),
      preGameDraw: payload.preGameDraw ?? null,
      forcedDrawStaging,
      showRecoveryIdleHint: Boolean(joinedRoom),
      clearOpponentDisconnect: true,
      clearWaitingForReadyError: isActiveGameplayState(nextState),
      resyncAfterApply,
      autoPassPlayerIds: Array.isArray(payload.recentAutoPasses)
        ? payload.recentAutoPasses
        : [],
    },
  };
}