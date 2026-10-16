// @vitest-environment jsdom
/**
 * A -> B and A -> guest -> B WITHOUT a page reload, through the real AuthProvider (useAuth), the real account-bound
 * storage modules and the real presence re-identify decision. Only Supabase and analytics are faked.
 *
 * What is asserted is not just "cleaned up eventually": a probe consumer records what it can read in EVERY render and
 * EVERY (child) effect in which B is the active principal, so any frame that shows B next to A's account-bound state
 * fails — including the frame between `setUser(B)` and a provider effect.
 */
import { act, render } from '@testing-library/react';
import React, { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';

type AuthCallback = (event: AuthChangeEvent, session: Session | null) => Promise<void> | void;
const h = vi.hoisted(() => ({
  callback: null as null | ((event: string, session: unknown) => Promise<void> | void),
  /** Held profile responses per user id, resolved by the test to model a slow response for the OLD account. */
  held: new Map<string, { promise: Promise<unknown>; release: () => void }>(),
  holdProfileFor: new Set<string>(),
}));

vi.mock('../lib/supabase', () => {
  const profileRow = (id: string) => ({
    id,
    username: `name_${id.slice(0, 4)}`,
    created_at: '2026-01-01T00:00:00Z',
    glicko_rating: 1500,
    glicko_rd: 100,
    glicko_vol: 0.06,
    provisional: false,
    peak_rating: 1500,
    ranked_games_played: 9,
  });
  return {
    isSupabaseConfigured: true,
    getSupabaseConfigError: () => null,
    supabase: {
      auth: {
        getSession: () => Promise.resolve({ data: { session: null } }),
        onAuthStateChange: (cb: AuthCallback) => {
          h.callback = cb as never;
          return { data: { subscription: { unsubscribe: vi.fn() } } };
        },
        signOut: () => Promise.resolve({ error: null }),
      },
      from: (table: string) => ({
        select: (cols: string) => ({
          eq: (_col: string, id: string) => ({
            maybeSingle: () => {
              if (table === 'profiles' && cols.includes('glicko_rating')) {
                if (h.holdProfileFor.has(id)) {
                  let release!: () => void;
                  const promise = new Promise<unknown>((resolve) => {
                    release = () => resolve({ data: profileRow(id), error: null });
                  });
                  h.held.set(id, { promise, release });
                  return promise;
                }
                return Promise.resolve({ data: profileRow(id), error: null });
              }
              if (table === 'profiles') return Promise.resolve({ data: { id }, error: null });
              return Promise.resolve({ data: null, error: null });
            },
          }),
        }),
      }),
    },
  };
});
vi.mock('../lib/analytics', () => ({ identifyUser: vi.fn(), resetAnalytics: vi.fn(), track: vi.fn() }));
vi.mock('./e2eDevAuth', () => ({ readE2eDevAuth: () => null, readMobileVisualIdentity: () => null }));

import { AuthProvider, useAuth } from './useAuth';
import { peekCachedSession } from './sessionToken';
import { presenceIdentifyForAuthChange, type PresenceIdentifyPayload } from '../multiplayer/presenceIdentifyOnAuthChange';
import { GUEST_ID_STORAGE_KEY, readLastRoomCode, saveLastRoomCode } from '../match/recovery/matchRecovery';
import { readFritzSession, saveFritzSessionMatchId, saveFritzSessionVerifiedMatchId } from '../modules/ghost/fritzSessionStorage';
import { DAILY_FRITZ_TODAY_CACHE_PREFIX } from '../dailyFritz/clientStorage';

const A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const userOf = (id: string) => ({ id, aud: 'authenticated', role: 'authenticated', email: `${id.slice(0, 4)}@example.test` }) as User;
const sessionOf = (id: string) => ({ access_token: `token-${id.slice(0, 4)}`, refresh_token: 'r', user: userOf(id) }) as unknown as Session;

const DF_SNAPSHOT_KEY = 'racehorse:daily-fritz:attempt-of-A:1';
const ADMIN_KEY = 'racehorse:daily-fritz-admin-key';

function seedAccountA() {
  saveLastRoomCode('ROOMA1');
  saveFritzSessionMatchId('local-match-of-A');
  saveFritzSessionVerifiedMatchId('verified-match-of-A');
  window.localStorage.setItem(DF_SNAPSHOT_KEY, JSON.stringify({ attemptId: 'attempt-of-A', checkpoint: 'A-hand-3' }));
  window.sessionStorage.setItem(`${DAILY_FRITZ_TODAY_CACHE_PREFIX}${A_ID}`, JSON.stringify({ attempt_id: 'attempt-of-A' }));
  window.sessionStorage.setItem(ADMIN_KEY, 'admin-secret-A');
  // deliberately account-independent: must survive
  window.localStorage.setItem(GUEST_ID_STORAGE_KEY, 'guest_browser_identity');
  window.localStorage.setItem('racehorse_bot_deal_size', '7');
  window.localStorage.setItem('racehorse:journey:progress', '{"world":3}');
}

type Frame = {
  phase: 'render' | 'effect';
  uid: string | null;
  profileId: string | null;
  room: string;
  fritz: string | null;
  snapshot: string | null;
  today: string | null;
  admin: string | null;
};
let frames: Frame[] = [];
let emitted: PresenceIdentifyPayload[] = [];

function readFrame(phase: Frame['phase'], uid: string | null, profileId: string | null): Frame {
  return {
    phase,
    uid,
    profileId,
    room: readLastRoomCode(),
    fritz: JSON.stringify(readFritzSession()),
    snapshot: window.localStorage.getItem(DF_SNAPSHOT_KEY),
    today: window.sessionStorage.getItem(`${DAILY_FRITZ_TODAY_CACHE_PREFIX}${A_ID}`),
    admin: window.sessionStorage.getItem(ADMIN_KEY),
  };
}

/** Stands in for any screen/hook that reads account-bound state while it renders or in an effect. */
function Probe() {
  const { user, profile, accessToken } = useAuth();
  const uid = user?.id ?? null;
  frames.push(readFrame('render', uid, profile?.id ?? null));
  useEffect(() => {
    frames.push(readFrame('effect', uid, profile?.id ?? null));
  });
  // The same decision useMultiplayerConnection makes when the auth fingerprint changes on a connected socket.
  const fingerprint = [uid ?? '', user?.email ?? '', profile?.username ?? '', accessToken ?? ''].join('|');
  const prev = React.useRef<string | null>(null);
  useEffect(() => {
    const previous = prev.current;
    prev.current = fingerprint;
    if (previous === null || previous === fingerprint) return;
    const payload = presenceIdentifyForAuthChange({ previousFingerprint: previous, userId: uid, username: profile?.username ?? 'Player', authToken: accessToken });
    if (payload) emitted.push(payload);
  }, [fingerprint, uid, profile?.username, accessToken]);
  return null;
}

async function fire(event: AuthChangeEvent, session: Session | null) {
  await act(async () => {
    await h.callback?.(event, session);
  });
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function expectNoAAfterBFrames() {
  const bFrames = frames.filter((f) => f.uid === B_ID);
  expect(bFrames.length).toBeGreaterThan(0);
  for (const f of bFrames) {
    expect(f, `${f.phase} frame with B active`).toMatchObject({ room: '', fritz: 'null', snapshot: null, today: null, admin: null });
    expect(f.profileId === null || f.profileId === B_ID, `profile shown with B active: ${f.profileId}`).toBe(true);
  }
}
function expectAccountIndependentStateKept() {
  expect(window.localStorage.getItem(GUEST_ID_STORAGE_KEY)).toBe('guest_browser_identity');
  expect(window.localStorage.getItem('racehorse_bot_deal_size')).toBe('7');
  expect(window.localStorage.getItem('racehorse:journey:progress')).toBe('{"world":3}');
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  frames = [];
  emitted = [];
  h.callback = null;
  h.held.clear();
  h.holdProfileFor.clear();
});
afterEach(() => vi.restoreAllMocks());

async function mountSignedInAs(id: string) {
  const view = render(React.createElement(AuthProvider, null, React.createElement(Probe)));
  await flush();
  await fire('SIGNED_IN', sessionOf(id));
  await flush();
  return view;
}

describe('account switch through the real auth wiring', () => {
  it('A -> B without reload: B never sees A\'s account-bound state in any render or effect', async () => {
    await mountSignedInAs(A_ID);
    seedAccountA();
    expect(readLastRoomCode()).toBe('ROOMA1');
    frames = [];
    emitted = [];

    await fire('SIGNED_IN', sessionOf(B_ID)); // no SIGNED_OUT between: the cross-tab / token-swap path
    await flush();

    expectNoAAfterBFrames();
    expectAccountIndependentStateKept();
    expect(peekCachedSession()).toMatchObject({ userId: B_ID });
    // socket identity moves to B (the username refresh re-identifies once more); nothing is ever emitted as A or with A's token.
    expect(emitted.length).toBeGreaterThan(0);
    for (const p of emitted) expect(p).toMatchObject({ userId: B_ID, authToken: 'token-bbbb' });
  });

  it('A -> guest -> B: sign-out clears state and downgrades the socket; B starts clean', async () => {
    await mountSignedInAs(A_ID);
    seedAccountA();
    frames = [];
    emitted = [];

    await fire('SIGNED_OUT', null);
    await flush();
    const guestFrames = frames.filter((f) => f.uid === null);
    for (const f of guestFrames) expect(f).toMatchObject({ room: '', fritz: 'null', snapshot: null, today: null, admin: null, profileId: null });
    expect(peekCachedSession()).toBeNull();

    await fire('SIGNED_IN', sessionOf(B_ID));
    await flush();

    expectNoAAfterBFrames();
    expectAccountIndependentStateKept();
    expect(emitted[0]).toEqual({ userId: null, username: 'Guest', authToken: null });
    expect(emitted.length).toBeGreaterThan(1);
    for (const p of emitted.slice(1)) expect(p).toMatchObject({ userId: B_ID, authToken: 'token-bbbb' });
  });

  it('stale async: A\'s slow profile response arriving after B is active never repopulates A', async () => {
    h.holdProfileFor.add(A_ID);
    const view = render(React.createElement(AuthProvider, null, React.createElement(Probe)));
    await flush();
    await fire('SIGNED_IN', sessionOf(A_ID)); // A's profile fetch is now parked
    await flush();
    expect(h.held.has(A_ID)).toBe(true);
    frames = [];

    await fire('SIGNED_IN', sessionOf(B_ID));
    await flush();
    await act(async () => {
      h.held.get(A_ID)!.release(); // the OLD principal's response lands late
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    const bFrames = frames.filter((f) => f.uid === B_ID);
    expect(bFrames.length).toBeGreaterThan(0);
    for (const f of bFrames) expect(f.profileId === null || f.profileId === B_ID, `profile ${f.profileId}`).toBe(true);
    const last = bFrames[bFrames.length - 1];
    expect(last.profileId).toBe(B_ID);
    view.unmount();
  });

  it('stale async after sign-out: a late response for A does not resurrect A\'s profile for a guest', async () => {
    h.holdProfileFor.add(A_ID);
    render(React.createElement(AuthProvider, null, React.createElement(Probe)));
    await flush();
    await fire('SIGNED_IN', sessionOf(A_ID));
    await flush();
    frames = [];
    await fire('SIGNED_OUT', null);
    await act(async () => {
      h.held.get(A_ID)!.release();
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();
    for (const f of frames) expect(f.profileId, `${f.phase} frame uid=${f.uid}`).toBeNull();
  });
});
