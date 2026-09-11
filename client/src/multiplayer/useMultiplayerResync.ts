import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { logger } from '../utils/logger';
import {
  recordResyncCompleted,
  recordResyncFailed,
  recordResyncRequested,
  recordResyncSkipped,
} from './mpTelemetry';
import type { RecoveryEvent } from './recoveryMachine';
import { dispatchSocketEvent } from './socketEventBus';
import { emitRoomJoin } from './roomTransport';
import type { StateUpdatePayload } from './protocol';
import { getOrCreateGuestDisplayName } from '../match/recovery/matchRecovery';
import {
  selectIsSeated,
  selectJoinedRoomCode,
  selectMatchStarted,
} from './session/sessionStateMachine';
import {
  beginRoomOperation,
  isCurrentRoomOperation,
  type RoomOperationEpochRef,
} from './roomOperationEpoch';
import type { MultiplayerRuntime } from './runtime/runtimeTypes';

export type UseMultiplayerResyncParams = {
  /**
   * D5 runtime migration (2026-09-10): socketRef, sessionRef/dispatchSession,
   * roomIdentityRef, rejoinInFlightRef, and applyJoinedRoomResponseRef now
   * come from the composed runtime's slices (runtime.socket / .session /
   * .room / .controller.reconnect / .recovery) instead of five individual
   * App.tsx ref params — same ref objects by identity (see
   * runtimeComposition.ts's create*Runtime functions), proven in
   * useMultiplayerResyncRuntimeSliceIdentity.test.ts.
   *
   * trySchedulePlayerReadyRef and roomOperationEpochRef stay individual
   * params — neither has a runtime slice today. trySchedulePlayerReadyRef
   * lives in MultiplayerSessionRefsRuntime (gameplayRuntime.ts), a type no
   * create*Runtime function actually builds; runtime.gameplay only ever
   * exposes MultiplayerGameplayRefsRuntime's 3 unrelated fields. Both are
   * pre-existing gaps, not introduced here — see
   * D5-runtime-migration-scoping-2026-09-10.md §2's confirmed-gaps list.
   */
  runtime: MultiplayerRuntime;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  roomOperationEpochRef: RoomOperationEpochRef;
  dispatchRecovery: (event: RecoveryEvent) => void;
  normalizeRoomCode: (value: unknown) => string;
  authProfileUsername: string | undefined;
  multiplayerIdentityUserId: string | null;
  multiplayerAuthToken: string | null;
  mpSubView: 'quick' | 'private';
  joinedRoom: string | null;
  hasLiveGameState: boolean;
};

export type UseMultiplayerResyncResult = {
  fetchGameState: (reason: string) => Promise<boolean>;
  fetchGameStateRef: MutableRefObject<(reason: string) => Promise<boolean>>;
  resyncInFlightRef: MutableRefObject<boolean>;
  resyncBufferedUpdateRef: MutableRefObject<StateUpdatePayload | null>;
  resyncFlushRef: MutableRefObject<(() => void) | null>;
};

/** Authoritative owner for client room resync refs and fetchGameState (Phase A extraction from App.tsx). */
export function useMultiplayerResync(params: UseMultiplayerResyncParams): UseMultiplayerResyncResult {
  const fetchGameStateRef = useRef<(reason: string) => Promise<boolean>>(async () => false);
  const resyncInFlightRef = useRef(false);
  const resyncCooldownUntilRef = useRef(0);
  const resyncBufferedUpdateRef = useRef<StateUpdatePayload | null>(null);
  const resyncFlushRef = useRef<(() => void) | null>(null);

  const {
    runtime,
    trySchedulePlayerReadyRef,
    dispatchRecovery,
    normalizeRoomCode,
    authProfileUsername,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    mpSubView,
    joinedRoom,
    hasLiveGameState,
    roomOperationEpochRef,
  } = params;
  const { socketRef } = runtime.socket;
  const { sessionRef, dispatchSession } = runtime.session;
  const { roomIdentityRef } = runtime.room;
  const { rejoinInFlightRef } = runtime.controller.reconnect;
  const { applyJoinedRoomResponseRef } = runtime.recovery;

  /** Fetch full authoritative game state from the server (room:join ack). */
  const fetchGameState = useCallback(
    async (reason: string) => {
      const roomCode = normalizeRoomCode(selectJoinedRoomCode(sessionRef.current));
      if (!roomCode) return false;

      if (reason !== 'recovery_machine') {
        recordResyncRequested(reason, { roomCode });
        dispatchSocketEvent({ type: 'RESYNC_NEEDED', payload: { roomCode } });
        return true;
      }

      const activeSocket = socketRef.current;
      if (!activeSocket?.connected) {
        recordResyncSkipped('socket_not_connected', { reason, roomCode });
        return false;
      }
      if (resyncInFlightRef.current || rejoinInFlightRef.current) {
        recordResyncSkipped('in_flight', { reason, roomCode });
        return false;
      }
      const now = Date.now();
      if (now < resyncCooldownUntilRef.current) {
        recordResyncSkipped('cooldown', { reason, roomCode });
        return false;
      }
      recordResyncRequested(reason, { roomCode });

      resyncInFlightRef.current = true;
      resyncCooldownUntilRef.current = now + 1200;
      const operationToken = beginRoomOperation(roomOperationEpochRef);

      const identity =
        roomIdentityRef.current ?? {
          username: authProfileUsername ?? getOrCreateGuestDisplayName(),
          userId: multiplayerIdentityUserId,
          authToken: multiplayerAuthToken,
        };

      try {
        const resp = await emitRoomJoin(activeSocket, roomCode, identity);
        if (!isCurrentRoomOperation(roomOperationEpochRef, operationToken)) {
          return false;
        }
        if (!resp?.ok) {
          recordResyncFailed(reason, { roomCode, error: resp?.error });
          logger.error('App.tsx', new Error('[mp] fetchGameState failed'), { reason, error: resp?.error });
          return false;
        }
        applyJoinedRoomResponseRef.current(resp);
        recordResyncCompleted(reason, { roomCode });
        return true;
      } catch (error) {
        if (!isCurrentRoomOperation(roomOperationEpochRef, operationToken)) {
          return false;
        }
        recordResyncFailed(reason, {
          roomCode,
          message: error instanceof Error ? error.message : String(error),
        });
        logger.error('App.tsx', error, {
          reason,
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      } finally {
        resyncInFlightRef.current = false;
        resyncFlushRef.current?.();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatchRecovery is stable and unread in this callback
    [
      normalizeRoomCode,
      sessionRef,
      dispatchRecovery,
      socketRef,
      rejoinInFlightRef,
      roomIdentityRef,
      authProfileUsername,
      multiplayerIdentityUserId,
      multiplayerAuthToken,
      applyJoinedRoomResponseRef,
      roomOperationEpochRef,
    ],
  );

  // eslint-disable-next-line react-hooks/refs -- keeps a ref synced to the latest render value for async consumers; moving the write to an effect would defer it past paint
  fetchGameStateRef.current = fetchGameState;

  useEffect(() => {
    if (mpSubView !== 'quick' || !joinedRoom || hasLiveGameState) return;
    const timer = window.setTimeout(() => {
      const session = sessionRef.current;
      if (!selectMatchStarted(session) && selectIsSeated(session)) {
        dispatchSession({ type: 'ROOM_REQUEST_READY' });
        trySchedulePlayerReadyRef.current();
      }
      void fetchGameState('quick_match_stall');
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [
    mpSubView,
    joinedRoom,
    hasLiveGameState,
    fetchGameState,
    sessionRef,
    dispatchSession,
    trySchedulePlayerReadyRef,
  ]);

  return {
    fetchGameState,
    fetchGameStateRef,
    resyncInFlightRef,
    resyncBufferedUpdateRef,
    resyncFlushRef,
  };
}
