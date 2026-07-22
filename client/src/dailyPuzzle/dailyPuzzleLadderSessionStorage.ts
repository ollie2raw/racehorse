import type { BotMatchState } from '../bot/botEngine';
import type { PlayStatus } from './dailyPuzzleScreenTypes';

const SESSION_KEY_PREFIX = 'racehorse:daily-puzzle-ladder:v1:';

export type DailyPuzzleLadderSessionSnapshot = {
  version: 1;
  attemptId: string;
  runDate: string;
  slotId: string;
  slotIndex: 1 | 2 | 3;
  runtimeState: BotMatchState;
  status: PlayStatus;
  movesUsed: number;
  finalScore: number | null;
  runningScore: number;
  moveTrace: Array<Record<string, unknown>>;
  startedAt: number;
  updatedAt: number;
};

function storageKey(attemptId: string, slotId: string): string {
  return `${SESSION_KEY_PREFIX}${attemptId}:${slotId}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidRuntimeState(value: unknown): value is BotMatchState {
  if (!isObject(value) || !isObject(value.players) || !isObject(value.players.you) || !isObject(value.players.bot)) return false;
  const you = value.players.you as Record<string, unknown>;
  const bot = value.players.bot as Record<string, unknown>;
  return Array.isArray(you.hand) && Array.isArray(bot.hand) && Array.isArray(value.boneyard)
    && isObject(value.board) && typeof value.currentPlayer === 'string'
    && Number.isInteger(value.handNumber) && typeof value.handOver === 'boolean'
    && typeof value.gameOver === 'boolean';
}

function parseSnapshot(value: unknown): DailyPuzzleLadderSessionSnapshot | null {
  if (!isObject(value) || value.version !== 1 || typeof value.attemptId !== 'string'
    || typeof value.runDate !== 'string' || typeof value.slotId !== 'string'
    || ![1, 2, 3].includes(Number(value.slotIndex)) || !isValidRuntimeState(value.runtimeState)
    || !['IN_PROGRESS', 'SOLVED', 'FAILED'].includes(String(value.status))
    || !Number.isInteger(Number(value.movesUsed)) || Number(value.movesUsed) < 0
    || (value.finalScore !== null && !Number.isFinite(value.finalScore))
    || !Number.isFinite(value.runningScore) || !Array.isArray(value.moveTrace)
    || !Number.isFinite(value.startedAt) || !Number.isFinite(value.updatedAt)) return null;
  return value as unknown as DailyPuzzleLadderSessionSnapshot;
}

export function loadDailyPuzzleLadderSession(
  attemptId: string | null | undefined,
  runDate: string,
  slotId: string,
): DailyPuzzleLadderSessionSnapshot | null {
  if (!attemptId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(attemptId, slotId));
    if (!raw) return null;
    const parsed = parseSnapshot(JSON.parse(raw));
    return parsed && parsed.attemptId === attemptId && parsed.runDate === runDate && parsed.slotId === slotId
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function persistDailyPuzzleLadderSession(snapshot: DailyPuzzleLadderSessionSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(snapshot.attemptId, snapshot.slotId), JSON.stringify(snapshot));
  } catch {
    // The server remains authoritative; storage can be unavailable in private mode.
  }
}

export function clearDailyPuzzleLadderSession(
  attemptId: string | null | undefined,
  slotId: string,
): void {
  if (!attemptId || typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(storageKey(attemptId, slotId));
  } catch {
    // no-op
  }
}
