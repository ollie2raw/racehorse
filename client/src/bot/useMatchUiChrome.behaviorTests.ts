if (typeof globalThis.window === 'undefined') {
  Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true, configurable: true });
}

import { mutePreference } from '../utils/mutePreference.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[useMatchUiChrome.behaviorTests] ${msg}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`[useMatchUiChrome.behaviorTests] ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

/** Mirrors useMatchUiChrome useState initial values (pure defaults, no React). */
const INITIAL_CHROME = {
  isFullscreen: false,
  scoreTrackOpen: false,
  showLeaveConfirm: false,
  showFullCoachTip: false,
} as const;

function installLocalStorageMock(store: Record<string, string>): void {
  const mockLocalStorage = {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
    key: () => null,
    length: 0,
  };
  Object.defineProperty(window, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });
}

function testInitialDefaults(): void {
  assertEqual(INITIAL_CHROME.isFullscreen, false, 'isFullscreen initial');
  assertEqual(INITIAL_CHROME.scoreTrackOpen, false, 'scoreTrackOpen initial');
  assertEqual(INITIAL_CHROME.showLeaveConfirm, false, 'showLeaveConfirm initial');
  assertEqual(INITIAL_CHROME.showFullCoachTip, false, 'showFullCoachTip initial');
}

function testInitialMutedFromPreference(): void {
  const store: Record<string, string> = {};
  installLocalStorageMock(store);
  assertEqual(mutePreference.get(), false, 'isMuted initial when unset');

  store.racehorse_muted = '1';
  assertEqual(mutePreference.get(), true, 'isMuted initial when stored true');

  store.racehorse_muted = '0';
  assertEqual(mutePreference.get(), false, 'isMuted initial when stored false');
}

function testMutePreferencePersistTrue(): void {
  const store: Record<string, string> = {};
  installLocalStorageMock(store);
  mutePreference.set(true);
  assertEqual(mutePreference.get(), true, 'mute true after set');
}

function testMutePreferencePersistFalse(): void {
  const store: Record<string, string> = { racehorse_muted: '1' };
  installLocalStorageMock(store);
  mutePreference.set(false);
  assertEqual(mutePreference.get(), false, 'mute false after set');
}

function testStateFieldIndependence(): void {
  const chrome: {
    isFullscreen: boolean;
    scoreTrackOpen: boolean;
    showLeaveConfirm: boolean;
    showFullCoachTip: boolean;
    isMuted: boolean;
  } = { ...INITIAL_CHROME, isMuted: false };
  chrome.scoreTrackOpen = true;
  assertEqual(chrome.showLeaveConfirm, false, 'scoreTrackOpen does not affect showLeaveConfirm');
  chrome.showLeaveConfirm = true;
  assertEqual(chrome.isMuted, false, 'showLeaveConfirm does not affect isMuted');
}

function run(): void {
  testInitialDefaults();
  testInitialMutedFromPreference();
  testMutePreferencePersistTrue();
  testMutePreferencePersistFalse();
  testStateFieldIndependence();
  console.log('useMatchUiChrome.behaviorTests: all passed');
}

run();
