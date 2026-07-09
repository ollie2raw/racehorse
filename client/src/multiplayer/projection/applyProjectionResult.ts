import type { MutableRefObject } from 'react';
import { logger } from '../../utils/logger';
import { drawAudit } from '../drawAudit';
import { recordIngressSequenceRegressionDrop } from '../mpTelemetry';
import { isMpDebugEnabled, mpPerfMarkStateApplied } from '../mpPerf';
import type { MultiplayerRoomSyncScope } from '../multiplayerRoomSyncScope';
import { markProcessedTransportEventId } from '../socketEventBus';
import { shouldDropStaleProjectionCommit } from './projectionGates';
import type {
  ForcedDrawStaging,
  SessionRefProjection,
  SpectateProjectionApply,
  StateUpdateProjectionApply,
} from './projectionTypes';

type ForcedDrawDiagSource = 'state:self_forced' | 'state:opponent_forced';

export type ApplyProjectionOptions = {
  commitId: symbol;
  currentCommitRef: MutableRefObject<symbol | null>;
  transportId?: string;
  projectionMs?: number;
  recordForcedDrawStateEvent?: (
    source: ForcedDrawDiagSource,
    sequence: number,
    actorId: string,
    forcedDrawCount: number,
  ) => void;
};

function clearDrawPreview(scope: Pick<MultiplayerRoomSyncScope, 'dom' | 'ui'>) {
  if (scope.dom.drawSequenceTimeoutRef.current) {
    clearTimeout(scope.dom.drawSequenceTimeoutRef.current);
    scope.dom.drawSequenceTimeoutRef.current = null;
  }
  // TEMP-DIAGNOSTIC
  console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set false', {
    path: 'clearDrawPreview',
    at: Date.now(),
  });
  scope.ui.setDrawSequenceActiveBoth(false);
  scope.ui.setDrawStepMyHand(null);
  scope.ui.setDrawStepActorId(null);
  scope.ui.setDrawStepOpponentHandCount(null);
  // TEMP-DIAGNOSTIC
  console.log('[TEMP-DIAGNOSTIC] flyingTiles cleared', {
    path: 'clearDrawPreview',
    at: Date.now(),
  });
  scope.ui.setFlyingTiles([]);
}

export function applyProjectionSessionRefs(
  scope: MultiplayerRoomSyncScope,
  sessionRefs: SessionRefProjection,
): void {
  scope.room.maxSequenceRef.current = sessionRefs.maxSequenceWatermark;
  if (sessionRefs.youId) {
    scope.dom.youRef.current = sessionRefs.youId;
  }
}

function applyForcedDrawStaging(
  scope: MultiplayerRoomSyncScope,
  staging: ForcedDrawStaging,
  recordForcedDrawStateEvent?: ApplyProjectionOptions['recordForcedDrawStateEvent'],
): void {
  if (staging.kind === 'self') {
    if (scope.dom.drawSequenceTimeoutRef.current) {
      clearTimeout(scope.dom.drawSequenceTimeoutRef.current);
      scope.dom.drawSequenceTimeoutRef.current = null;
    }
    recordForcedDrawStateEvent?.(
      'state:self_forced',
      staging.sequence,
      staging.youId,
      staging.drawnCount,
    );
    scope.ui.setDrawSequenceActiveBoth(true);
    scope.dom.pendingForcedHandRevealRef.current = staging.pendingReveal;
    scope.ui.setDrawStepMyHand(staging.stagedHand);
    scope.ui.setDrawStepActorId(staging.youId);
    scope.ui.setDrawStepOpponentHandCount(null);
    scope.ui.setBoneyardDisplayCount(staging.preDrawBoneyard);
    return;
  }

  if (staging.kind === 'opponent') {
    scope.dom.pendingForcedHandRevealRef.current = null;
    scope.ui.setDrawStepMyHand(null);
    recordForcedDrawStateEvent?.(
      'state:opponent_forced',
      staging.sequence,
      staging.opponentId,
      staging.drawnCount,
    );
    scope.ui.setDrawSequenceActiveBoth(true);
    scope.ui.setDrawStepActorId(staging.opponentId);
    scope.ui.setDrawStepOpponentHandCount(staging.stagedOpponentHandCount);
    scope.ui.setBoneyardDisplayCount(staging.boneyardDisplay);
    return;
  }

  clearDrawPreview(scope);
  scope.ui.setBoneyardDisplayCount(staging.rawBoneyardLength);
  scope.ui.setDrawSequenceActiveBoth(false);
}

function applyRecoveryIdleHint(scope: MultiplayerRoomSyncScope, show: boolean): void {
  if (!show) return;
  scope.ui.setRoomRecoveryState('idle');
  scope.ui.setRoomRecoveryMessage('');
}

export function applyStateUpdateProjection(
  scope: MultiplayerRoomSyncScope,
  result: StateUpdateProjectionApply,
  options: ApplyProjectionOptions,
): void {
  if (result.resyncAfterApply === 'hand_identity_mismatch') {
    void scope.recovery.fetchGameState('hand_identity_mismatch');
  }

  scope.ui.setState(result.nextState);
  scope.ui.setOpponentDragging?.(false);
  if (result.clearWaitingForReadyError) {
    scope.ui.setError((current) => (current === 'waiting_for_ready' ? '' : current));
  }

  applyRecoveryIdleHint(scope, result.showRecoveryIdleHint);

  scope.ui.setLegalMoves(result.legalMoves);
  scope.ui.setCanDraw(result.canDraw);
  scope.ui.setPreGameDraw(result.preGameDraw);

  if (result.autoPassPlayerIds.length > 0) {
    drawAudit('auto-pass', {
      roomCode: scope.session.sessionRef.current.context.roomCode ?? '',
      playerId: result.autoPassPlayerIds.join(','),
      boneyardCount: result.nextState?.boneyard?.length ?? 0,
      reason: 'blocked_locked_boneyard',
    });
    scope.ui.showToast('No moves available — passing…', 1500);
  }
  if (scope.ui.setRecentAutoPasses) {
    scope.ui.setRecentAutoPasses(result.autoPassPlayerIds);
  }

  applyForcedDrawStaging(scope, result.forcedDrawStaging, options.recordForcedDrawStateEvent);

  drawAudit('room-update', {
    requestId: result.nextState?.sequence,
    handCount: result.nextState?.players[scope.dom.youRef.current]?.hand?.length ?? 0,
    boneyardCount: result.nextState?.boneyard?.length ?? 0,
    currentTurn: result.nextState?.playerIds[result.nextState?.currentPlayerIndex ?? -1],
    forcedDraw:
      result.forcedDrawStaging.kind === 'self' || result.forcedDrawStaging.kind === 'opponent'
        ? result.forcedDrawStaging.drawnCount
        : 0,
  });

  if (result.clearOpponentDisconnect) {
    scope.ui.setOpponentDisconnected(false);
    scope.ui.setOpponentDisconnectMessage('');
  }

  if (result.nextState && isMpDebugEnabled()) {
    mpPerfMarkStateApplied(result.nextState.sequence, options.projectionMs);
  }
  scope.ui.onAuthoritativeGameplayStateApplied?.(result.nextState);

  if (
    !shouldDropStaleProjectionCommit(options.currentCommitRef.current, options.commitId) &&
    options.transportId
  ) {
    markProcessedTransportEventId(options.transportId);
  }
}

export function applySpectateProjection(
  scope: MultiplayerRoomSyncScope,
  result: SpectateProjectionApply,
): void {
  scope.ui.setState(result.nextState);
  applyRecoveryIdleHint(scope, result.showRecoveryIdleHint);
  scope.ui.setLegalMoves([]);
  scope.ui.setCanDraw(false);
  applyForcedDrawStaging(scope, result.forcedDrawStaging);
}

export function logSequenceRegressionDrop(
  incoming: number | undefined,
  watermark: number,
): void {
  recordIngressSequenceRegressionDrop(incoming, watermark);
  logger.error('useRoomSocketSync.ts', new Error('[mp-state] sequence regression — full resync'), {
    incoming,
    watermark,
  });
}