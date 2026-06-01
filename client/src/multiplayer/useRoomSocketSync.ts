import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, Tile } from '../types';
import { projectMultiplayerGameState } from './boardSnapshotGuards';
import { hasHandIdentityMismatch } from './handIdentity';
import { evaluateSequenceUpdate, wrapSocketHandler } from './socketGuards';
import { drawAudit } from './drawAudit';
import { isMpDebugEnabled, mpPerfMarkStateApplied } from './mpPerf';

/** Per-step stagger; total chain capped so gameplay is not blocked. */
const FORCED_DRAW_STAGGER_MS = 72;
const FORCED_DRAW_FLY_MS = 520;
const FORCED_DRAW_CHAIN_CAP_MS = 640;

export type StateUpdatePayload = {
  you?: string;
  state?: GameState | null;
  legalMoves?: Move[];
  canDraw?: boolean;
  eventMeta?: RoomEventMeta | null;
  /** Authoritative lobby flag from server — do not infer from local state shape. */
  matchStarted?: boolean;
  /** Set with `state` when the server aggregated a forced-draw chain after a PLAY. */
  forcedDrawCount?: number;
  forcedDrawActorId?: string;
  /** Server auto-passed players (socket ids) this frame — show a brief notice. */
  recentAutoPasses?: string[];
};

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
      inviteId: string;
      fromUsername: string;
      fromUserId: string | null;
      roomCode: string;
      inviteUrl: string;
      matchSummary: string;
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
  setOpponentDisconnected: Dispatch<SetStateAction<boolean>>;
  setOpponentDisconnectMessage: Dispatch<SetStateAction<string>>;
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
  fetchGameState: (reason: string) => Promise<boolean>;
  pendingForcedHandRevealRef: MutableRefObject<{ sequence: number; fullHand: Tile[] } | null>;
  resyncInFlightRef: MutableRefObject<boolean>;
  resyncBufferedUpdateRef: MutableRefObject<StateUpdatePayload | null>;
  resyncFlushRef: MutableRefObject<(() => void) | null>;
  rematchAwaitingStateRef: MutableRefObject<boolean>;
  resetClientGameSession: () => void;
  isSeatedPlayerRef: MutableRefObject<boolean>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
  matchStartedRef: MutableRefObject<boolean>;
  playerReadyEmittedRef: MutableRefObject<boolean>;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  /** Called after a fresh authoritative snapshot passes sequence checks (gameplay pending UI). */
  onAuthoritativeGameplayStateApplied?: (nextState: GameState | null) => void;
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

function applySequenceToWatermark(
  maxSequenceRef: MutableRefObject<number>,
  incoming: number | undefined | null,
  fetchGameState: (reason: string) => Promise<boolean>,
): boolean {
  const decision = evaluateSequenceUpdate(maxSequenceRef, incoming);
  if (decision.action === 'reject_regression') {
    console.error('[mp-state] sequence regression — full resync', {
      incoming: decision.incoming,
      watermark: decision.watermark,
    });
    void fetchGameState('sequence_regression');
    return false;
  }
  if (decision.action === 'reject_stale') {
    void fetchGameState('stale_state_update');
    return false;
  }
  if (typeof incoming === 'number' && Number.isFinite(incoming)) {
    maxSequenceRef.current = decision.sequence;
  }
  return true;
}

export function useRoomSocketSync(params: UseRoomSocketSyncParams) {
  useEffect(() => {
    const { socket } = params;
    if (!socket) return;

    const recover = () => {
      void params.fetchGameState('handler_error');
    };
    const drawAnimationStepTimers: Array<ReturnType<typeof setTimeout>> = [];

    const clearPendingDrawAnimationTimers = () => {
      while (drawAnimationStepTimers.length > 0) {
        const timer = drawAnimationStepTimers.pop();
        if (timer) clearTimeout(timer);
      }
    };

    const onFriendInvited = wrapSocketHandler(
      'friend:invited',
      (payload: {
        inviteId?: string;
        fromUsername: string;
        fromUserId?: string | null;
        roomCode: string;
        inviteUrl: string;
        matchSummary?: string;
      }) => {
        params.setFriendInvite({
          inviteId: String(payload.inviteId ?? `${Date.now()}-${payload.roomCode}`),
          fromUsername: payload.fromUsername,
          fromUserId: payload.fromUserId ?? null,
          roomCode: payload.roomCode,
          inviteUrl: payload.inviteUrl,
          matchSummary: payload.matchSummary ?? '7-Tile · First to 60 · Untimed',
        });
      },
    );

    const onFriendInviteError = wrapSocketHandler('friend:invite:error', () => {
      params.showToast('Invite failed: room not found', 2000);
    });

    const onRoomUpdate = wrapSocketHandler(
      'room:update',
      (payload: { players?: unknown }) => {
        const parsedPlayers = params.normalizeRoomPlayers(payload?.players);
        params.roomPlayersRef.current = parsedPlayers;
        params.setPlayers(parsedPlayers);

        // If a matchmaking room was waiting for an opponent to join,
        // trigger the ready signal now that the roster has updated.
        if (parsedPlayers.length >= 2) {
          params.trySchedulePlayerReadyRef.current();
        }
      },
    );

    const applyAuthoritativeStateUpdate = (payload: StateUpdatePayload) => {
      if (params.rematchAwaitingStateRef.current) {
        params.resetClientGameSession();
        params.rematchAwaitingStateRef.current = false;
      }

      const maxSeqWatermarkBeforeMeta = params.maxSequenceRef.current;
      params.applyRoomEventMeta(payload?.eventMeta);

      /** After a new match identity, watermark is −1 briefly — insist on structural integrity before hydration. */
      const eventMetaResetSequenceWatermark =
        maxSeqWatermarkBeforeMeta !== params.maxSequenceRef.current &&
        params.maxSequenceRef.current === -1;

      const rawState = payload?.state ?? null;
      let nextState = rawState;
      let projectionMs: number | undefined;
      if (nextState !== null) {
        const projectionStart =
          isMpDebugEnabled() && typeof performance !== 'undefined' ? performance.now() : null;
        const projected = projectMultiplayerGameState(nextState);
        if (!projected) {
          void params.fetchGameState('invalid_state_projection');
          return;
        }
        nextState = projected;
        if (projectionStart != null) {
          projectionMs = performance.now() - projectionStart;
        }
      }

      /**
       * After match identity rolls the sequence watermark back to −1, require a numbered snapshot frame
       * so stray undated payloads cannot hydrate the chrome before the authoritative counter exists.
       */
      if (
        eventMetaResetSequenceWatermark &&
        nextState !== null &&
        (typeof nextState.sequence !== 'number' || !Number.isFinite(nextState.sequence))
      ) {
        void params.fetchGameState('fresh_match_requires_sequence');
        return;
      }

      if (
        nextState &&
        !applySequenceToWatermark(
          params.maxSequenceRef,
          nextState.sequence,
          params.fetchGameState,
        )
      ) {
        return;
      }

      if (nextState?.playerIds && !nextState.playerIds.includes(params.youRef.current)) {
        params.isSeatedPlayerRef.current = false;
      }

      if (hasHandIdentityMismatch(nextState, params.youRef.current)) {
        void params.fetchGameState('hand_identity_mismatch');
      }

      if (typeof payload.matchStarted === 'boolean') {
        params.matchStartedRef.current = payload.matchStarted;
        if (
          payload.matchStarted &&
          nextState?.playerIds?.includes(params.youRef.current)
        ) {
          params.playerReadyEmittedRef.current = true;
        }
      }

      if (
        typeof payload.you === 'string' &&
        payload.you &&
        (!nextState?.playerIds || nextState.playerIds.includes(payload.you))
      ) {
        params.youRef.current = payload.you;
      }

      params.setState(nextState);
      const selfForcedRevealPending =
        typeof payload.forcedDrawCount === 'number' &&
        payload.forcedDrawCount > 0 &&
        payload.forcedDrawActorId === params.youRef.current &&
        !!nextState;

      if (params.joinedRoomRef.current) {
        params.setRoomRecoveryState('idle');
        params.setRoomRecoveryMessage('');
      }

      params.setOptimisticPlayedTile(null);
      params.setLegalMoves(Array.isArray(payload?.legalMoves) ? payload.legalMoves : []);
      params.setCanDraw(Boolean(payload?.canDraw));

      const autoPassIds = Array.isArray(payload.recentAutoPasses) ? payload.recentAutoPasses : [];
      if (autoPassIds.length > 0) {
        drawAudit('auto-pass', {
          roomCode: params.joinedRoomRef.current ?? '',
          playerId: autoPassIds.join(','),
          boneyardCount: nextState?.boneyard?.length ?? 0,
          reason: 'blocked_locked_boneyard',
        });
        params.showToast('No moves available — passing…', 1500);
      }

      if (selfForcedRevealPending && nextState) {
        if (params.drawSequenceTimeoutRef.current) {
          clearTimeout(params.drawSequenceTimeoutRef.current);
          params.drawSequenceTimeoutRef.current = null;
        }
        params.setDrawSequenceActiveBoth(false);
        params.setDrawStepMyHand(null);
        params.setDrawStepActorId(null);
        params.setDrawStepOpponentHandCount(null);
        params.pendingForcedHandRevealRef.current = null;
      } else {
        params.pendingForcedHandRevealRef.current = null;
        clearDrawPreview(params);
      }

      drawAudit('room-update', {
        requestId: nextState?.sequence,
        handCount: nextState?.players[params.youRef.current]?.hand?.length ?? 0,
        boneyardCount: nextState?.boneyard?.length ?? 0,
        currentTurn: nextState?.playerIds[nextState?.currentPlayerIndex ?? -1],
        forcedDraw: payload.forcedDrawCount ?? 0,
      });

      params.setBoneyardDisplayCount(payload?.state?.boneyard?.length ?? null);
      params.setOpponentDisconnected(false);
      params.setOpponentDisconnectMessage('');

      if (nextState && isMpDebugEnabled()) {
        mpPerfMarkStateApplied(nextState.sequence, projectionMs);
      }
      params.onAuthoritativeGameplayStateApplied?.(nextState);
    };

    params.resyncFlushRef.current = () => {
      const buffered = params.resyncBufferedUpdateRef.current;
      if (!buffered) return;
      params.resyncBufferedUpdateRef.current = null;
      applyAuthoritativeStateUpdate(buffered);
    };

    const onStateUpdate = wrapSocketHandler(
      'state:update',
      (payload: StateUpdatePayload) => {
        if (params.resyncInFlightRef.current) {
          params.resyncBufferedUpdateRef.current = payload;
          return;
        }
        applyAuthoritativeStateUpdate(payload);
      },
      { recoverOnError: recover },
    );

    const onStateSpectate = wrapSocketHandler(
      'state:spectate',
      (payload: { state?: GameState | null; eventMeta?: RoomEventMeta }) => {
        params.isSeatedPlayerRef.current = false;
        params.applyRoomEventMeta(payload?.eventMeta);
        const rawState = payload?.state ?? null;
        if (rawState?.playerIds?.includes(params.youRef.current)) {
          return;
        }
        let nextState = rawState;
        if (nextState !== null) {
          const projected = projectMultiplayerGameState(nextState);
          if (!projected) {
            void params.fetchGameState('invalid_spectator_snapshot');
            return;
          }
          nextState = projected;
        }
        if (
          nextState &&
          !applySequenceToWatermark(
            params.maxSequenceRef,
            nextState.sequence,
            params.fetchGameState,
          )
        ) {
          return;
        }

        params.setState(nextState);
        if (params.joinedRoomRef.current) {
          params.setRoomRecoveryState('idle');
          params.setRoomRecoveryMessage('');
        }
        params.setOptimisticPlayedTile(null);
        params.setLegalMoves([]);
        params.setCanDraw(false);
        clearDrawPreview(params);
        params.setBoneyardDisplayCount(payload?.state?.boneyard?.length ?? null);
      },
      { recoverOnError: recover },
    );

    let lastForcedDrawAnimationSequence = -1;

    const onDrawAnimation = wrapSocketHandler(
      'game:draw_animation',
      (payload: {
        playerId: string;
        sequence: number;
        mode: 'forced_draw';
        drawChainId?: number;
        steps: Array<{
          tile: Tile | null;
          boneyardCount: number;
          drawerHandCount: number;
        }>;
        final: {
          drewCount: number;
          stoppedReason: 'playable' | 'locked_pass' | 'locked_no_pass';
          canPlayNow: boolean;
          handOver: boolean;
          gameOver: boolean;
        };
      }) => {
        if (!payload || payload.mode !== 'forced_draw' || !Array.isArray(payload.steps) || payload.steps.length === 0) {
          return;
        }

        const chainId = payload.drawChainId ?? payload.sequence;
        if (chainId === lastForcedDrawAnimationSequence) {
          drawAudit('animation-start', {
            requestId: chainId,
            actor: payload.playerId,
            drawnCount: payload.steps.length,
            source: 'deduped',
          });
          return;
        }
        lastForcedDrawAnimationSequence = chainId;

        const animationStartedAt = Date.now();
        drawAudit('animation-start', {
          requestId: chainId,
          actor: payload.playerId,
          drawnCount: payload.steps.length,
          source: 'game:draw_animation',
        });

        clearPendingDrawAnimationTimers();
        if (params.drawSequenceTimeoutRef.current) {
          clearTimeout(params.drawSequenceTimeoutRef.current);
          params.drawSequenceTimeoutRef.current = null;
        }

        const ownForcedDraw = payload.playerId === params.youRef.current;
        params.setDrawSequenceActiveBoth(false);
        params.setDrawStepMyHand(null);
        params.setDrawStepActorId(payload.playerId);
        params.pendingForcedHandRevealRef.current = null;

        const chainDurationMs = Math.min(
          payload.steps.length * FORCED_DRAW_STAGGER_MS + FORCED_DRAW_FLY_MS,
          FORCED_DRAW_CHAIN_CAP_MS,
        );

        payload.steps.forEach((step, index) => {
          const stepTimer = window.setTimeout(() => {
            try {
              params.playDrawSound(params.isMutedRef.current);
              params.setBoneyardDisplayCount(step.boneyardCount);

              if (!params.boneyardRef.current) return;

              const from = params.boneyardRef.current.getBoundingClientRect();
              const isMe = payload.playerId === params.youRef.current;
              const targetEl: HandTileTarget = isMe
                ? params.handAreaRef.current
                : params.opponentPillRef.current;
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
                const removalTimer = window.setTimeout(() => {
                  params.setFlyingTiles((prev) => prev.filter((tile) => tile.id !== id));
                }, FORCED_DRAW_FLY_MS);
                drawAnimationStepTimers.push(removalTimer);
              }

              if (!isMe) {
                params.setDrawStepOpponentHandCount(step.drawerHandCount);
              } else if (index === payload.steps.length - 1) {
                const handLen = params.stateRef.current?.players[params.youRef.current]?.hand?.length ?? 0;
                if (handLen > 0) {
                  params.setDrawPulseIndex(handLen - 1);
                  const pulseClear = window.setTimeout(() => params.setDrawPulseIndex(null), 360);
                  drawAnimationStepTimers.push(pulseClear);
                }
              }
            } catch (error) {
              console.error('[socket:game:draw_animation] step error', error);
              clearPendingDrawAnimationTimers();
            }
          }, index * FORCED_DRAW_STAGGER_MS);
          drawAnimationStepTimers.push(stepTimer);
        });

        params.drawSequenceTimeoutRef.current = setTimeout(() => {
          drawAudit('animation-end', {
            requestId: chainId,
            ms: Date.now() - animationStartedAt,
          });
          clearPendingDrawAnimationTimers();
          params.setDrawStepActorId(null);
          params.setDrawStepOpponentHandCount(null);
          params.setBoneyardDisplayCount(null);
          params.setFlyingTiles([]);
        }, chainDurationMs);
      },
    );

    const onPlayerDisconnected = wrapSocketHandler(
      'player:disconnected',
      (payload: { playerId?: string; graceMs?: number }) => {
        if (!payload?.playerId || payload.playerId === params.youRef.current) return;
        params.setOpponentDisconnected(true);
        const seconds = Math.max(1, Math.round((payload.graceMs ?? 30_000) / 1000));
        params.setOpponentDisconnectMessage(`Opponent disconnected. Waiting up to ${seconds}s…`);
      },
    );

    const onPlayerReconnected = wrapSocketHandler('player:reconnected', () => {
      params.setOpponentDisconnected(false);
      params.setOpponentDisconnectMessage('');
    });

    const onPlayerReconnectTimeout = wrapSocketHandler('player:reconnect_timeout', () => {
      params.setOpponentDisconnectMessage('Opponent did not return in time.');
    });

    socket.on('friend:invited', onFriendInvited);
    socket.on('friend:invite:error', onFriendInviteError);
    socket.on('room:update', onRoomUpdate);
    socket.on('state:update', onStateUpdate);
    socket.on('state:spectate', onStateSpectate);
    socket.on('game:draw_animation', onDrawAnimation);
    socket.on('player:disconnected', onPlayerDisconnected);
    socket.on('player:reconnected', onPlayerReconnected);
    socket.on('player:reconnect_timeout', onPlayerReconnectTimeout);

    return () => {
      params.resyncFlushRef.current = null;
      socket.off('friend:invited', onFriendInvited);
      socket.off('friend:invite:error', onFriendInviteError);
      socket.off('room:update', onRoomUpdate);
      socket.off('state:update', onStateUpdate);
      socket.off('state:spectate', onStateSpectate);
      socket.off('game:draw_animation', onDrawAnimation);
      socket.off('player:disconnected', onPlayerDisconnected);
      socket.off('player:reconnected', onPlayerReconnected);
      socket.off('player:reconnect_timeout', onPlayerReconnectTimeout);
      clearPendingDrawAnimationTimers();
    };
  }, [params]);
}
