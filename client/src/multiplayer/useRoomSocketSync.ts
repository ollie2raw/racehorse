import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, Tile } from '../types';

type RoomPlayer = { id: string; username: string; userId: string | null };
type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};
type RoomRecoveryState = 'idle' | 'reconnecting' | 'resyncing' | 'failed';

type HandTileTarget = HTMLDivElement | HTMLButtonElement | null;

type UseRoomSocketSyncParams = {
  socket: Socket | null;
  showToast: (message: string, duration?: number) => void;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  setFriendInvite: Dispatch<
    SetStateAction<{
      fromUsername: string;
      roomCode: string;
      inviteUrl: string;
    } | null>
  >;
  joinedRoomRef: MutableRefObject<string | null>;
  maxSequenceRef: MutableRefObject<number>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setOptimisticPlayedTile: Dispatch<SetStateAction<Tile | null>>;
  setLegalMoves: Dispatch<SetStateAction<Move[]>>;
  setCanDraw: Dispatch<SetStateAction<boolean>>;
  drawSequenceActiveRef: MutableRefObject<boolean>;
  drawSequenceTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setDrawSequenceActiveBoth: (value: boolean) => void;
  setDrawStepMyHand: Dispatch<SetStateAction<Tile[] | null>>;
  setDrawStepActorId: Dispatch<SetStateAction<string | null>>;
  setDrawStepOpponentHandCount: Dispatch<SetStateAction<number | null>>;
  setFlyingTiles: Dispatch<
    SetStateAction<{ x: number; y: number; toX: number; toY: number; id: number }[]>
  >;
  setBoneyardDisplayCount: Dispatch<SetStateAction<number | null>>;
  setDrawPulseIndex: Dispatch<SetStateAction<number | null>>;
  boneyardRef: RefObject<HTMLDivElement | null>;
  handAreaRef: RefObject<HTMLDivElement | null>;
  opponentPillRef: RefObject<HTMLButtonElement | null>;
  youRef: MutableRefObject<string>;
  stateRef: MutableRefObject<GameState | null>;
  flyingTileIdRef: MutableRefObject<number>;
  isMutedRef: MutableRefObject<boolean>;
  playDrawSound: (muted: boolean) => void;
  tileEquals: (a: Tile, b: Tile) => boolean;
};

function clearDrawPreview(params: Pick<
  UseRoomSocketSyncParams,
  | 'drawSequenceTimeoutRef'
  | 'setDrawSequenceActiveBoth'
  | 'setDrawStepMyHand'
  | 'setDrawStepActorId'
  | 'setDrawStepOpponentHandCount'
  | 'setFlyingTiles'
>) {
  if (params.drawSequenceTimeoutRef.current) {
    clearTimeout(params.drawSequenceTimeoutRef.current);
    params.drawSequenceTimeoutRef.current = null;
  }
  params.setDrawSequenceActiveBoth(false);
  params.setDrawStepMyHand(null);
  params.setDrawStepActorId(null);
  params.setDrawStepOpponentHandCount(null);
  params.setFlyingTiles([]);
}

export function useRoomSocketSync(params: UseRoomSocketSyncParams) {
  useEffect(() => {
    const { socket } = params;
    if (!socket) return;
    const isMpDebug =
      typeof window !== 'undefined' && window.localStorage.getItem('mp_debug') === '1';

    const onFriendInvited = (payload: {
      fromUsername: string;
      roomCode: string;
      inviteUrl: string;
    }) => {
      console.log('[invite] received friend:invited', payload);
      params.setFriendInvite(payload);
    };

    const onFriendInviteError = (payload: { ok?: boolean; error?: string }) => {
      console.log('[invite] received friend:invite:error', payload);
      params.showToast('Invite failed: room not found', 2000);
    };

    const onRoomUpdate = (payload: { players?: unknown }) => {
      const nextPlayers = params.normalizeRoomPlayers(payload?.players);
      if (import.meta.env.DEV) {
        console.log('[room:update]', {
          joinedRoom: params.joinedRoomRef.current,
          players: nextPlayers.length,
        });
      }
      params.setPlayers(nextPlayers);
    };

    const onStateUpdate = (payload: {
      state?: GameState | null;
      legalMoves?: Move[];
      canDraw?: boolean;
      eventMeta?: RoomEventMeta;
    }) => {
      params.applyRoomEventMeta(payload?.eventMeta);
      const nextState = payload?.state ?? null;
      if (nextState) {
        if (
          typeof nextState.sequence === 'number' &&
          nextState.sequence < params.maxSequenceRef.current
        ) {
          if (import.meta.env.DEV || isMpDebug) {
            console.warn('[mp-state-apply] rejected stale state:update', {
              incoming: nextState.sequence,
              highWatermark: params.maxSequenceRef.current,
              drawActive: Boolean(nextState.__drawSequenceActive),
            });
          }
          return;
        }
        params.maxSequenceRef.current = nextState.sequence ?? -1;
      }

      if (import.meta.env.DEV || isMpDebug) {
        console.log('[mp-state-apply] state:update', {
          joinedRoom: params.joinedRoomRef.current,
          hasState: Boolean(payload?.state),
          sequence: nextState?.sequence,
          drawActive: Boolean(nextState?.__drawSequenceActive),
          boneyardCount: nextState?.boneyard?.length ?? null,
          myHandLength: nextState?.players?.[params.youRef.current]?.hand?.length ?? null,
        });
      }

      if (import.meta.env.DEV) {
        console.warn('[multiplayer-debug] incoming state hand lookup', {
          youRef: params.youRef.current,
          playerKeys: nextState?.players ? Object.keys(nextState.players) : null,
          playerIds: nextState?.playerIds,
          lookupHandLength: nextState?.players?.[params.youRef.current]?.hand?.length ?? null,
          playersShape: nextState?.players,
        });
      }

      params.setState(nextState);
      if (params.joinedRoomRef.current) {
        params.setRoomRecoveryState('idle');
        params.setRoomRecoveryMessage('');
      }

      if (import.meta.env.DEV) {
        const hand = nextState?.players?.[params.youRef.current]?.hand;
        if (!hand || hand.length === 0) {
          console.warn('[multiplayer-debug] Server sent empty hand or player not found', {
            statePlayerIds: nextState?.playerIds,
            youRef: params.youRef.current,
            socketId: socket.id,
            players: nextState ? Object.keys(nextState.players) : null
          });
        }
      }

      params.setOptimisticPlayedTile((prev) => {
        if (!prev) return null;
        const nextHand = nextState?.players?.[params.youRef.current]?.hand ?? [];
        return nextHand.some((tile) => params.tileEquals(tile, prev)) ? prev : null;
      });
      params.setLegalMoves(Array.isArray(payload?.legalMoves) ? payload.legalMoves : []);
      params.setCanDraw(Boolean(payload?.canDraw));
      if (nextState?.__drawSequenceActive) {
        if (isMpDebug) {
          console.log('[mp-draw-client] authoritative draw active=true', {
            sequence: nextState.sequence,
          });
        }
        params.setDrawSequenceActiveBoth(true);
      } else {
        if (isMpDebug && params.drawSequenceActiveRef.current) {
          console.log('[mp-draw-client] authoritative draw active=false', {
            sequence: nextState?.sequence ?? null,
          });
        }
        clearDrawPreview(params);
      }
      params.setBoneyardDisplayCount(payload?.state?.boneyard?.length ?? null);
    };

    const onStateSpectate = (payload: { state?: GameState | null; eventMeta?: RoomEventMeta }) => {
      params.applyRoomEventMeta(payload?.eventMeta);
      const nextState = payload?.state ?? null;
      if (nextState?.playerIds?.includes(params.youRef.current)) {
        if (import.meta.env.DEV) {
          console.warn('[state:spectate] ignored spectator snapshot for seated player', {
            youRef: params.youRef.current,
            sequence: nextState.sequence,
          });
        }
        return;
      }
      if (nextState) {
        if (
          typeof nextState.sequence === 'number' &&
          nextState.sequence < params.maxSequenceRef.current
        ) {
          if (import.meta.env.DEV || isMpDebug) {
            console.warn('[mp-state-apply] rejected stale state:spectate', {
              incoming: nextState.sequence,
              highWatermark: params.maxSequenceRef.current,
            });
          }
          return;
        }
        params.maxSequenceRef.current = nextState.sequence ?? -1;
      }

      params.setState(nextState);
      if (params.joinedRoomRef.current) {
        params.setRoomRecoveryState('idle');
        params.setRoomRecoveryMessage('');
      }
      params.setOptimisticPlayedTile(null);
      params.setLegalMoves([]);
      params.setCanDraw(false);
      if (!nextState?.__drawSequenceActive) {
        clearDrawPreview(params);
      } else {
        params.setDrawSequenceActiveBoth(true);
      }
      params.setBoneyardDisplayCount(payload?.state?.boneyard?.length ?? null);
    };

    const onDrawStep = (payload: {
      playerId: string;
      tile: Tile | null;
      boneyardCount: number;
      drawerHandCount: number;
    }) => {
      if (!payload) return;
      if (isMpDebug) {
        console.log('[mp-draw-client] draw_step', {
          playerId: payload.playerId,
          hasTile: Boolean(payload.tile),
          boneyardCount: payload.boneyardCount,
          drawerHandCount: payload.drawerHandCount,
        });
      }
      params.playDrawSound(params.isMutedRef.current);
      params.setDrawSequenceActiveBoth(true);
      params.setDrawStepActorId(payload.playerId);
      if (params.drawSequenceTimeoutRef.current) {
        clearTimeout(params.drawSequenceTimeoutRef.current);
      }
      params.drawSequenceTimeoutRef.current = setTimeout(() => {
        params.setDrawSequenceActiveBoth(false);
      }, 5000);
      params.setBoneyardDisplayCount(payload.boneyardCount);

      if (params.boneyardRef.current) {
        const from = params.boneyardRef.current.getBoundingClientRect();
        const isMe = payload.playerId === params.youRef.current;
        const targetEl: HandTileTarget = isMe ? params.handAreaRef.current : params.opponentPillRef.current;
        if (targetEl) {
          const to = targetEl.getBoundingClientRect();
          const id = ++params.flyingTileIdRef.current;
          params.setFlyingTiles((prev) => [
            ...prev,
            {
              x: from.left + from.width / 2,
              y: from.top + from.height / 2,
              toX: to.left + to.width / 2,
              toY: to.top + to.height / 2,
              id,
            },
          ]);
          setTimeout(() => params.setFlyingTiles((prev) => prev.filter((tile) => tile.id !== id)), 1800);
        }
      }

      const isMe = payload.playerId === params.youRef.current;
      if (isMe && payload.tile) {
        const drawnTile = payload.tile;
        params.setDrawStepMyHand((prev) => {
          const base = prev ?? (params.stateRef.current?.players?.[params.youRef.current]?.hand ?? []);
          const next = [...base, drawnTile];
          params.setDrawPulseIndex(next.length - 1);
          setTimeout(() => params.setDrawPulseIndex(null), 400);
          return next;
        });
      } else if (!isMe) {
        params.setDrawStepOpponentHandCount(payload.drawerHandCount);
      }
    };

    socket.on('friend:invited', onFriendInvited);
    socket.on('friend:invite:error', onFriendInviteError);
    socket.on('room:update', onRoomUpdate);
    socket.on('state:update', onStateUpdate);
    socket.on('state:spectate', onStateSpectate);
    socket.on('game:draw_step', onDrawStep);

    return () => {
      socket.off('friend:invited', onFriendInvited);
      socket.off('friend:invite:error', onFriendInviteError);
      socket.off('room:update', onRoomUpdate);
      socket.off('state:update', onStateUpdate);
      socket.off('state:spectate', onStateSpectate);
      socket.off('game:draw_step', onDrawStep);
    };
  }, [params]);
}
