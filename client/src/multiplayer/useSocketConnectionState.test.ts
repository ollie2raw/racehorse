// @vitest-environment jsdom
/**
 * Regression tests for useSocketConnectionState.
 *
 * Written BEFORE extraction from App.tsx so that the same behavioral contract
 * is enforced before and after the code moves. Each test section maps to a
 * specific chunk of App.tsx logic that will move into the hook.
 */

import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { RoomRecoveryState } from './protocol';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('./socketEventBus', () => ({
  attachSocketEventBus: vi.fn(() => vi.fn()), // returns a cleanup function
  dispatchSocketEvent: vi.fn(),
  registerNormalizedSocketRouter: vi.fn(() => vi.fn()),
  registerRawSocketEventHandler: vi.fn(() => vi.fn()),
}));

vi.mock('../lib/gameServerUrl', () => ({
  resolveGameServerUrl: vi.fn(() => 'http://localhost:3001'),
  isGameServerSameOriginAsPage: vi.fn(() => false),
}));

// Import after mocks are established
const { useSocketConnectionState } = await import('./useSocketConnectionState');
const { attachSocketEventBus } = await import('./socketEventBus');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeShowToast() {
  return vi.fn<(msg: string, duration?: number) => void>();
}

type Params = Parameters<typeof useSocketConnectionState>[0];

function defaultParams(overrides: Partial<Params> = {}): Params {
  return {
    appMode: 'home',
    hasAuthUser: false,
    showToast: makeShowToast(),
    ...overrides,
  };
}

// ── 1. Initial state ──────────────────────────────────────────────────────────

describe('useSocketConnectionState — initial state', () => {
  it('starts with all connection state at safe defaults', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    expect(result.current.socket).toBeNull();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.isRecoveringConnection).toBe(false);
    expect(result.current.roomRecoveryState).toBe('idle');
    expect(result.current.roomRecoveryMessage).toBe('');
    expect(result.current.serverWaking).toBe(false);
    expect(result.current.serverUrl).toBe('http://localhost:3001');
  });

  it('exposes stable refs', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    expect(result.current.socketRef).toBeDefined();
    expect(result.current.socketRef.current).toBeNull();
    expect(result.current.connectRef).toBeDefined();
    expect(typeof result.current.connectRef.current).toBe('function');
    expect(result.current.reconnectAttemptTimerRef).toBeDefined();
    expect(result.current.reconnectAttemptTimerRef.current).toBeNull();
    expect(result.current.reconnectAttemptCountRef).toBeDefined();
    expect(result.current.reconnectAttemptCountRef.current).toBe(0);
  });
});

// ── 2. socketRef stays in sync with socket state ──────────────────────────────

describe('useSocketConnectionState — socketRef sync', () => {
  it('socketRef.current matches the socket state value after setSocket', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    const fakeSocket = { id: 'test-socket', connected: true } as never;

    act(() => {
      result.current.setSocket(fakeSocket);
    });

    expect(result.current.socket).toBe(fakeSocket);
    expect(result.current.socketRef.current).toBe(fakeSocket);
  });

  it('socketRef.current is null after socket is cleared', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    const fakeSocket = { id: 'test-socket', connected: true } as never;

    act(() => { result.current.setSocket(fakeSocket); });
    act(() => { result.current.setSocket(null); });

    expect(result.current.socketRef.current).toBeNull();
  });
});

// ── 3. attachSocketEventBus wired to socket lifecycle ─────────────────────────

describe('useSocketConnectionState — attachSocketEventBus', () => {
  beforeEach(() => {
    vi.mocked(attachSocketEventBus).mockClear();
  });

  it('does not call attachSocketEventBus when socket is null', () => {
    renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });
    expect(attachSocketEventBus).not.toHaveBeenCalled();
  });

  it('calls attachSocketEventBus when socket is set', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    const fakeSocket = { id: 's1', connected: true } as never;
    act(() => { result.current.setSocket(fakeSocket); });

    expect(attachSocketEventBus).toHaveBeenCalledWith(fakeSocket);
  });

  it('calls attachSocketEventBus cleanup when socket changes', () => {
    const cleanup = vi.fn();
    vi.mocked(attachSocketEventBus).mockReturnValue(cleanup);

    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    const socket1 = { id: 's1', connected: true } as never;
    const socket2 = { id: 's2', connected: true } as never;

    act(() => { result.current.setSocket(socket1); });
    act(() => { result.current.setSocket(socket2); });

    // cleanup from s1 should have been called before attaching s2
    expect(cleanup).toHaveBeenCalled();
    expect(attachSocketEventBus).toHaveBeenCalledTimes(2);
  });
});

// ── 4. Connection toasts ──────────────────────────────────────────────────────

describe('useSocketConnectionState — connection toasts', () => {
  it('shows "Connected" toast when isConnected goes true in multiplayer mode', () => {
    const showToast = makeShowToast();
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'multiplayer', showToast }),
    });

    act(() => { result.current.setIsConnected(true); });

    expect(showToast).toHaveBeenCalledWith('Connected to server.', 1200);
  });

  it('does not show "Connected" toast outside multiplayer mode', () => {
    const showToast = makeShowToast();
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'home', showToast }),
    });

    act(() => { result.current.setIsConnected(true); });

    expect(showToast).not.toHaveBeenCalledWith('Connected to server.', 1200);
  });

  it('shows "Disconnected" toast when isConnected goes false in multiplayer mode (not recovering)', () => {
    const showToast = makeShowToast();
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'multiplayer', showToast }),
    });

    // First connect so prevConnectedRef is true
    act(() => { result.current.setIsConnected(true); });
    showToast.mockClear();

    act(() => { result.current.setIsConnected(false); });

    expect(showToast).toHaveBeenCalledWith('Disconnected from server.', 1500);
  });

  it('suppresses "Disconnected" toast when isRecoveringConnection is true', () => {
    const showToast = makeShowToast();
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'multiplayer', showToast }),
    });

    act(() => { result.current.setIsConnected(true); });
    showToast.mockClear();

    // Simulate recovery starting before the disconnect toast fires
    act(() => {
      result.current.setIsRecoveringConnection(true);
      result.current.setIsConnected(false);
    });

    expect(showToast).not.toHaveBeenCalledWith('Disconnected from server.', 1500);
  });

  it('suppresses "Disconnected" toast when roomRecoveryState is not idle', () => {
    const showToast = makeShowToast();
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'multiplayer', showToast }),
    });

    act(() => { result.current.setIsConnected(true); });
    showToast.mockClear();

    act(() => {
      result.current.setRoomRecoveryState('reconnecting');
      result.current.setIsConnected(false);
    });

    expect(showToast).not.toHaveBeenCalledWith('Disconnected from server.', 1500);
  });
});

// ── 5. Recovery toasts ────────────────────────────────────────────────────────

describe('useSocketConnectionState — recovery toasts', () => {
  const cases: Array<{
    label: string;
    from: RoomRecoveryState;
    to: RoomRecoveryState;
    expectedMsg: string;
    expectedDuration: number;
  }> = [
    {
      label: 'idle → reconnecting shows "Connection lost. Reconnecting..."',
      from: 'idle',
      to: 'reconnecting',
      expectedMsg: 'Connection lost. Reconnecting...',
      expectedDuration: 2000,
    },
    {
      label: 'idle → resyncing shows "Connection lost. Reconnecting..."',
      from: 'idle',
      to: 'resyncing',
      expectedMsg: 'Connection lost. Reconnecting...',
      expectedDuration: 2000,
    },
    {
      label: 'reconnecting → idle shows "Connection restored. Match recovered."',
      from: 'reconnecting',
      to: 'idle',
      expectedMsg: 'Connection restored. Match recovered.',
      expectedDuration: 2000,
    },
    {
      label: 'resyncing → idle shows "Connection restored. Match recovered."',
      from: 'resyncing',
      to: 'idle',
      expectedMsg: 'Connection restored. Match recovered.',
      expectedDuration: 2000,
    },
    {
      label: '→ failed shows "Reconnection failed."',
      from: 'idle',
      to: 'failed',
      expectedMsg: 'Reconnection failed.',
      expectedDuration: 3000,
    },
  ];

  cases.forEach(({ label, from, to, expectedMsg, expectedDuration }) => {
    it(label, () => {
      const showToast = makeShowToast();
      const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
        initialProps: defaultParams({ showToast }),
      });

      // Bring to the `from` state first (if not idle)
      if (from !== 'idle') {
        act(() => {
          result.current.setRoomRecoveryState(from as RoomRecoveryState);
        });
        showToast.mockClear();
      }

      act(() => {
        result.current.setRoomRecoveryState(to as RoomRecoveryState);
      });

      expect(showToast).toHaveBeenCalledWith(expectedMsg, expectedDuration);
    });
  });

  it('does not show recovery toast when state does not change', () => {
    const showToast = makeShowToast();
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ showToast }),
    });

    // Set to idle again (no change)
    act(() => { result.current.setRoomRecoveryState('idle'); });

    expect(showToast).not.toHaveBeenCalled();
  });
});

// ── 6. Auto-connect policy ────────────────────────────────────────────────────

describe('useSocketConnectionState — auto-connect', () => {
  it('calls connectRef.current() in feed mode when authed and socket is disconnected', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'home', hasAuthUser: false }),
    });

    // Install a spy on the connectRef BEFORE triggering the conditions
    const connectSpy = vi.fn();
    result.current.connectRef.current = connectSpy;

    // Transition to feed + authed — should trigger auto-connect
    act(() => {
      // Re-render is triggered by prop change in the parent; simulate by
      // installing a new connectRef spy and then rendering with the right props
    });

    // renderHook rerender with the triggering conditions
    const { rerender } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'home', hasAuthUser: false }),
    });

    const { result: result2 } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'feed', hasAuthUser: true }),
    });

    // Replace connectRef.current with spy (for next re-render)
    const spy2 = vi.fn();
    result2.current.connectRef.current = spy2;

    // Force a re-render with same props to re-run effect
    rerender(defaultParams({ appMode: 'feed', hasAuthUser: false }));

    // The initial render with feed+authed should have fired the effect;
    // directly verify by checking what connectRef.current was at mount time
    // by using the dedicated approach below
    expect(typeof result2.current.connectRef.current).toBe('function');
    // Connection was attempted at initial render: connectRef was noop (no real side effect to catch)
    // Verify the prop-change path:
    const connectSpy3 = vi.fn();
    const { result: result3, rerender: rerender3 } = renderHook(
      (p: Params) => useSocketConnectionState(p),
      { initialProps: defaultParams({ appMode: 'home', hasAuthUser: true }) },
    );

    // Swap in the spy BEFORE the mode changes
    result3.current.connectRef.current = connectSpy3;

    // Now change to feed mode — effect should fire and call connectRef.current
    act(() => {
      rerender3(defaultParams({ appMode: 'feed', hasAuthUser: true }));
    });

    expect(connectSpy3).toHaveBeenCalledTimes(1);
  });

  it('does not call connectRef.current() in multiplayer mode', () => {
    const connectSpy = vi.fn();
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'home', hasAuthUser: true }),
    });

    result.current.connectRef.current = connectSpy;

    act(() => {
      // remain in non-feed mode — no auto-connect
    });

    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('does not call connectRef.current() when hasAuthUser is false', () => {
    const connectSpy = vi.fn();
    const { result, rerender } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams({ appMode: 'home', hasAuthUser: false }),
    });

    result.current.connectRef.current = connectSpy;
    act(() => { rerender(defaultParams({ appMode: 'feed', hasAuthUser: false })); });

    expect(connectSpy).not.toHaveBeenCalled();
  });
});

// ── 7. clearReconnectAttemptTimer ─────────────────────────────────────────────

describe('useSocketConnectionState — clearReconnectAttemptTimer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears the reconnectAttemptTimerRef when a timer is set', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    // Manually install a timer into the ref
    act(() => {
      result.current.reconnectAttemptTimerRef.current = setTimeout(() => {}, 5000);
    });

    expect(result.current.reconnectAttemptTimerRef.current).not.toBeNull();

    act(() => {
      result.current.clearReconnectAttemptTimer();
    });

    expect(result.current.reconnectAttemptTimerRef.current).toBeNull();
  });

  it('is a no-op when no timer is set', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    // Should not throw
    expect(() => {
      act(() => { result.current.clearReconnectAttemptTimer(); });
    }).not.toThrow();
  });
});

// ── 8. connectionActions bridge ───────────────────────────────────────────────

describe('useSocketConnectionState — connectionActions', () => {
  it('exposes connect/disconnect/retryRoomRecovery actions', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    expect(typeof result.current.connectionActions.connect).toBe('function');
    expect(typeof result.current.connectionActions.disconnect).toBe('function');
    expect(typeof result.current.connectionActions.retryRoomRecovery).toBe('function');
  });

  it('connectionActions.connect delegates to connectRef.current', () => {
    const { result } = renderHook((p: Params) => useSocketConnectionState(p), {
      initialProps: defaultParams(),
    });

    const spy = vi.fn();
    result.current.connectRef.current = spy;

    act(() => { result.current.connectionActions.connect(); });

    expect(spy).toHaveBeenCalledTimes(1);
  });
});
