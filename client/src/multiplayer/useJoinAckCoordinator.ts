import { useCallback, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { flushSync } from 'react-dom';
import type { GameState } from '../types';
import type { RecoveryEvent } from './recoveryMachine';
import type { RoomEventMeta, RoomPlayer } from './protocol';
import type { RoomAckResponse } from './roomTransport';
import {
  processJoinAck,
  type JoinAckSnapshotResult,
} from './joinAckCoordinator';
import type { SessionEvent, SessionSnapshot } from './session/sessionTypes';

export type UseJoinAckCoordinatorParams = {
  dispatchRecovery: (event: RecoveryEvent) => void;
  normalizeRoomCode: (value: unknown) => string;
  applySnapshot: (resp: RoomAckResponse) => JoinAckSnapshotResult;
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  setJoinedRoom: (roomCode: string | null) => void;
  setRoomCode: (code: string) => void;
  setYou: (you: string) => void;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  sessionRef: MutableRefObject<SessionSnapshot>;
  dispatchSession: (event: SessionEvent) => void;
  joinedRoomResponseRef: MutableRefObject<RoomAckResponse | null>;
  youRef: MutableRefObject<string>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  roomIdentityRef: MutableRefObject<{
    username: string;
    userId: string | null;
    authToken: string | null;
  } | null>;
  authProfileUsername: string | undefined;
  multiplayerIdentityUserId: string | null;
  multiplayerAuthToken: string | null;
  onTerminalJoinHandled?: (
    resp: RoomAckResponse,
    nextState: GameState | null,
  ) => 'terminal_handled' | void;
  trySchedulePlayerReady?: () => void;
};

export type UseJoinAckCoordinatorResult = {
  handleJoinAck: (resp: RoomAckResponse) => void;
};

/** React hook wrapper — App.tsx wires dependencies; join ack logic lives in joinAckCoordinator.ts. */
export function useJoinAckCoordinator(
  params: UseJoinAckCoordinatorParams,
): UseJoinAckCoordinatorResult {
  const {
    dispatchRecovery,
    normalizeRoomCode,
    applySnapshot,
    applyRoomEventMeta,
    setJoinedRoom,
    setRoomCode,
    setYou,
    setPlayers,
    normalizeRoomPlayers,
    sessionRef,
    dispatchSession,
    joinedRoomResponseRef,
    youRef,
    roomPlayersRef,
    roomIdentityRef,
    authProfileUsername,
    multiplayerIdentityUserId,
    multiplayerAuthToken,
    onTerminalJoinHandled,
    trySchedulePlayerReady,
  } = params;

  const processingJoinAckRef = useRef(false);

  const handleJoinAck = useCallback(
    (resp: RoomAckResponse) => {
      if (processingJoinAckRef.current) {
        return;
      }
      processingJoinAckRef.current = true;
      try {
        processJoinAck({
        resp,
        normalizeRoomCode,
        dispatchRecovery,
        applySnapshot,
        applyRoomEventMeta,
        setJoinedRoom,
        setRoomCode,
        setYou,
        setPlayers,
        normalizeRoomPlayers,
        sessionRef,
        dispatchSession,
        joinedRoomResponseRef,
        youRef,
        roomPlayersRef,
        roomIdentityRef,
        roomIdentity: {
          username: authProfileUsername ?? 'Guest',
          userId: multiplayerIdentityUserId,
          authToken: multiplayerAuthToken,
        },
        onTerminalJoinHandled,
        trySchedulePlayerReady,
        flushJoinedRoom: (apply) => {
          flushSync(apply);
        },
      });
      } finally {
        processingJoinAckRef.current = false;
      }
    },
    [
      dispatchRecovery,
      normalizeRoomCode,
      applySnapshot,
      applyRoomEventMeta,
      setJoinedRoom,
      setRoomCode,
      setYou,
      setPlayers,
      normalizeRoomPlayers,
      sessionRef,
      dispatchSession,
      joinedRoomResponseRef,
      youRef,
      roomPlayersRef,
      roomIdentityRef,
      authProfileUsername,
      multiplayerIdentityUserId,
      multiplayerAuthToken,
      onTerminalJoinHandled,
      trySchedulePlayerReady,
    ],
  );

  return { handleJoinAck };
}