import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useLiveMatchActions, type UseLiveMatchActionsParams } from './useLiveMatchActions';
import type { Socket } from 'socket.io-client';
import type { GameState } from '../../../types';
import { emitGameAction } from '../../../multiplayer/roomTransport';
import type { LogicalGameplayAction } from './gameplayActionIdentity';

vi.mock('../../../multiplayer/roomTransport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../multiplayer/roomTransport')>();
  return {
    ...actual,
    emitGameAction: vi.fn(),
    emitGameStart: vi.fn(),
    emitGameRematch: vi.fn(),
  };
});

const YOU = 'player-you';
const OPP = 'player-opp';
const ROOM = 'ABCD';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    config: { scoringMultiple: 5, winningScore: 100 },
    playerIds: [YOU, OPP],
    players: {
      [YOU]: { id: YOU, hand: [{ low: 1, high: 2 }], score: 0 },
      [OPP]: { id: OPP, hand: [], score: 0 },
    },
    board: {
      mainLine: [],
      leftEnd: 3,
      rightEnd: 5,
      leftEndIsDouble: false,
      rightEndIsDouble: false,
      hubDoubles: [],
    },
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 1,
    ...overrides,
  };
}

function makeParams(overrides: Partial<UseLiveMatchActionsParams> = {}): UseLiveMatchActionsParams {
  const socket = { connected: true, emit: vi.fn() } as unknown as Socket;
  return {
    socket,
    joinedRoom: ROOM,
    you: YOU,
    state: makeState(),
    legalMoves: [],
    canDraw: false,
    roomRecoveryState: 'idle',
    isRecoveringConnection: false,
    rejoinInFlightRef: { current: false },
    pendingUiAction: null,
    drawSequenceActive: false,
    flyingTiles: [],
    rematchRequested: false,
    stateRef: { current: makeState() },
    legalMovesRef: { current: [] },
    selectedTileRef: { current: null },
    pendingActionRef: { current: false },
    pendingGameplayActionRef: { current: null },
    logicalGameplayActionRef: { current: null },
    draggingStateRef: { current: false },
    mpAutoDrawSuppressUntilSequenceRef: { current: null },
    autoTurnActionKeyRef: { current: '' },
    isMutedRef: { current: false },
    dispatchSession: vi.fn(),
    schedulePlayerReadyRef: { current: vi.fn() },
    trySchedulePlayerReadyRef: { current: vi.fn() },
    isMyTurn: true,
    hasPlayMoves: false,
    canDrawNow: false,
    canPass: false,
    myHandLength: 1,
    boneyardCount: 0,
    setError: vi.fn(),
    setActionError: vi.fn(),
    setPendingUiAction: vi.fn(),
    setRematchRequested: vi.fn(),
    setSelectedTile: vi.fn(),
    setDrawStepMyHand: vi.fn(),
    showToast: vi.fn(),
    onGameStart: vi.fn(),
    appendMultiplayerMove: vi.fn(),
    flashLastPlayed: vi.fn(),
    ...overrides,
  };
}

describe('useLiveMatchActions - isGameplayActionBlocked is cosmetic/unblocked on animation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not block and returns false when not blocked', () => {
    const params = makeParams();
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(false);
    expect(params.showToast).not.toHaveBeenCalled();
  });

  it('does NOT block (returns false) when drawSequenceActive is true', () => {
    const params = makeParams({ drawSequenceActive: true });
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(false);
    expect(params.showToast).not.toHaveBeenCalled();
  });

  it('does NOT block (returns false) when flyingTiles is not empty', () => {
    const params = makeParams({
      flyingTiles: [{ x: 0, y: 0, toX: 10, toY: 10, id: 1 }],
    });
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(false);
    expect(params.showToast).not.toHaveBeenCalled();
  });

  it('blocks silently (returns true without toast) when pendingActionRef is true', () => {
    const params = makeParams();
    params.pendingActionRef.current = true;
    const { result } = renderHook(() => useLiveMatchActions(params));

    const blocked = result.current.isGameplayActionBlocked();
    expect(blocked).toBe(true);
    expect(params.showToast).not.toHaveBeenCalled();
  });

  it('reuses PASS requestId when the first ack is lost and the user retries', async () => {
    const logicalGameplayActionRef = { current: null as LogicalGameplayAction | null };
    const params = makeParams({
      legalMoves: [{ type: 'pass' } as any],
      legalMovesRef: { current: [{ type: 'pass' } as any] },
      logicalGameplayActionRef,
    });
    vi.mocked(emitGameAction)
      .mockRejectedValueOnce(new Error('game:action timed out after 8000ms'))
      .mockResolvedValueOnce({ ok: true, sequence: 2, duplicate: true });

    const { result } = renderHook(() => useLiveMatchActions(params));

    await act(async () => {
      await result.current.pass();
    });
    const firstRequestId = vi.mocked(emitGameAction).mock.calls[0][2].requestId;
    expect(logicalGameplayActionRef.current?.requestId).toBe(firstRequestId);
    expect(logicalGameplayActionRef.current?.uncertain).toBe(true);

    await act(async () => {
      await result.current.pass();
    });

    expect(vi.mocked(emitGameAction).mock.calls[1][2].requestId).toBe(firstRequestId);
    expect(logicalGameplayActionRef.current).toBe(null);
  });

  it('reuses MOVE requestId when the first ack is lost and the user retries', async () => {
    const logicalGameplayActionRef = { current: null as LogicalGameplayAction | null };
    const selectedTile = { low: 1, high: 2 };
    const params = makeParams({
      selectedTileRef: { current: selectedTile },
      legalMoves: [{ type: 'play', tile: selectedTile, position: 'right' } as any],
      legalMovesRef: { current: [{ type: 'play', tile: selectedTile, position: 'right' } as any] },
      logicalGameplayActionRef,
    });
    vi.mocked(emitGameAction)
      .mockRejectedValueOnce(new Error('game:action timed out after 8000ms'))
      .mockResolvedValueOnce({ ok: true, sequence: 2, duplicate: true });

    const { result } = renderHook(() => useLiveMatchActions(params));

    await act(async () => {
      await result.current.play('right');
    });
    const firstRequestId = vi.mocked(emitGameAction).mock.calls[0][2].requestId;
    expect(logicalGameplayActionRef.current?.requestId).toBe(firstRequestId);
    expect(logicalGameplayActionRef.current?.uncertain).toBe(true);

    await act(async () => {
      await result.current.play('right');
    });

    expect(vi.mocked(emitGameAction).mock.calls[1][2].requestId).toBe(firstRequestId);
    expect(logicalGameplayActionRef.current).toBe(null);
  });
});
