import { useEffect, useLayoutEffect, useRef } from 'react';
import type { GameState, Tile } from '../types';
import { wrapSocketHandler } from './socketGuards';
import {
  getSocketEpisodeProjectionGate,
  getSocketEpisodeSequence,
  registerNormalizedSocketRouter,
  registerRawSocketEventHandler,
  type EpisodeStampedPayload,
  type RawSocketHandler,
  type SocketEpisodeProjectionGate,
} from './socketEventBus';
import { logger } from '../utils/logger';
import { recordIngressStaleEpisodeDrop } from './mpTelemetry';
import { drawAudit } from './drawAudit';
import { isMpDebugEnabled } from './mpPerf';
import type { RoomEventMeta, StateUpdatePayload } from './protocol';
import {
  createMultiplayerRoomSyncScope,
  type MultiplayerRoomSyncScope,
  type MultiplayerRoomSyncScopeSource,
} from './multiplayerRoomSyncScope';
import {
  applyProjectionSessionRefs,
  applySpectateProjection,
  applyStateUpdateProjection,
  logSequenceRegressionDrop,
} from './projection/applyProjectionResult';
import {
  nextEpisodeSequenceCursor,
  shouldDropClosedEpisodeProjection,
  shouldDropStaleEpisodeStateUpdate,
  shouldDropStaleProjectionCommit,
  shouldDropTransportReplayProjection,
} from './projection/projectionGates';
import { projectStateSpectate } from './projection/projectStateSpectate';
import { projectStateUpdate } from './projection/projectStateUpdate';
import { SOCKET_EVENTS } from './socketEventRegistry';
import {
  dispatchSessionEvents,
  sessionEventsFromProjectionRefs,
} from './sessionProjectionBridge';
import { selectJoinedRoomCode, selectMatchStarted } from './session/sessionStateMachine';

export type { StateUpdatePayload } from './protocol';
export type { AbandonedMatchNotice } from './multiplayerRoomSyncScope';

export {
  nextEpisodeSequenceCursor,
  shouldDropClosedEpisodeProjection,
  shouldDropPreProjectionStateReplay,
  shouldDropStaleEpisodeStateUpdate,
  shouldDropStaleProjectionCommit,
  shouldDropTransportReplayProjection,
  STATE_REPLAY_SILENT_DROP_GAP,
} from './projection/projectionGates';

/** Draw-only presentation timings, reduced to 65% of their original duration. */
const FORCED_DRAW_STAGGER_MS = 325;
const FORCED_DRAW_FLY_MS = 1170;

export type UseRoomSocketSyncParams = MultiplayerRoomSyncScopeSource;

type HandTileTarget = HTMLDivElement | HTMLButtonElement | null;

export function useRoomSocketSync(inputParams: UseRoomSocketSyncParams) {
  const scopeRef = useRef<MultiplayerRoomSyncScope>(null!);
  useLayoutEffect(() => {
    scopeRef.current = createMultiplayerRoomSyncScope(inputParams);
  });

  const currentEpisodeSequenceRef = useRef(0);
  const currentEpisodeRef = useRef<SocketEpisodeProjectionGate>({ id: 0, isClosed: false });
  const currentCommitRef = useRef<symbol | null>(null);

  useEffect(() => {
    const scope = scopeRef.current;

    const recover = () => {
      void scope.recovery.fetchGameState('handler_error');
    };
    const drawAnimationStepTimers: Array<ReturnType<typeof setTimeout>> = [];

    const clearPendingDrawAnimationTimers = () => {
      while (drawAnimationStepTimers.length > 0) {
        const timer = drawAnimationStepTimers.pop();
        if (timer) clearTimeout(timer);
      }
    };

    type ForcedDrawPendingDiag = {
      diagId: number;
      stateEventAt: number;
      source: 'state:self_forced' | 'state:opponent_forced';
      sequence: number;
      actorId: string;
      forcedDrawCount: number;
      animationArrived: boolean;
      animationArrivedAt: number | null;
    };
    let forcedDrawDiagIdCounter = 0;
    const forcedDrawPendingDiags: ForcedDrawPendingDiag[] = [];

    const recordForcedDrawStateEvent = (
      source: ForcedDrawPendingDiag['source'],
      sequence: number,
      actorId: string,
      forcedDrawCount: number,
    ) => {
      const diagId = ++forcedDrawDiagIdCounter;
      const stateEventAt = Date.now();
      const entry: ForcedDrawPendingDiag = {
        diagId,
        stateEventAt,
        source,
        sequence,
        actorId,
        forcedDrawCount,
        animationArrived: false,
        animationArrivedAt: null,
      };
      forcedDrawPendingDiags.push(entry);

      // TEMP-DIAGNOSTIC
      console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set true (forced-draw state event)', {
        path: 'applyAuthoritativeStateUpdate',
        source,
        sequence,
        actorId,
        forcedDrawCount,
        diagId,
        at: stateEventAt,
      });

      // TEMP-DIAGNOSTIC: logging-only watchdog — does not change drawSequenceActive or gameplay.
      window.setTimeout(() => {
        const pending = forcedDrawPendingDiags.find(
          (item) => item.diagId === diagId && !item.animationArrived,
        );
        if (pending) {
          console.warn('[TEMP-DIAGNOSTIC] game:draw_animation never arrived for forced-draw state event', {
            diagId: pending.diagId,
            source: pending.source,
            sequence: pending.sequence,
            actorId: pending.actorId,
            forcedDrawCount: pending.forcedDrawCount,
            elapsedMs: Date.now() - pending.stateEventAt,
          });
        }
      }, 30_000);
    };

    const recordForcedDrawAnimationArrival = (
      sequence: number,
      actorId: string,
      chainId: number,
      stepCount: number,
    ) => {
      const arrivedAt = Date.now();
      const pending = [...forcedDrawPendingDiags]
        .reverse()
        .find(
          (item) =>
            !item.animationArrived &&
            item.actorId === actorId &&
            (item.sequence === sequence || item.sequence === chainId),
        );
      if (pending) {
        pending.animationArrived = true;
        pending.animationArrivedAt = arrivedAt;
        // TEMP-DIAGNOSTIC
        console.log('[TEMP-DIAGNOSTIC] game:draw_animation arrived for forced-draw state event', {
          diagId: pending.diagId,
          source: pending.source,
          sequence: pending.sequence,
          actorId: pending.actorId,
          chainId,
          stepCount,
          latencyMs: arrivedAt - pending.stateEventAt,
          at: arrivedAt,
        });
        return;
      }
      // TEMP-DIAGNOSTIC
      console.log('[TEMP-DIAGNOSTIC] game:draw_animation arrived without matching pending state event', {
        sequence,
        actorId,
        chainId,
        stepCount,
        at: arrivedAt,
      });
    };

    const onFriendInviteError = wrapSocketHandler('friend:invite:error', () => {
      scope.ui.showToast('Invite failed: room not found', 2000);
    });

    const onRoomUpdate = wrapSocketHandler(
      'room:update',
      (payload: { players?: unknown }) => {
        const parsedPlayers = scope.ui.normalizeRoomPlayers(payload?.players);
        scope.room.roomPlayersRef.current = parsedPlayers;
        scope.ui.setPlayers(parsedPlayers);

        // If a matchmaking room was waiting for an opponent to join,
        // trigger the ready signal now that the roster has updated.
        if (parsedPlayers.length >= 2) {
          scope.session.trySchedulePlayerReadyRef.current();
        }
      },
    );

    const onRoomRequestReady = wrapSocketHandler(
      'room:request_ready',
      (payload: { roomCode?: string }) => {
        const activeRoom = selectJoinedRoomCode(scope.session.sessionRef.current);
        if (!activeRoom || selectMatchStarted(scope.session.sessionRef.current)) return;
        const requestedCode =
          typeof payload?.roomCode === 'string' ? payload.roomCode.trim().toUpperCase() : '';
        if (requestedCode && requestedCode !== activeRoom.trim().toUpperCase()) return;
        scope.session.dispatchSession({ type: 'ROOM_REQUEST_READY' });
        void scope.session.schedulePlayerReadyRef.current();
      },
    );

    const applyAuthoritativeStateUpdate = (
      payload: StateUpdatePayload & { episodeSequence?: number; transportId?: string },
    ) => {
      const commitId = Symbol('projection-commit');
      currentCommitRef.current = commitId;

      currentEpisodeRef.current = getSocketEpisodeProjectionGate();
      if (
        shouldDropClosedEpisodeProjection(
          currentEpisodeRef.current,
          payload.episodeSequence,
        )
      ) {
        recordIngressStaleEpisodeDrop({ gate: 'closed_episode' });
        return;
      }

      if (
        shouldDropStaleEpisodeStateUpdate(
          currentEpisodeSequenceRef.current,
          payload.episodeSequence,
          getSocketEpisodeSequence(),
        )
      ) {
        recordIngressStaleEpisodeDrop({ gate: 'stale_episode' });
        return;
      }
      currentEpisodeSequenceRef.current = nextEpisodeSequenceCursor(
        currentEpisodeSequenceRef.current,
        payload.episodeSequence,
        getSocketEpisodeSequence(),
      );

      const transportId =
        typeof payload.transportId === 'string' && payload.transportId.trim()
          ? payload.transportId.trim()
          : undefined;
      if (shouldDropTransportReplayProjection(transportId)) {
        return;
      }

      if (scope.recovery.rematchAwaitingStateRef.current) {
        scope.recovery.resetClientGameSession();
        scope.recovery.rematchAwaitingStateRef.current = false;
      }

      const maxSeqWatermarkBeforeMeta = scope.room.maxSequenceRef.current;
      scope.ui.applyRoomEventMeta(payload?.eventMeta);

      const projectionStart =
        isMpDebugEnabled() && typeof performance !== 'undefined' ? performance.now() : null;
      const projection = projectStateUpdate({
        payload,
        maxSequenceWatermark: scope.room.maxSequenceRef.current,
        maxSequenceWatermarkBeforeMeta: maxSeqWatermarkBeforeMeta,
        youId: scope.dom.youRef.current,
        joinedRoom: selectJoinedRoomCode(scope.session.sessionRef.current),
      });
      const projectionMs =
        projectionStart != null && typeof performance !== 'undefined'
          ? performance.now() - projectionStart
          : undefined;

      if (projection.kind === 'drop') {
        if (projection.fetchReason) {
          if (projection.reason === 'sequence_regression') {
            logSequenceRegressionDrop(
              payload?.state?.sequence,
              scope.room.maxSequenceRef.current,
            );
          }
          void scope.recovery.fetchGameState(projection.fetchReason);
        }
        return;
      }

      dispatchSessionEvents(
        scope.session.dispatchSession,
        sessionEventsFromProjectionRefs(
          projection.result.sessionRefs,
          projection.result.nextState,
        ),
      );
      applyProjectionSessionRefs(scope, projection.result.sessionRefs);

      if (shouldDropStaleProjectionCommit(currentCommitRef.current, commitId)) {
        return;
      }

      applyStateUpdateProjection(scope, projection.result, {
        commitId,
        currentCommitRef,
        transportId,
        projectionMs,
        recordForcedDrawStateEvent,
      });
    };

    scope.recovery.resyncFlushRef.current = () => {
      const buffered = scope.recovery.resyncBufferedUpdateRef.current;
      if (!buffered) return;
      scope.recovery.resyncBufferedUpdateRef.current = null;
      applyAuthoritativeStateUpdate(buffered);
    };

    const handleStateUpdate = wrapSocketHandler(
      'state:update',
      (payload: EpisodeStampedPayload<StateUpdatePayload>) => {
        if (scope.recovery.resyncInFlightRef.current) {
          scope.recovery.resyncBufferedUpdateRef.current = payload;
          return;
        }
        applyAuthoritativeStateUpdate(payload);
      },
      { recoverOnError: recover },
    );

    const onStateSpectate = wrapSocketHandler(
      'state:spectate',
      (payload: { state?: GameState | null; eventMeta?: RoomEventMeta }) => {
        scope.session.dispatchSession({
          type: 'STATE_UPDATE_LIFECYCLE',
          seatedClear: true,
        });
        scope.ui.applyRoomEventMeta(payload?.eventMeta);

        const projection = projectStateSpectate({
          payload,
          maxSequenceWatermark: scope.room.maxSequenceRef.current,
          youId: scope.dom.youRef.current,
          joinedRoom: selectJoinedRoomCode(scope.session.sessionRef.current),
        });

        if (projection.kind === 'drop') {
          if (projection.fetchReason) {
            if (projection.reason === 'sequence_regression') {
              logSequenceRegressionDrop(
                payload?.state?.sequence,
                scope.room.maxSequenceRef.current,
              );
            }
            void scope.recovery.fetchGameState(projection.fetchReason);
          }
          return;
        }

        dispatchSessionEvents(
          scope.session.dispatchSession,
          sessionEventsFromProjectionRefs(projection.result.sessionRefs, projection.result.nextState),
        );
        applyProjectionSessionRefs(scope, projection.result.sessionRefs);
        applySpectateProjection(scope, projection.result);
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

        if (scope.dom.stateRef.current?.handOver || scope.dom.stateRef.current?.gameOver) {
          clearPendingDrawAnimationTimers();
          // TEMP-DIAGNOSTIC
          console.log('[TEMP-DIAGNOSTIC] flyingTiles cleared', {
            path: 'game:draw_animation:handOverOrGameOver',
            at: Date.now(),
          });
          scope.ui.setFlyingTiles([]);
          return;
        }

        const chainId = payload.drawChainId ?? payload.sequence;
        recordForcedDrawAnimationArrival(
          payload.sequence,
          payload.playerId,
          chainId,
          payload.steps.length,
        );
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

        try {
          clearPendingDrawAnimationTimers();
          if (scope.dom.drawSequenceTimeoutRef.current) {
            clearTimeout(scope.dom.drawSequenceTimeoutRef.current);
            scope.dom.drawSequenceTimeoutRef.current = null;
          }

          const ownForcedDraw = payload.playerId === scope.dom.youRef.current;
          // TEMP-DIAGNOSTIC
          console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set true', {
            path: 'game:draw_animation:handler_start',
            actorId: payload.playerId,
            sequence: payload.sequence,
            chainId,
            stepCount: payload.steps.length,
            ownForcedDraw,
            at: Date.now(),
          });
          scope.ui.setDrawSequenceActiveBoth(true);
          scope.ui.setDrawStepActorId(payload.playerId);

          if (ownForcedDraw) {
            if (!scope.dom.pendingForcedHandRevealRef.current) {
              const youId = scope.dom.youRef.current;
              const fullHand = scope.dom.stateRef.current?.players[youId]?.hand ?? [];
              const stagedHand = fullHand.slice(
                0,
                Math.max(0, fullHand.length - payload.steps.length),
              );
              scope.dom.pendingForcedHandRevealRef.current = {
                sequence: payload.sequence,
                fullHand: fullHand.map((tile) => ({ low: tile.low, high: tile.high })),
              };
              scope.ui.setDrawStepMyHand(stagedHand);
              if (payload.steps[0]) {
                scope.ui.setBoneyardDisplayCount(
                  payload.steps[0].boneyardCount + payload.steps.length,
                );
              }
            }
          } else {
            scope.ui.setDrawStepMyHand(null);
            scope.dom.pendingForcedHandRevealRef.current = null;
            const opponentId = payload.playerId;
            const finalCount =
              scope.dom.stateRef.current?.handCounts?.[opponentId] ??
              scope.dom.stateRef.current?.players[opponentId]?.hand?.length ??
              0;
            scope.ui.setDrawStepOpponentHandCount(Math.max(0, finalCount - payload.steps.length));
            if (payload.steps[0]) {
              scope.ui.setBoneyardDisplayCount(
                payload.steps[0].boneyardCount + payload.steps.length,
              );
            }
          }

          const chainDurationMs =
            payload.steps.length * FORCED_DRAW_STAGGER_MS + FORCED_DRAW_FLY_MS;

          payload.steps.forEach((step, index) => {
            const stepTimer = window.setTimeout(() => {
              try {
                if (scope.dom.stateRef.current?.handOver || scope.dom.stateRef.current?.gameOver) {
                  clearPendingDrawAnimationTimers();
                  // TEMP-DIAGNOSTIC
                  console.log('[TEMP-DIAGNOSTIC] flyingTiles cleared', {
                    path: 'game:draw_animation:step:handOverOrGameOver',
                    at: Date.now(),
                  });
                  scope.ui.setFlyingTiles([]);
                  scope.ui.setDrawSequenceActiveBoth(false);
                  return;
                }
                scope.ui.playDrawSound(scope.session.isMutedRef.current);
                scope.ui.setBoneyardDisplayCount(step.boneyardCount);

                if (!scope.dom.boneyardRef.current) return;

                const from = scope.dom.boneyardRef.current.getBoundingClientRect();
                const isMe = payload.playerId === scope.dom.youRef.current;
                const targetEl: HandTileTarget = isMe
                  ? scope.dom.handAreaRef.current
                  : scope.dom.opponentPillRef.current;
                if (targetEl) {
                  const to = targetEl.getBoundingClientRect();
                  const id = ++scope.dom.flyingTileIdRef.current;
                  scope.ui.setFlyingTiles((prev) => [
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
                    scope.ui.setFlyingTiles((prev) => prev.filter((tile) => tile.id !== id));
                  }, FORCED_DRAW_FLY_MS);
                  drawAnimationStepTimers.push(removalTimer);
                }

                if (!isMe) {
                  scope.ui.setDrawStepOpponentHandCount(step.drawerHandCount);
                } else if (step.tile) {
                  const drawnTile = { low: step.tile.low, high: step.tile.high };
                  scope.ui.setDrawStepMyHand((prev) => {
                    const base = prev ?? [];
                    if (base.some((tile) => scope.ui.tileEquals(tile, drawnTile))) {
                      return base;
                    }
                    const nextHand = [...base, drawnTile];
                    if (nextHand.length > 0) {
                      scope.ui.setDrawPulseIndex(nextHand.length - 1);
                      const pulseClear = window.setTimeout(
                        () => scope.ui.setDrawPulseIndex(null),
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
                scope.ui.setDrawSequenceActiveBoth(false);
                scope.ui.setDrawStepMyHand(null);
                scope.ui.setDrawStepActorId(null);
                scope.ui.setDrawStepOpponentHandCount(null);
                scope.ui.setBoneyardDisplayCount(null);
                scope.ui.setFlyingTiles([]);
              }
            }, index * FORCED_DRAW_STAGGER_MS);
            drawAnimationStepTimers.push(stepTimer);
          });

          scope.dom.drawSequenceTimeoutRef.current = setTimeout(() => {
            drawAudit('animation-end', {
              requestId: chainId,
              ms: Date.now() - animationStartedAt,
            });
            clearPendingDrawAnimationTimers();
            scope.ui.setDrawStepMyHand(null);
            scope.dom.pendingForcedHandRevealRef.current = null;
            scope.ui.setDrawStepActorId(null);
            scope.ui.setDrawStepOpponentHandCount(null);
            scope.ui.setBoneyardDisplayCount(null);
            // TEMP-DIAGNOSTIC
            console.log('[TEMP-DIAGNOSTIC] flyingTiles cleared', {
              path: 'game:draw_animation:timer_chain_complete',
              chainId,
              chainDurationMs,
              at: Date.now(),
            });
            scope.ui.setFlyingTiles([]);
            // TEMP-DIAGNOSTIC
            console.log('[TEMP-DIAGNOSTIC] drawSequenceActive set false', {
              path: 'game:draw_animation:timer_chain_complete',
              chainId,
              chainDurationMs,
              stepCount: payload.steps.length,
              at: Date.now(),
            });
            scope.ui.setDrawSequenceActiveBoth(false);
          }, chainDurationMs);
        } catch (error) {
          logger.error('useRoomSocketSync.ts', error, { message: '[socket:game:draw_animation] setup error' });
          clearPendingDrawAnimationTimers();
          if (scope.dom.drawSequenceTimeoutRef.current) {
            clearTimeout(scope.dom.drawSequenceTimeoutRef.current);
            scope.dom.drawSequenceTimeoutRef.current = null;
          }
          scope.ui.setDrawSequenceActiveBoth(false);
          scope.ui.setDrawStepMyHand(null);
          scope.ui.setDrawStepActorId(null);
          scope.ui.setDrawStepOpponentHandCount(null);
          scope.ui.setBoneyardDisplayCount(null);
          scope.ui.setFlyingTiles([]);
        }
      },
    );

    const onPlayerDisconnected = wrapSocketHandler(
      'player:disconnected',
      (payload: { playerId?: string; graceMs?: number }) => {
        if (!payload?.playerId || payload.playerId === scope.dom.youRef.current) return;
        scope.ui.setOpponentDisconnected(true);
        const seconds = Math.max(1, Math.round((payload.graceMs ?? 30_000) / 1000));
        scope.ui.setOpponentDisconnectMessage(`Opponent disconnected. Waiting up to ${seconds}s…`);
        scope.ui.showToast('Opponent disconnected.', 2500);
      },
    );

    const onPlayerReconnected = wrapSocketHandler('player:reconnected', () => {
      scope.ui.setOpponentDisconnected(false);
      scope.ui.setOpponentDisconnectMessage('');
      scope.ui.showToast('Opponent reconnected.', 2500);
    });

    const onPlayerReconnectTimeout = wrapSocketHandler('player:reconnect_timeout', () => {
      scope.ui.setOpponentDisconnectMessage('Opponent did not return in time.');
      scope.ui.showToast('Opponent forfeited.', 3000);
    });

    const onPlayerDisconnectStall = wrapSocketHandler(
      'player:disconnect_stall',
      (payload: { playerId?: string; phase?: 'retry' | 'paused'; message?: string }) => {
        if (!payload?.playerId || payload.playerId === scope.dom.youRef.current) return;
        scope.ui.setOpponentDisconnected(true);
        const message =
          typeof payload.message === 'string' && payload.message.trim().length > 0
            ? payload.message
            : payload.phase === 'paused'
              ? "We're having technical issues saving this match. The game is paused — hang tight."
              : "Opponent still disconnected. Auto-move couldn't be saved — waiting for server recovery…";
        scope.ui.setOpponentDisconnectMessage(message);
        if (payload.phase === 'paused') {
          scope.ui.showToast(message, 4500);
        }
      },
    );

    const unregisterNormalized = registerNormalizedSocketRouter({
      stateUpdate: handleStateUpdate,
    });

    const asRawHandler = (handler: (...args: never[]) => void): RawSocketHandler =>
      handler as RawSocketHandler;

    const unregisterRaw = [
      registerRawSocketEventHandler(SOCKET_EVENTS.FRIEND_INVITE_ERROR, asRawHandler(onFriendInviteError)),
      registerRawSocketEventHandler(SOCKET_EVENTS.ROOM_UPDATE, asRawHandler(onRoomUpdate)),
      registerRawSocketEventHandler(SOCKET_EVENTS.ROOM_REQUEST_READY, asRawHandler(onRoomRequestReady)),
      registerRawSocketEventHandler(SOCKET_EVENTS.STATE_SPECTATE, asRawHandler(onStateSpectate)),
      registerRawSocketEventHandler(SOCKET_EVENTS.GAME_DRAW_ANIMATION, asRawHandler(onDrawAnimation)),
      registerRawSocketEventHandler(SOCKET_EVENTS.PLAYER_DISCONNECTED, asRawHandler(onPlayerDisconnected)),
      registerRawSocketEventHandler(SOCKET_EVENTS.PLAYER_RECONNECTED, asRawHandler(onPlayerReconnected)),
      registerRawSocketEventHandler(SOCKET_EVENTS.PLAYER_RECONNECT_TIMEOUT, asRawHandler(onPlayerReconnectTimeout)),
      registerRawSocketEventHandler(SOCKET_EVENTS.PLAYER_DISCONNECT_STALL, asRawHandler(onPlayerDisconnectStall)),
    ];

    return () => {
      scope.recovery.resyncFlushRef.current = null;
      unregisterNormalized();
      for (const unregister of unregisterRaw) {
        unregister();
      }
      clearPendingDrawAnimationTimers();
      if (scope.dom.drawSequenceTimeoutRef.current) {
        clearTimeout(scope.dom.drawSequenceTimeoutRef.current);
        scope.dom.drawSequenceTimeoutRef.current = null;
      }
    };
  }, [inputParams]);
}
