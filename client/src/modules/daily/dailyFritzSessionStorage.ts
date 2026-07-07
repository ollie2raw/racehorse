import type { MoveEntry } from '../../game/moveLogger';
import type { BotMatchState } from '../match/runtime/botEngine.ts';
import type { DailyFritzStartResponse } from './dailyFritzContracts.ts';
import { isPersistedDailyFritzPlayableResume } from './dailyFritzMatchDiagnostics.ts';

export type DailyFritzPersistedSnapshot = {
  attemptId?: string;
  currentHandIndex?: number;
  match?: BotMatchState;
  movesUsed?: number;
  moveLog?: MoveEntry[];
};

export function buildDailyFritzStorageKey(attemptId: string, gameNumber: number): string {
  return `racehorse:daily-fritz:v2:${attemptId}:game:${gameNumber}`;
}

export function resolveDailyFritzStorageKey(
  mode: string,
  dailyFritzPackage: DailyFritzStartResponse | null | undefined,
): string | null {
  if (mode !== 'daily-fritz' || !dailyFritzPackage) return null;
  return buildDailyFritzStorageKey(
    dailyFritzPackage.attempt_id,
    dailyFritzPackage.current_game_number ?? 1,
  );
}

export function loadPersistedDailyFritzMatch(
  storageKey: string | null,
  attemptId: string | undefined,
  serverHandIndex: number,
): DailyFritzPersistedSnapshot | null {
  if (!storageKey || typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DailyFritzPersistedSnapshot;
    if (parsed.attemptId !== attemptId || !parsed.match) return null;
    const persistedHandIndex = Number(parsed.currentHandIndex);
    if (!Number.isFinite(persistedHandIndex) || persistedHandIndex !== serverHandIndex) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function pruneNonPlayableDailyFritzSnapshot(storageKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { match?: BotMatchState };
    if (parsed.match && !isPersistedDailyFritzPlayableResume(parsed.match)) {
      window.sessionStorage.removeItem(storageKey);
    }
  } catch {
    // ignore corrupt session snapshot
  }
}