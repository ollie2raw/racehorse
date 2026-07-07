import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../types';
import type { RoomPlayer } from './protocol';
import type {
  MultiplayerRoomSyncDomRuntime,
  MultiplayerRoomSyncRuntime,
  MultiplayerRoomSyncUiRuntime,
} from './runtime/gameplayRuntime';

export type AbandonedMatchNotice = {
  context: 'tournament' | 'multiplayer';
  title: string;
  detail: string;
  tournamentId?: string | null;
};

/**
 * Nested imperative surface for room-sync transport handlers.
 * Preserves runtime slice ownership instead of re-flattening into a god-bag.
 */
export type MultiplayerRoomSyncScope = {
  transport: {
    socket: Socket | null;
  };
  room: MultiplayerRoomSyncRuntime['roomRuntime'] & {
    roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  };
  recovery: MultiplayerRoomSyncRuntime['recoveryRuntime'];
  session: MultiplayerRoomSyncRuntime['sessionRefsRuntime'];
  ui: MultiplayerRoomSyncUiRuntime & {
    setState: Dispatch<SetStateAction<GameState | null>>;
    setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
    setAbandonedMatchNotice: Dispatch<SetStateAction<AbandonedMatchNotice | null>> | null;
    authUserId: string | null;
  };
  dom: MultiplayerRoomSyncDomRuntime;
};

export type MultiplayerRoomSyncScopeSource = {
  socket: Socket | null;
  syncRuntime: MultiplayerRoomSyncRuntime;
  syncUi: MultiplayerRoomSyncUiRuntime;
  syncDom: MultiplayerRoomSyncDomRuntime;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  authUserId?: string | null;
  setAbandonedMatchNotice?: Dispatch<SetStateAction<AbandonedMatchNotice | null>>;
};

export function createMultiplayerRoomSyncScope(
  source: MultiplayerRoomSyncScopeSource,
): MultiplayerRoomSyncScope {
  return {
    transport: { socket: source.socket },
    room: {
      ...source.syncRuntime.roomRuntime,
      roomPlayersRef: source.roomPlayersRef,
    },
    recovery: source.syncRuntime.recoveryRuntime,
    session: source.syncRuntime.sessionRefsRuntime,
    ui: {
      ...source.syncUi,
      setState: source.setState,
      setPlayers: source.setPlayers,
      authUserId: source.authUserId ?? null,
      setAbandonedMatchNotice: source.setAbandonedMatchNotice ?? null,
    },
    dom: source.syncDom,
  };
}