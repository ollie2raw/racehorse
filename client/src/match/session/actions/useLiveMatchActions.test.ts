// @vitest-environment jsdom
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

  it('resyncs when server returns uncertain after mutate-then-persist failure', async () => {
    const logicalGameplayActionRef = { current: null as LogicalGameplayAction | null };
    const fetchGameState = vi.fn(async () => true);
    const selectedTile = { low: 3, high: 4 };
    const params = makeParams({
      selectedTileRef: { current: selectedTile },
      legalMoves: [{ type: 'play', tile: selectedTile, position: 'left' } as any],
      legalMovesRef: { current: [{ type: 'play', tile: selectedTile, position: 'left' } as any] },
      logicalGameplayActionRef,
      fetchGameState,
    });
    vi.mocked(emitGameAction).mockResolvedValueOnce({
      ok: false,
      uncertain: true,
      error: "Move couldn't be saved — try again.",
      sequence: 17,
    });

    const { result } = renderHook(() => useLiveMatchActions(params));

    await act(async () => {
      await result.current.play('left');
    });

    expect(logicalGameplayActionRef.current?.uncertain).toBe(true);
    expect(fetchGameState).toHaveBeenCalledWith('game_action_uncertain');
    expect(params.showToast).toHaveBeenCalledWith("Move couldn't be saved — try again.", 2500);
  });

  // MP-JIT-2 — required cases: optimistic apply on the happy path (committed, no
  // rollback), and rollback on a rejected move.
  describe('MP-JIT-2 optimistic MOVE', () => {
    const selectedTile = { low: 1, high: 2 };
    function optimisticParams(
      overrides: Partial<UseLiveMatchActionsParams> = {},
      turnRetained = false,
    ) {
      const rollback = vi.fn();
      const applyOptimisticPlay = vi.fn(() => ({ rollback, turnRetained }));
      const commitOptimisticAction = vi.fn();
      const params = makeParams({
        selectedTileRef: { current: selectedTile },
        legalMoves: [{ type: 'play', tile: selectedTile, position: 'left' } as any],
        legalMovesRef: { current: [{ type: 'play', tile: selectedTile, position: 'left' } as any] },
        applyOptimisticPlay,
        commitOptimisticAction,
        ...overrides,
      });
      return { params, applyOptimisticPlay, commitOptimisticAction, rollback };
    }

    it('legal-move happy path: optimistic apply is committed, never rolled back, tile flashes once', async () => {
      const { params, applyOptimisticPlay, commitOptimisticAction, rollback } = optimisticParams();
      vi.mocked(emitGameAction).mockResolvedValueOnce({ ok: true, sequence: 5 });

      const { result } = renderHook(() => useLiveMatchActions(params));
      await act(async () => {
        await result.current.play('left');
      });

      expect(applyOptimisticPlay).toHaveBeenCalledWith(
        selectedTile,
        'left',
        expect.any(String),
      );
      expect(commitOptimisticAction).toHaveBeenCalledWith(expect.any(String));
      expect(rollback).not.toHaveBeenCalled();
      expect(params.flashLastPlayed).toHaveBeenCalledTimes(1);
    });

    it('rejected move: optimistic apply is rolled back, not committed, error surfaced', async () => {
      const { params, commitOptimisticAction, rollback } = optimisticParams();
      vi.mocked(emitGameAction).mockResolvedValueOnce({ ok: false, error: 'It is not your turn.' });

      const { result } = renderHook(() => useLiveMatchActions(params));
      await act(async () => {
        await result.current.play('left');
      });

      expect(rollback).toHaveBeenCalledTimes(1);
      expect(commitOptimisticAction).not.toHaveBeenCalled();
      expect(params.setActionError).toHaveBeenCalledWith('It is not your turn.');
    });

    // Step 2 — a continued-turn scoring/double play releases the pending lock
    // immediately (the player can play their next tile without a round-trip);
    // a normal turn-passing play does not.
    it('continued-turn play (turnRetained) clears the pending-UI lock before the ack', async () => {
      const { params } = optimisticParams({}, true);
      let resolveAck: (v: unknown) => void = () => {};
      vi.mocked(emitGameAction).mockReturnValueOnce(
        new Promise((r) => {
          resolveAck = r;
        }) as Promise<any>,
      );

      const { result } = renderHook(() => useLiveMatchActions(params));
      let done: Promise<void>;
      await act(async () => {
        done = result.current.play('left');
        // let the sync body + optimistic apply run
        await Promise.resolve();
      });

      // pending 'play' cleared via the function-updater BEFORE the ack resolves
      const fnClears = vi
        .mocked(params.setPendingUiAction)
        .mock.calls.filter(([a]) => typeof a === 'function');
      expect(fnClears.length).toBeGreaterThanOrEqual(1);

      await act(async () => {
        resolveAck({ ok: true, sequence: 5 });
        await done;
      });
    });

    it('normal turn-passing play does NOT release the lock early', async () => {
      const { params } = optimisticParams({}, false);
      let resolveAck: (v: unknown) => void = () => {};
      vi.mocked(emitGameAction).mockReturnValueOnce(
        new Promise((r) => {
          resolveAck = r;
        }) as Promise<any>,
      );

      const { result } = renderHook(() => useLiveMatchActions(params));
      let done: Promise<void>;
      await act(async () => {
        done = result.current.play('left');
        await Promise.resolve();
      });

      const fnClears = vi
        .mocked(params.setPendingUiAction)
        .mock.calls.filter(([a]) => typeof a === 'function');
      expect(fnClears.length).toBe(0); // only the finally clears it, after the ack

      await act(async () => {
        resolveAck({ ok: true, sequence: 5 });
        await done;
      });
    });

    it('uncertain ack: rolls back, then resyncs via the existing machinery', async () => {
      const fetchGameState = vi.fn(async () => true);
      const { params, commitOptimisticAction, rollback } = optimisticParams({ fetchGameState });
      vi.mocked(emitGameAction).mockResolvedValueOnce({
        ok: false,
        uncertain: true,
        error: "Move couldn't be saved — try again.",
      });

      const { result } = renderHook(() => useLiveMatchActions(params));
      await act(async () => {
        await result.current.play('left');
      });

      expect(rollback).toHaveBeenCalledTimes(1);
      expect(commitOptimisticAction).not.toHaveBeenCalled();
      expect(fetchGameState).toHaveBeenCalledWith('game_action_uncertain');
    });
  });

  // MP-JIT-2 step 3 — required cases for PASS: legal-pass happy path and
  // rejected-pass rollback (mirroring MOVE).
  describe('MP-JIT-2 optimistic PASS', () => {
    function passParams(overrides: Partial<UseLiveMatchActionsParams> = {}) {
      const rollback = vi.fn();
      const applyOptimisticPass = vi.fn(() => ({ rollback }));
      const commitOptimisticAction = vi.fn();
      const params = makeParams({
        legalMoves: [{ type: 'pass' } as any],
        legalMovesRef: { current: [{ type: 'pass' } as any] },
        applyOptimisticPass,
        commitOptimisticAction,
        ...overrides,
      });
      return { params, applyOptimisticPass, commitOptimisticAction, rollback };
    }

    it('legal-pass happy path: optimistic pass committed, never rolled back', async () => {
      const { params, applyOptimisticPass, commitOptimisticAction, rollback } = passParams();
      vi.mocked(emitGameAction).mockResolvedValueOnce({ ok: true, sequence: 3 });

      const { result } = renderHook(() => useLiveMatchActions(params));
      await act(async () => {
        await result.current.pass();
      });

      expect(applyOptimisticPass).toHaveBeenCalledWith(expect.any(String));
      expect(commitOptimisticAction).toHaveBeenCalledWith(expect.any(String));
      expect(rollback).not.toHaveBeenCalled();
    });

    it('rejected pass: optimistic pass rolled back, not committed, error surfaced', async () => {
      const { params, commitOptimisticAction, rollback } = passParams();
      vi.mocked(emitGameAction).mockResolvedValueOnce({ ok: false, error: 'You have a legal play.' });

      const { result } = renderHook(() => useLiveMatchActions(params));
      await act(async () => {
        await result.current.pass();
      });

      expect(rollback).toHaveBeenCalledTimes(1);
      expect(commitOptimisticAction).not.toHaveBeenCalled();
      expect(params.setActionError).toHaveBeenCalledWith('You have a legal play.');
    });
  });

  // MP-JIT-2 step 4 — DRAW: immediate face-down placeholder on click (visual
  // only, no engine prediction, no rollback state).
  describe('MP-JIT-2 DRAW placeholder', () => {
    const drawState = () =>
      makeState({
        boneyard: [
          { low: 0, high: 0 },
          { low: 1, high: 1 },
          { low: 2, high: 2 },
          { low: 3, high: 3 },
        ],
        players: {
          [YOU]: { id: YOU, hand: [{ low: 1, high: 2 }, { low: 3, high: 4 }], score: 0 },
          [OPP]: { id: OPP, hand: [], score: 0 },
        },
      });

    function drawParams(overrides: Partial<UseLiveMatchActionsParams> = {}) {
      const setDrawStepMyHand = vi.fn();
      const setDrawPulseIndex = vi.fn();
      const params = makeParams({
        canDraw: true,
        state: drawState(),
        stateRef: { current: drawState() },
        legalMovesRef: { current: [] },
        setDrawStepMyHand,
        setDrawPulseIndex,
        ...overrides,
      });
      return { params, setDrawStepMyHand, setDrawPulseIndex };
    }

    it('shows a face-down placeholder in the hand on click; the hook does not clear it on the success path', async () => {
      const { params, setDrawStepMyHand, setDrawPulseIndex } = drawParams();
      vi.mocked(emitGameAction).mockResolvedValueOnce({ ok: true, sequence: 3 });

      const { result } = renderHook(() => useLiveMatchActions(params));
      await act(async () => {
        await result.current.draw();
      });

      expect(setDrawStepMyHand).toHaveBeenCalledWith([
        { low: 1, high: 2 },
        { low: 3, high: 4 },
        { low: -1, high: -1 },
      ]);
      expect(setDrawPulseIndex).toHaveBeenCalledWith(2);
      expect(setDrawStepMyHand).not.toHaveBeenCalledWith(null);
    });

    it('clears the placeholder on a rejected draw', async () => {
      const { params, setDrawStepMyHand, setDrawPulseIndex } = drawParams();
      vi.mocked(emitGameAction).mockResolvedValueOnce({ ok: false, error: 'Boneyard locked' });

      const { result } = renderHook(() => useLiveMatchActions(params));
      await act(async () => {
        await result.current.draw();
      });

      expect(setDrawStepMyHand).toHaveBeenCalledWith(null);
      expect(setDrawPulseIndex).toHaveBeenCalledWith(null);
      expect(params.setActionError).toHaveBeenCalledWith('Boneyard locked');
    });
  });
});
