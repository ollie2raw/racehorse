import { describe, expect, it } from 'vitest';
import { shouldAutoConnectForMode } from './connectPolicy';

describe('shouldAutoConnectForMode', () => {
  it('connects in feed mode when authed and socket is disconnected', () => {
    expect(
      shouldAutoConnectForMode({
        appMode: 'feed',
        hasAuthUser: true,
        isSocketConnected: false,
      }),
    ).toBe(true);
  });

  it('does not connect in feed mode when authed and socket is already connected', () => {
    expect(
      shouldAutoConnectForMode({
        appMode: 'feed',
        hasAuthUser: true,
        isSocketConnected: true,
      }),
    ).toBe(false);
  });

  it('does not connect in feed mode when there is no auth user', () => {
    expect(
      shouldAutoConnectForMode({
        appMode: 'feed',
        hasAuthUser: false,
        isSocketConnected: false,
      }),
    ).toBe(false);
  });

  it('does not connect in non-feed mode even when authed and disconnected', () => {
    expect(
      shouldAutoConnectForMode({
        appMode: 'multiplayer',
        hasAuthUser: true,
        isSocketConnected: false,
      }),
    ).toBe(false);
  });
});