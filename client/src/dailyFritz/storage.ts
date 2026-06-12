import type { BotMatchState } from '../bot/botEngine';
import type { MoveEntry } from '../analyzer/moveLogger';
import type { DailyFritzSetResult, DailyFritzSetGameNumber } from './api';

export const DAILY_FRITZ_MATCH_STORAGE_PREFIX = 'racehorse:daily-fritz:v2:';

export interface DailyFritzStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PersistedDailyFritzMatchSnapshot {
  attemptId?: string;
  currentHandIndex?: number;
  match?: BotMatchState;
  movesUsed?: number;
  moveLog?: MoveEntry[];
}

export function getDailyFritzMatchStorageKey(
  attemptId: string,
  gameNumber: DailyFritzSetGameNumber | number | null | undefined,
): string {
  return `${DAILY_FRITZ_MATCH_STORAGE_PREFIX}${attemptId}:game:${gameNumber ?? 1}`;
}

function parsePersistedSnapshot(raw: string | null): PersistedDailyFritzMatchSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedDailyFritzMatchSnapshot;
    if (!parsed || typeof parsed !== 'object' || !parsed.match) return null;
    return parsed;
  } catch {
    return null;
  }
}

function snapshotMatchesAttempt(
  parsed: PersistedDailyFritzMatchSnapshot | null,
  attemptId: string | undefined,
  currentHandIndex: number,
): parsed is PersistedDailyFritzMatchSnapshot {
  if (!parsed?.match || !attemptId) return false;
  if (parsed.attemptId !== attemptId) return false;
  const persistedHandIndex = Number(parsed.currentHandIndex);
  return Number.isFinite(persistedHandIndex) && persistedHandIndex === currentHandIndex;
}

export function loadPersistedDailyFritzMatchSnapshot(input: {
  storageKey: string | null;
  attemptId: string | undefined;
  currentHandIndex: number;
  primaryStorage?: DailyFritzStorageLike | null;
  fallbackStorage?: DailyFritzStorageLike | null;
}): PersistedDailyFritzMatchSnapshot | null {
  const {
    storageKey,
    attemptId,
    currentHandIndex,
    primaryStorage,
    fallbackStorage,
  } = input;
  if (!storageKey || !attemptId || !primaryStorage) return null;

  const primary = parsePersistedSnapshot(primaryStorage.getItem(storageKey));
  if (snapshotMatchesAttempt(primary, attemptId, currentHandIndex)) {
    return primary;
  }

  if (!fallbackStorage) return null;
  const fallback = parsePersistedSnapshot(fallbackStorage.getItem(storageKey));
  if (!snapshotMatchesAttempt(fallback, attemptId, currentHandIndex)) {
    return null;
  }

  // Migrate old session-backed snapshots to durable local storage.
  try {
    primaryStorage.setItem(storageKey, JSON.stringify(fallback));
    fallbackStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures; the fallback payload is still usable.
  }
  return fallback;
}

export function persistDailyFritzMatchSnapshot(
  storage: DailyFritzStorageLike | null | undefined,
  storageKey: string | null,
  snapshot: PersistedDailyFritzMatchSnapshot,
): void {
  if (!storage || !storageKey) return;
  storage.setItem(storageKey, JSON.stringify(snapshot));
}

export function hasDailyFritzMatchSnapshot(input: {
  storageKey: string | null;
  attemptId: string | undefined;
  currentHandIndex: number;
  primaryStorage?: DailyFritzStorageLike | null;
  fallbackStorage?: DailyFritzStorageLike | null;
}): boolean {
  return Boolean(loadPersistedDailyFritzMatchSnapshot(input));
}

export function shouldBlockUnsafeDailyFritzResume(input: {
  hadStartedAttemptBefore: boolean;
  hasRecoverableSnapshot: boolean;
  currentHandIndex: number;
  currentGameNumber: DailyFritzSetGameNumber | null | undefined;
  setResult: DailyFritzSetResult | null | undefined;
}): boolean {
  const {
    hadStartedAttemptBefore,
    hasRecoverableSnapshot,
    currentHandIndex,
    currentGameNumber,
    setResult,
  } = input;
  if (!hadStartedAttemptBefore || hasRecoverableSnapshot) return false;

  const completedGames = setResult?.games.length ?? 0;

  // Any later-hand resume without the exact snapshot is unsafe because the
  // server only knows which deterministic hand index to deal next, not the
  // live board / score / rack / turn state inside that hand.
  if (currentHandIndex > 0) return true;

  // Game 1 with no completed games is also unsafe: a fresh deterministic first
  // hand is indistinguishable from a partially played first hand unless the
  // local snapshot is present.
  if ((currentGameNumber ?? 1) === 1 && completedGames === 0) return true;

  return false;
}
