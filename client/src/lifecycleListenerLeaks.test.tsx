// @vitest-environment jsdom
/**
 * Native lifecycle hygiene: a user who repeatedly opens a screen, backgrounds the app, resumes and leaves must not accumulate
 * window/document listeners or intervals. Each lifecycle-sensitive hook is mounted and unmounted several times; afterwards the
 * NET number of listeners (per event type) and live intervals must be zero, and the auth subscription must be released each time.
 */
import { act, render, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const unsubscribe = vi.fn();
vi.mock('./lib/supabase', () => ({
  isSupabaseConfigured: true,
  getSupabaseConfigError: () => null,
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe } } }),
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  },
}));
vi.mock('./lib/analytics', () => ({ identifyUser: vi.fn(), resetAnalytics: vi.fn(), track: vi.fn() }));
vi.mock('./auth/e2eDevAuth', () => ({ readE2eDevAuth: () => null, readMobileVisualIdentity: () => null }));

const { AuthProvider } = await import('./auth/useAuth');
const { useNetworkStatus } = await import('./hooks/useNetworkStatus');
const { useFriendSocketReachability } = await import('./multiplayer/useFriendSocketReachability');

const CYCLES = 5;
const net = new Map<string, number>();
const intervals = new Set<number>();
let restore: Array<() => void> = [];

function track(target: EventTarget, label: string): void {
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  const keyOf = (type: string) => `${label}:${type}`;
  const registered = new Map<string, Set<unknown>>();
  target.addEventListener = ((type: string, listener: unknown, options?: unknown) => {
    const set = registered.get(keyOf(type)) ?? new Set();
    if (!set.has(listener)) {
      set.add(listener);
      registered.set(keyOf(type), set);
      net.set(keyOf(type), (net.get(keyOf(type)) ?? 0) + 1);
    }
    return add(type, listener as EventListener, options as AddEventListenerOptions);
  }) as typeof target.addEventListener;
  target.removeEventListener = ((type: string, listener: unknown, options?: unknown) => {
    const set = registered.get(keyOf(type));
    if (set?.delete(listener)) net.set(keyOf(type), (net.get(keyOf(type)) ?? 1) - 1);
    return remove(type, listener as EventListener, options as EventListenerOptions);
  }) as typeof target.removeEventListener;
  restore.push(() => {
    target.addEventListener = add as typeof target.addEventListener;
    target.removeEventListener = remove as typeof target.removeEventListener;
  });
}

beforeEach(() => {
  net.clear();
  intervals.clear();
  unsubscribe.mockClear();
  restore = [];
  const realSet = window.setInterval.bind(window);
  const realClear = window.clearInterval.bind(window);
  window.setInterval = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    const id = realSet(handler, ms, ...args) as unknown as number;
    intervals.add(id);
    return id;
  }) as typeof window.setInterval;
  window.clearInterval = ((id?: number) => {
    intervals.delete(id as number);
    realClear(id);
  }) as typeof window.clearInterval;
  restore.push(() => { window.setInterval = realSet as typeof window.setInterval; window.clearInterval = realClear as typeof window.clearInterval; });
  track(window, 'window');
  track(document, 'document');
});
afterEach(() => restore.forEach((fn) => fn()));

/** Only the lifecycle-sensitive event types this app owns (React DOM installs its own one-time listeners, e.g. selectionchange). */
const LIFECYCLE_EVENTS = /:(visibilitychange|pagehide|pageshow|online|offline|focus|blur|resize|orientationchange|freeze|resume|beforeunload)$/;
const leaked = () => [...net.entries()].filter(([key, count]) => LIFECYCLE_EVENTS.test(key) && count !== 0);

describe('open -> background -> resume -> leave, repeated: nothing accumulates', () => {
  it('useNetworkStatus', () => {
    for (let i = 0; i < CYCLES; i += 1) {
      const view = renderHook(() => useNetworkStatus());
      act(() => { window.dispatchEvent(new Event('offline')); document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); });
      view.unmount();
    }
    expect(leaked()).toEqual([]);
    expect(intervals.size).toBe(0);
  });

  it('AuthProvider: visibility listener and auth subscription are released on every unmount', async () => {
    for (let i = 0; i < CYCLES; i += 1) {
      const view = render(React.createElement(AuthProvider, null, React.createElement('div')));
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      view.unmount();
    }
    expect(unsubscribe).toHaveBeenCalledTimes(CYCLES);
    expect(leaked()).toEqual([]);
    expect(intervals.size).toBe(0);
  });

  it('useFriendSocketReachability', () => {
    for (let i = 0; i < CYCLES; i += 1) {
      const view = renderHook(() => useFriendSocketReachability({ socket: null, userIds: ['a'], enabled: false }));
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      view.unmount();
    }
    expect(leaked()).toEqual([]);
    expect(intervals.size).toBe(0);
  });

  it('the harness really detects a leak (negative control)', () => {
    const handler = () => undefined;
    window.addEventListener('pageshow', handler);
    window.setInterval(() => undefined, 60_000);
    expect(leaked()).toEqual([['window:pageshow', 1]]);
    expect(intervals.size).toBe(1);
    window.removeEventListener('pageshow', handler);
    intervals.forEach((id) => window.clearInterval(id));
  });
});
