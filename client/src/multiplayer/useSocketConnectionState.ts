import { useState, useEffect, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { AppMode } from '../appRouteTypes';
import type { RoomRecoveryState } from './protocol';
import { resolveGameServerUrl } from '../lib/gameServerUrl';
import { attachSocketEventBus } from './socketEventBus';
import { useMultiplayerConnectionActionsBridge } from './useMultiplayerConnectionContext';
import { shouldAutoConnectForMode } from './connectPolicy';

export type UseSocketConnectionStateParams = {
  appMode: AppMode;
  hasAuthUser: boolean;
  showToast: (msg: string, duration?: number) => void;
};

export type UseSocketConnectionStateResult = {
  serverUrl: string;
  socket: Socket | null;
  setSocket: React.Dispatch<React.SetStateAction<Socket | null>>;
  isConnected: boolean;
  setIsConnected: React.Dispatch<React.SetStateAction<boolean>>;
  isConnecting: boolean;
  setIsConnecting: React.Dispatch<React.SetStateAction<boolean>>;
  isRecoveringConnection: boolean;
  setIsRecoveringConnection: React.Dispatch<React.SetStateAction<boolean>>;
  roomRecoveryState: RoomRecoveryState;
  setRoomRecoveryState: React.Dispatch<React.SetStateAction<RoomRecoveryState>>;
  roomRecoveryMessage: string;
  setRoomRecoveryMessage: React.Dispatch<React.SetStateAction<string>>;
  serverWaking: boolean;
  setServerWaking: React.Dispatch<React.SetStateAction<boolean>>;
  socketRef: React.MutableRefObject<Socket | null>;
  connectRef: React.MutableRefObject<() => void>;
  connectionActions: ReturnType<typeof useMultiplayerConnectionActionsBridge>;
  reconnectAttemptTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  reconnectAttemptCountRef: React.MutableRefObject<number>;
  clearReconnectAttemptTimer: () => void;
};

export function useSocketConnectionState(
  params: UseSocketConnectionStateParams,
): UseSocketConnectionStateResult {
  const { appMode, hasAuthUser, showToast } = params;

  const [serverUrl] = useState(() => resolveGameServerUrl());
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRecoveringConnection, setIsRecoveringConnection] = useState(false);
  const [roomRecoveryState, setRoomRecoveryState] = useState<RoomRecoveryState>('idle');
  const [roomRecoveryMessage, setRoomRecoveryMessage] = useState('');
  const [serverWaking, setServerWaking] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const connectRef = useRef<() => void>(() => {});
  const connectionActions = useMultiplayerConnectionActionsBridge(connectRef);
  const reconnectAttemptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptCountRef = useRef(0);

  const prevConnectedRef = useRef(false);
  const prevRecoveryStateRef = useRef<RoomRecoveryState>('idle');

  // Keep socketRef in sync with socket state
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // Wire socket event bus when socket changes
  useEffect(() => {
    if (!socket) return;
    return attachSocketEventBus(socket);
  }, [socket]);

  // Feed lazy-connect policy
  useEffect(() => {
    if (
      !shouldAutoConnectForMode({
        appMode,
        hasAuthUser,
        isSocketConnected: Boolean(socket?.connected),
      })
    ) {
      return;
    }
    connectRef.current();
  }, [appMode, hasAuthUser, socket?.connected]);

  // Connection toasts
  useEffect(() => {
    if (appMode === 'multiplayer') {
      const prev = prevConnectedRef.current;
      if (prev !== isConnected) {
        prevConnectedRef.current = isConnected;
        if (isConnected) {
          showToast('Connected to server.', 1200);
        } else if (!isRecoveringConnection && roomRecoveryState === 'idle') {
          showToast('Disconnected from server.', 1500);
        }
      }
    } else {
      prevConnectedRef.current = isConnected;
    }
  }, [isConnected, appMode, isRecoveringConnection, roomRecoveryState, showToast]);

  // Recovery toasts
  useEffect(() => {
    const prev = prevRecoveryStateRef.current;
    if (prev !== roomRecoveryState) {
      prevRecoveryStateRef.current = roomRecoveryState;
      if (prev === 'idle' && (roomRecoveryState === 'reconnecting' || roomRecoveryState === 'resyncing')) {
        showToast('Connection lost. Reconnecting...', 2000);
      } else if ((prev === 'reconnecting' || prev === 'resyncing') && roomRecoveryState === 'idle') {
        showToast('Connection restored. Match recovered.', 2000);
      } else if (roomRecoveryState === 'failed') {
        showToast('Reconnection failed.', 3000);
      }
    }
  }, [roomRecoveryState, showToast]);

  const clearReconnectAttemptTimer = useCallback(() => {
    if (reconnectAttemptTimerRef.current) {
      clearTimeout(reconnectAttemptTimerRef.current);
      reconnectAttemptTimerRef.current = null;
    }
  }, []);

  return {
    serverUrl,
    socket,
    setSocket,
    isConnected,
    setIsConnected,
    isConnecting,
    setIsConnecting,
    isRecoveringConnection,
    setIsRecoveringConnection,
    roomRecoveryState,
    setRoomRecoveryState,
    roomRecoveryMessage,
    setRoomRecoveryMessage,
    serverWaking,
    setServerWaking,
    socketRef,
    connectRef,
    connectionActions,
    reconnectAttemptTimerRef,
    reconnectAttemptCountRef,
    clearReconnectAttemptTimer,
  };
}
