import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { Socket } from 'socket.io-client';
import type { GameState, Move, Tile } from '../types';
import type { PreGameDrawState } from '../match/preGameDraw/preGameDrawLogic';
import { projectMultiplayerGameState } from './boardSnapshotGuards';
import { hasHandIdentityMismatch } from './handIdentity';
import { evaluateSequenceUpdate, wrapSocketHandler } from './socketGuards';
import { logger } from '../utils/logger';
import { drawAudit } from './drawAudit';
import { isMpDebugEnabled, mpPerfMarkStateApplied } from './mpPerf';
import type {
  MultiplayerRoomSyncDomRuntime,
  MultiplayerRoomSyncRuntime,
  MultiplayerRoomSyncUiRuntime,
  RoomRecoveryState,
  StateUpdatePayload,
  RoomPlayer,
} from './multiplayerRuntime';

export type { StateUpdatePayload } from './multiplayerRuntime';

/** Per-step stagger; chain runs to completion before final hand is shown. */
const FORCED_DRAW_STAGGER_MS = 240;
const FORCED_DRAW_FLY_MS = 1800;

function isActiveGameplayState(state: GameState | null): boolean {
  return Boolean(
    state &&
      Array.isArray(state.playerIds) &&
      state.playerIds.length >= 2 &&
      typeof state.sequence === 'number' &&
      Number.isFinite(state.sequence),
  );
}

type RoomEventMeta = {
  matchId?: string;
  lastEventSequence?: number;
  eventCount?: number;
};

export type UseRoomSocketSyncParams = {
  socket: Socket | null;
  syncRuntime: MultiplayerRoomSyncRuntime;
  syncUi: MultiplayerRoomSyncUiRuntime;
  syncDom: MultiplayerRoomSyncDomRuntime;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  roomPlayersRef: MutableRefObject<RoomPlayer[]>;
};

type FlatRoomSocketSyncParams = {
  socket: Socket | null;
  showToast: (message: string, duration?: number) => void;
  normalizeRoomPlayers: (value: unknown) => RoomPlayer[];
  applyRoomEventMeta: (meta?: RoomEventMeta | null) => void;
  setFriendInvite: MultiplayerRoomSyncUiRuntime['setFriendInvite'];
  joinedRoomRef: MutableRefObject<string | null>;
  maxSequenceRef: MutableRefObject<number>;
  setPlayers: Dispatch<SetStateAction<RoomPlayer[]>>;
  setState: Dispatch<SetStateAction<GameState | null>>;
  setRoomRecoveryState: Dispatch<SetStateAction<RoomRecoveryState>>;
  setRoomRecoveryMessage: Dispatch<SetStateAction<string>>;
  setPreGameDraw: Dispatch<SetStateAction<PreGameDrawState | null>>;
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
  schedulePlayerReadyRef: MutableRefObject<() => Promise<void>>;
  trySchedulePlayerReadyRef: MutableRefObject<() => void>;
  onAuthoritativeGameplayStateApplied?: (nextState: GameState | null) => void;
  setError: Dispatch<SetStateAction<string>>;
};

function flattenRoomSocketSyncParams(params: UseRoomSocketSyncParams): FlatRoomSocketSyncParams {
  return {
    socket: params.socket,
    ...params.syncUi,
    ...params.syncRuntime.roomRuntime,
    ...params.syncRuntime.recoveryRuntime,
    ...params.syncRuntime.sessionRefsRuntime,
    setState: params.setState,
    setPlayers: params.setPlayers,
    roomPlayersRef: params.roomPlayersRef,
    ...params.syncDom,
  };
}

type HandTileTarget = HTMLDivElement | HTMLButtonElement | null;

function clearDrawPreview(params: Pick<
  FlatRoomSocketSyncParams,
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
    logger.error('useRoomSocketSync.ts', new Error('[mp-state] sequence regression — full resync'), {
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

export function useRoomSocketSync(inputParams: UseRoomSocketSyncParams) {
  useEffect(() => {
    const params = flattenRoomSocketSyncParams(inputParams);
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

    const onRoomRequestReady = wrapSocketHandler(
      'room:request_ready',
      (payload: { roomCode?: string }) => {
        const activeRoom = params.joinedRoomRef.current;
        if (!activeRoom || params.matchStartedRef.current) return;
        const requestedCode =
          typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        if (requestedCode && requestedCode !== activeRoom.trim().toUpperCase()) return;
        params.playerReadyEmittedRef.current = false;
        void params.schedulePlayerReadyRef.current();
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
      if (isActiveGameplayState(nextState)) {
        params.setError((current) => (current === 'waiting_for_ready' ? '' : current));
      }

      const selfForcedRevealPending =
        typeof payload.forcedDrawCount === 'number' &&
        payload.forcedDrawCount > 0 &&
        payload.forcedDrawActorId === params.youRef.current &&
        !!nextState;

      if (params.joinedRoomRef.current) {
        params.setRoomRecoveryState('idle');
        params.setRoomRecoveryMessage('');
      }

      params.setLegalMoves(Array.isArray(payload?.legalMoves) ? payload.legalMoves : []);
      params.setCanDraw(Boolean(payload?.canDraw));
      params.setPreGameDraw(payload.preGameDraw ?? null);

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
        const youId = params.youRef.current;
        const fullHand = nextState.players[youId]?.hand ?? [];
        const drawnCount = payload.forcedDrawCount ?? 0;
        const stagedHand = fullHand.slice(0, Math.max(0, fullHand.length - drawnCount));
        params.pendingForcedHandRevealRef.current = {
          sequence: nextState.sequence,
          fullHand: fullHand.map((tile) => ({ low: tile.low, high: tile.high })),
        };
        params.setDrawStepMyHand(stagedHand);
        params.setDrawStepActorId(youId);
        params.setDrawStepOpponentHandCount(null);
        const preDrawBoneyard = (nextState.boneyard?.length ?? 0) + drawnCount;
        params.setBoneyardDisplayCount(preDrawBoneyard);
      } else {
        const opponentForcedRevealPending =
          typeof payload.forcedDrawCount === 'number' &&
          payload.forcedDrawCount > 0 &&
          typeof payload.forcedDrawActorId === 'string' &&
          payload.forcedDrawActorId !== params.youRef.current &&
          !!nextState;

        params.pendingForcedHandRevealRef.current = null;
        params.setDrawStepMyHand(null);

        if (opponentForcedRevealPending && nextState) {
          const drawnCount = payload.forcedDrawCount ?? 0;
          const opponentId = payload.forcedDrawActorId!;
          const finalCount =
            nextState.handCounts?.[opponentId] ??
            nextState.players[opponentId]?.hand?.length ??
            0;
          params.setDrawStepActorId(opponentId);
          params.setDrawStepOpponentHandCount(Math.max(0, finalCount - drawnCount));
          params.setBoneyardDisplayCount((nextState.boneyard?.length ?? 0) + drawnCount);
        } else {
          clearDrawPreview(params);
          params.setBoneyardDisplayCount(payload?.state?.boneyard?.length ?? null);
        }
      }

      drawAudit('room-update', {
        requestId: nextState?.sequence,
        handCount: nextState?.players[params.youRef.current]?.hand?.length ?? 0,
        boneyardCount: nextState?.boneyard?.length ?? 0,
        currentTurn: nextState?.playerIds[nextState?.currentPlayerIndex ?? -1],
        forcedDraw: payload.forcedDrawCount ?? 0,
      });

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

        if (params.stateRef.current?.handOver || params.stateRef.current?.gameOver) {
          clearPendingDrawAnimationTimers();
          params.setFlyingTiles([]);
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
        params.setDrawStepActorId(payload.playerId);

        if (ownForcedDraw) {
          if (!params.pendingForcedHandRevealRef.current) {
            const youId = params.youRef.current;
            const fullHand = params.stateRef.current?.players[youId]?.hand ?? [];
            const stagedHand = fullHand.slice(
              0,
              Math.max(0, fullHand.length - payload.steps.length),
            );
            params.pendingForcedHandRevealRef.current = {
              sequence: payload.sequence,
              fullHand: fullHand.map((tile) => ({ low: tile.low, high: tile.high })),
            };
            params.setDrawStepMyHand(stagedHand);
            if (payload.steps[0]) {
              params.setBoneyardDisplayCount(
                payload.steps[0].boneyardCount + payload.steps.length,
              );
            }
          }
        } else {
          params.setDrawStepMyHand(null);
          params.pendingForcedHandRevealRef.current = null;
        }

        const chainDurationMs =
          payload.steps.length * FORCED_DRAW_STAGGER_MS + FORCED_DRAW_FLY_MS;

        payload.steps.forEach((step, index) => {
          const stepTimer = window.setTimeout(() => {
            try {
              if (params.stateRef.current?.handOver || params.stateRef.current?.gameOver) {
                clearPendingDrawAnimationTimers();
                params.setFlyingTiles([]);
                return;
              }
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
              } else if (step.tile) {
                const drawnTile = { low: step.tile.low, high: step.tile.high };
                params.setDrawStepMyHand((prev) => {
                  const base = prev ?? [];
                  if (base.some((tile) => params.tileEquals(tile, drawnTile))) {
                    return base;
                  }
                  const nextHand = [...base, drawnTile];
                  if (nextHand.length > 0) {
                    params.setDrawPulseIndex(nextHand.length - 1);
                    const pulseClear = window.setTimeout(
                      () => params.setDrawPulseIndex(null),
                      360,
                    );
                    drawAnimationStepTimers.push(pulseClear);
                  }
                  return nextHand;
                });
              }
            } catch (error) {
              logger.error('useRoomSocketSync.ts', error, { message: '[socket:game:draw_animation] step error' });
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
          params.setDrawStepMyHand(null);
          params.pendingForcedHandRevealRef.current = null;
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
    socket.on('room:request_ready', onRoomRequestReady);
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
      socket.off('room:request_ready', onRoomRequestReady);
      socket.off('state:update', onStateUpdate);
      socket.off('state:spectate', onStateSpectate);
      socket.off('game:draw_animation', onDrawAnimation);
      socket.off('player:disconnected', onPlayerDisconnected);
      socket.off('player:reconnected', onPlayerReconnected);
      socket.off('player:reconnect_timeout', onPlayerReconnectTimeout);
      clearPendingDrawAnimationTimers();
    };
  }, [inputParams]);
}
