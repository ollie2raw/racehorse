/**
 * Regression tests for useSocialInviteState.
 *
 * Written BEFORE extraction from App.tsx. Covers friendInvite state + 60s
 * auto-expiry, outboundChallenge state + deadline expiry + room-fill clear,
 * and the friend:invited / friend:invite:declined socket event handlers.
 */

import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FriendInvitePayload, OutboundChallenge } from './friendChallenge';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('./socketEventBus', () => ({
  registerRawSocketEventHandler: vi.fn(() => vi.fn()),
  attachSocketEventBus: vi.fn(() => vi.fn()),
  dispatchSocketEvent: vi.fn(),
  registerNormalizedSocketRouter: vi.fn(() => vi.fn()),
}));

const { useSocialInviteState } = await import('./useSocialInviteState');
const { registerRawSocketEventHandler } = await import('./socketEventBus');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeShowToast() {
  return vi.fn<(msg: string, duration?: number) => void>();
}

function makeInvite(overrides: Partial<FriendInvitePayload> = {}): FriendInvitePayload {
  return {
    inviteId: 'inv-1',
    fromUsername: 'alice',
    fromUserId: 'uid-alice',
    roomCode: 'ROOM1',
    inviteUrl: 'https://example.com/join/ROOM1',
    matchSummary: '7-Tile · First to 60 · Untimed',
    ...overrides,
  };
}

function makeChallenge(overrides: Partial<OutboundChallenge> = {}): OutboundChallenge {
  return {
    inviteId: 'inv-out-1',
    friendUserId: 'uid-bob',
    friendUsername: 'bob',
    roomCode: 'ROOM2',
    matchSummary: '7-Tile · First to 60 · Untimed',
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

type Params = Parameters<typeof useSocialInviteState>[0];

function defaultParams(overrides: Partial<Params> = {}): Params {
  return {
    playerCount: 0,
    showToast: makeShowToast(),
    ...overrides,
  };
}

// Captures the raw socket handler registered for a given event name.
// registerRawSocketEventHandler is called once per event per effect run.
function captureSocketHandler(eventName: string) {
  const calls = vi.mocked(registerRawSocketEventHandler).mock.calls;
  const match = [...calls].reverse().find(([name]) => name === eventName);
  return match?.[1] as ((payload: unknown) => void) | undefined;
}

// ── 1. Initial state ──────────────────────────────────────────────────────────

describe('useSocialInviteState — initial state', () => {
  it('starts with both invite states null', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });

    expect(result.current.friendInvite).toBeNull();
    expect(result.current.outboundChallenge).toBeNull();
  });

  it('exposes setters and clearOutboundChallenge', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });

    expect(typeof result.current.setFriendInvite).toBe('function');
    expect(typeof result.current.setOutboundChallenge).toBe('function');
    expect(typeof result.current.clearOutboundChallenge).toBe('function');
  });
});

// ── 2. friendInvite 60s auto-expiry ──────────────────────────────────────────

describe('useSocialInviteState — friendInvite auto-expiry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears friendInvite after 60 seconds', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });

    act(() => { result.current.setFriendInvite(makeInvite()); });
    expect(result.current.friendInvite).not.toBeNull();

    act(() => { vi.advanceTimersByTime(60_000); });

    expect(result.current.friendInvite).toBeNull();
  });

  it('does not start a timer when friendInvite is null', () => {
    renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });
    // No timer should fire — just verify no throw
    act(() => { vi.advanceTimersByTime(60_000); });
  });

  it('resets the 60s timer when a new invite replaces the old one', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });

    act(() => { result.current.setFriendInvite(makeInvite({ inviteId: 'inv-A' })); });

    // Advance 40s — invite should still be present
    act(() => { vi.advanceTimersByTime(40_000); });
    expect(result.current.friendInvite?.inviteId).toBe('inv-A');

    // Replace with a new invite — timer resets
    act(() => { result.current.setFriendInvite(makeInvite({ inviteId: 'inv-B' })); });

    // Advance another 40s — total 80s from first invite, but only 40s from second
    act(() => { vi.advanceTimersByTime(40_000); });
    expect(result.current.friendInvite?.inviteId).toBe('inv-B');

    // Now the second invite expires
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(result.current.friendInvite).toBeNull();
  });
});

// ── 3. outboundChallenge deadline expiry ─────────────────────────────────────

describe('useSocialInviteState — outboundChallenge expiry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('clears outboundChallenge at its expiresAt deadline', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });

    const challenge = makeChallenge({ expiresAt: Date.now() + 5_000 });
    act(() => { result.current.setOutboundChallenge(challenge); });
    expect(result.current.outboundChallenge).not.toBeNull();

    act(() => { vi.advanceTimersByTime(5_000); });

    expect(result.current.outboundChallenge).toBeNull();
  });

  it('does not clear a different challenge (stale timer guard)', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });

    const challengeA = makeChallenge({ inviteId: 'inv-A', expiresAt: Date.now() + 3_000 });
    act(() => { result.current.setOutboundChallenge(challengeA); });

    // Replace before timer fires
    const challengeB = makeChallenge({ inviteId: 'inv-B', expiresAt: Date.now() + 10_000 });
    act(() => { result.current.setOutboundChallenge(challengeB); });

    // Timer for A fires — should not clear B
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(result.current.outboundChallenge?.inviteId).toBe('inv-B');
  });

  it('clearOutboundChallenge nulls the challenge immediately', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });

    act(() => { result.current.setOutboundChallenge(makeChallenge()); });
    expect(result.current.outboundChallenge).not.toBeNull();

    act(() => { result.current.clearOutboundChallenge(); });
    expect(result.current.outboundChallenge).toBeNull();
  });
});

// ── 4. outboundChallenge clear on room fill ───────────────────────────────────

describe('useSocialInviteState — outboundChallenge room-fill clear', () => {
  it('clears outboundChallenge when playerCount reaches 2', () => {
    const { result, rerender } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams({ playerCount: 1 }),
    });

    act(() => { result.current.setOutboundChallenge(makeChallenge()); });
    expect(result.current.outboundChallenge).not.toBeNull();

    act(() => { rerender(defaultParams({ playerCount: 2 })); });

    expect(result.current.outboundChallenge).toBeNull();
  });

  it('does not clear outboundChallenge when playerCount is still 1', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams({ playerCount: 1 }),
    });

    act(() => { result.current.setOutboundChallenge(makeChallenge()); });
    expect(result.current.outboundChallenge).not.toBeNull();
  });
});

// ── 5. Socket event: friend:invited ──────────────────────────────────────────

describe('useSocialInviteState — friend:invited socket event', () => {
  beforeEach(() => {
    vi.mocked(registerRawSocketEventHandler).mockClear();
  });

  it('sets friendInvite when friend:invited fires', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });

    const handler = captureSocketHandler('friend:invited');
    expect(handler).toBeDefined();

    act(() => {
      handler!({
        inviteId: 'inv-42',
        fromUsername: 'carol',
        fromUserId: 'uid-carol',
        roomCode: 'ABCD',
        inviteUrl: 'https://example.com/join/ABCD',
        matchSummary: '7-Tile · First to 60 · Untimed',
      });
    });

    expect(result.current.friendInvite).toMatchObject({
      inviteId: 'inv-42',
      fromUsername: 'carol',
      roomCode: 'ABCD',
    });
  });

  it('generates a fallback inviteId when none is provided', () => {
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams(),
    });

    const handler = captureSocketHandler('friend:invited');

    act(() => {
      handler!({
        fromUsername: 'dave',
        roomCode: 'XYZA',
        inviteUrl: 'https://example.com/join/XYZA',
      });
    });

    expect(result.current.friendInvite?.inviteId).toMatch(/XYZA/);
  });
});

// ── 6. Socket event: friend:invite:declined ───────────────────────────────────

describe('useSocialInviteState — friend:invite:declined socket event', () => {
  beforeEach(() => {
    vi.mocked(registerRawSocketEventHandler).mockClear();
  });

  it('clears outboundChallenge and shows toast when declined', () => {
    const showToast = makeShowToast();
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams({ showToast }),
    });

    act(() => {
      result.current.setOutboundChallenge(makeChallenge({
        inviteId: 'inv-out-1',
        friendUsername: 'bob',
      }));
    });

    const handler = captureSocketHandler('friend:invite:declined');
    expect(handler).toBeDefined();

    act(() => {
      handler!({ inviteId: 'inv-out-1', fromUsername: 'bob' });
    });

    expect(result.current.outboundChallenge).toBeNull();
    expect(showToast).toHaveBeenCalledWith('bob declined the challenge.', 2400);
  });

  it('does not clear a different outboundChallenge (inviteId mismatch)', () => {
    const showToast = makeShowToast();
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams({ showToast }),
    });

    act(() => {
      result.current.setOutboundChallenge(makeChallenge({ inviteId: 'inv-mine' }));
    });

    const handler = captureSocketHandler('friend:invite:declined');

    act(() => {
      handler!({ inviteId: 'inv-someone-elses', fromUsername: 'eve' });
    });

    expect(result.current.outboundChallenge?.inviteId).toBe('inv-mine');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('uses friendUsername from challenge when fromUsername is absent', () => {
    const showToast = makeShowToast();
    const { result } = renderHook((p: Params) => useSocialInviteState(p), {
      initialProps: defaultParams({ showToast }),
    });

    act(() => {
      result.current.setOutboundChallenge(makeChallenge({
        inviteId: 'inv-out-2',
        friendUsername: 'frank',
      }));
    });

    const handler = captureSocketHandler('friend:invite:declined');

    act(() => {
      handler!({ inviteId: 'inv-out-2' }); // no fromUsername
    });

    expect(showToast).toHaveBeenCalledWith('frank declined the challenge.', 2400);
  });
});
