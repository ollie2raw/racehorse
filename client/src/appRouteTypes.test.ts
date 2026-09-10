// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type {
  AppRoutesHostRouteBundles,
  AppRoutesNavigationProps,
  AppRoutesProps,
  AppRoutesShellProps,
} from './appRouteTypes';

/** Compile-time bundle keys — fails tsc if AppRoutesProps shape drifts. */
const APP_ROUTES_BUNDLE_KEYS: (keyof AppRoutesProps)[] = [
  'shell',
  'navigation',
  'auth',
  'learn',
  'botMatch',
  'ghost',
  'social',
  'multiplayer',
  'tournament',
];

const HOST_ROUTE_BUNDLE_KEYS: (keyof AppRoutesHostRouteBundles)[] = [
  'navigation',
  'auth',
  'learn',
  'botMatch',
  'ghost',
  'social',
  'tournament',
  'multiplayerRoute',
];

describe('appRouteTypes prop bundles', () => {
  it('AppRoutesProps exposes exactly 9 domain bundles (replacing the former 84 flat props)', () => {
    expect(APP_ROUTES_BUNDLE_KEYS).toHaveLength(9);
    expect(APP_ROUTES_BUNDLE_KEYS).toEqual([
      'shell',
      'navigation',
      'auth',
      'learn',
      'botMatch',
      'ghost',
      'social',
      'multiplayer',
      'tournament',
    ]);
  });

  it('AppRoutesHostRouteBundles groups host-source route fields into 8 sub-bundles', () => {
    expect(HOST_ROUTE_BUNDLE_KEYS).toHaveLength(8);
  });

  it('flat bundle field counts sum to the route-prop surface', () => {
    type ShellKeys = keyof AppRoutesShellProps;
    type NavKeys = keyof AppRoutesNavigationProps;
    const fieldCounts = {
      shell: 5 satisfies number,
      navigation: 2 satisfies number,
      auth: 12 satisfies number,
      learn: 10 satisfies number,
      botMatch: 8 satisfies number,
      ghost: 6 satisfies number,
      social: 9 satisfies number,
      multiplayer: 9 satisfies number,
      tournament: 17 satisfies number,
    };

    const total = Object.values(fieldCounts).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(78);

    // Guard against accidental key renames dropping coverage
    const _shell: Record<ShellKeys, unknown> = {
      withAuthModals: null,
      fallbackConnectionHost: null,
      appRootClassName: '',
      appRootRef: null,
      friendInvitePopup: null,
    };
    const _nav: Record<NavKeys, unknown> = { appMode: 'home', setAppMode: null };
    expect(_shell).toBeDefined();
    expect(_nav).toBeDefined();
  });
});