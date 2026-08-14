// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { applyStateUpdateProjection } from './applyProjectionResult';
import type { MultiplayerRoomSyncScope } from '../multiplayerRoomSyncScope';
import type { StateUpdateProjectionApply } from './projectionTypes';

describe('applyStateUpdateProjection', () => {
  it('unconditionally resets opponentDragging to false on state updates to prevent stuck dragging state', () => {
    const setOpponentDragging = vi.fn();
    const mockScope = {
      ui: {
        setState: vi.fn(),
        setError: vi.fn(),
        setLegalMoves: vi.fn(),
        setCanDraw: vi.fn(),
        setPreGameDraw: vi.fn(),
        setRecentAutoPasses: vi.fn(),
        setOpponentDragging,
        showToast: vi.fn(),
        setRoomRecoveryState: vi.fn(),
        setRoomRecoveryMessage: vi.fn(),
        setDrawSequenceActiveBoth: vi.fn(),
        setDrawStepMyHand: vi.fn(),
        setDrawStepActorId: vi.fn(),
        setDrawStepOpponentHandCount: vi.fn(),
        setBoneyardDisplayCount: vi.fn(),
        setFlyingTiles: vi.fn(),
      },
      session: {
        sessionRef: { current: { context: { roomCode: 'ROOM1' } } },
      },
      dom: {
        youRef: { current: 'player-you' },
        drawSequenceTimeoutRef: { current: null },
      },
    } as unknown as MultiplayerRoomSyncScope;

    const mockResult = {
      resyncAfterApply: null,
      nextState: {
        sequence: 123,
        players: {
          'player-you': { hand: [] },
        },
        playerIds: ['player-you', 'player-opp'],
        currentPlayerIndex: 0,
      },
      clearWaitingForReadyError: false,
      showRecoveryIdleHint: false,
      legalMoves: [],
      canDraw: false,
      preGameDraw: null,
      autoPassPlayerIds: [],
      forcedDrawStaging: { kind: 'none' },
    } as unknown as StateUpdateProjectionApply;

    const mockOptions = {
      commitId: Symbol('commit'),
      currentCommitRef: { current: null },
    } as any;

    applyStateUpdateProjection(mockScope, mockResult, mockOptions);

    // Confirm opponentDragging is reset to false
    expect(setOpponentDragging).toHaveBeenCalledWith(false);
  });
});
