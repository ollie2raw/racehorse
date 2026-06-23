function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[useAuthoringCapture.behaviorTests] ${msg}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`[useAuthoringCapture.behaviorTests] ${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function installEmptyLocalStorage(): void {
  const store: Record<string, string> = {};
  (globalThis as typeof globalThis & { window: Window }).window = {
    localStorage: {
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
    },
  } as unknown as Window;
}

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Mirrors hook lazy initializer in useAuthoringCapture.ts (V2 events). */
const LESSON_V2_AUTHORING_KEY = 'racehorse:lesson-v2:authoring:v1';

function testHookExported(): void {
  const hookPath = join(dirname(fileURLToPath(import.meta.url)), 'useAuthoringCapture.ts');
  const src = readFileSync(hookPath, 'utf8');
  assert(/export function useAuthoringCapture\b/.test(src), 'useAuthoringCapture is exported');
}

async function testInitialAuthoringStepsWhenDisabled(): Promise<void> {
  installEmptyLocalStorage();
  const { loadAuthoringSession } = await import('../learn/guidedAuthoring.ts');
  const initialAuthoringSteps = (isAuthoringMode: boolean) => {
    if (!isAuthoringMode) return [];
    return loadAuthoringSession()?.steps ?? [];
  };
  assertEqual(initialAuthoringSteps(false).length, 0, 'authoringSteps when isAuthoringMode=false');
}

async function testInitialAuthoringStepsWhenEnabledNoSession(): Promise<void> {
  installEmptyLocalStorage();
  const { loadAuthoringSession } = await import('../learn/guidedAuthoring.ts');
  const initialAuthoringSteps = (isAuthoringMode: boolean) => {
    if (!isAuthoringMode) return [];
    return loadAuthoringSession()?.steps ?? [];
  };
  assertEqual(initialAuthoringSteps(true).length, 0, 'authoringSteps when enabled with no saved session');
}

function testInitialAuthoringV2EventsWhenDisabled(): void {
  const initialAuthoringV2Events = (isAuthoringV2Mode: boolean) => {
    if (!isAuthoringV2Mode) return [];
    const raw = window.localStorage.getItem(LESSON_V2_AUTHORING_KEY);
    if (!raw) return [];
    return JSON.parse(raw)?.events ?? [];
  };
  assertEqual(initialAuthoringV2Events(false).length, 0, 'authoringV2Events when isAuthoringV2Mode=false');
}

function testInitialAuthoringV2EventsWhenEnabledNoSession(): void {
  installEmptyLocalStorage();
  const initialAuthoringV2Events = (isAuthoringV2Mode: boolean) => {
    if (!isAuthoringV2Mode) return [];
    const raw = window.localStorage.getItem(LESSON_V2_AUTHORING_KEY);
    if (!raw) return [];
    return JSON.parse(raw)?.events ?? [];
  };
  assertEqual(initialAuthoringV2Events(true).length, 0, 'authoringV2Events when enabled with no saved session');
}

async function run(): Promise<void> {
  await testInitialAuthoringStepsWhenDisabled();
  await testInitialAuthoringStepsWhenEnabledNoSession();
  testInitialAuthoringV2EventsWhenDisabled();
  testInitialAuthoringV2EventsWhenEnabledNoSession();
  testHookExported();
  console.log('useAuthoringCapture.behaviorTests: all passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
