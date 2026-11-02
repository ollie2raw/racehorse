import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installWebPhoneClass } from './webPhoneClass';

type Listener = () => void;

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initial,
    media: '(pointer: coarse) and (hover: none)',
    addEventListener: (_: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_: string, fn: Listener) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', () => mql);
  return {
    set(matches: boolean) {
      mql.matches = matches;
      listeners.forEach((fn) => fn());
    },
    listenerCount: () => listeners.size,
  };
}

describe('installWebPhoneClass', () => {
  const root = document.documentElement;
  beforeEach(() => root.classList.remove('rh-web-phone', 'rh-native'));
  afterEach(() => {
    root.classList.remove('rh-web-phone', 'rh-native');
    vi.unstubAllGlobals();
  });

  it('marks a touch-only phone browser', () => {
    stubMatchMedia(true);
    installWebPhoneClass(root);
    expect(root.classList.contains('rh-web-phone')).toBe(true);
  });

  it('leaves a mouse-and-keyboard browser alone', () => {
    stubMatchMedia(false);
    installWebPhoneClass(root);
    expect(root.classList.contains('rh-web-phone')).toBe(false);
  });

  it('never applies together with the installed app\'s own class', () => {
    root.classList.add('rh-native');
    stubMatchMedia(true);
    installWebPhoneClass(root);
    expect(root.classList.contains('rh-web-phone')).toBe(false);
  });

  it('follows the device when its input capabilities change (a keyboard and mouse docked or removed)', () => {
    const media = stubMatchMedia(true);
    installWebPhoneClass(root);
    media.set(false);
    expect(root.classList.contains('rh-web-phone')).toBe(false);
    media.set(true);
    expect(root.classList.contains('rh-web-phone')).toBe(true);
  });

  it('undoes itself: no class and no listener left behind', () => {
    const media = stubMatchMedia(true);
    const uninstall = installWebPhoneClass(root);
    expect(media.listenerCount()).toBe(1);
    uninstall();
    expect(root.classList.contains('rh-web-phone')).toBe(false);
    expect(media.listenerCount()).toBe(0);
  });

  it('does nothing where there is no matchMedia (a test environment, an old engine)', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => installWebPhoneClass(root)()).not.toThrow();
    expect(root.classList.contains('rh-web-phone')).toBe(false);
  });
});
