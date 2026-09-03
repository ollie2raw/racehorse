import { randomUUID } from 'crypto';
import { generateDailyFritzRun, type DailyFritzHandDeal } from '../../dailyFritz';
import type { DailyFritzAttemptRecord, DailyFritzRunRecord } from './dailyFritzStore';

const GO_OUT_DEAL: DailyFritzHandDeal = {
  player_tiles: [{ low: 6, high: 6 }],
  fritz_tiles: [{ low: 0, high: 5 }],
  boneyard: [],
  locked: [],
};

const TERMINAL_RUN_DATE = '2026-01-01';

const runs = new Map<string, DailyFritzRunRecord>();
const attempts = new Map<string, DailyFritzAttemptRecord>();

export function isDailyFritzMemoryStoreEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.DAILY_FRITZ_MEMORY_STORE === '1';
}

function seedRun(runDate: string): DailyFritzRunRecord {
  const existing = runs.get(runDate);
  if (existing) return existing;
  const winningScore = runDate === TERMINAL_RUN_DATE ? 1 : 60;
  const generated = generateDailyFritzRun(runDate, 'elite', 7, winningScore);
  generated.handDeals[0] = GO_OUT_DEAL;
  const metadata = {
    ...(generated.metadata ?? {}),
    draw_winners_by_game: { 1: 'you', 2: 'you', 3: 'you' },
  };
  const record: DailyFritzRunRecord = {
    runDate: generated.runDate,
    seed: generated.seed,
    fritzTier: generated.fritzTier,
    dealSize: generated.dealSize,
    winningScore: generated.winningScore,
    status: generated.status,
    handDeals: generated.handDeals,
    generatedAt: generated.generatedAt,
    invalidatedAt: generated.invalidatedAt,
    metadata,
  };
  runs.set(runDate, record);
  return record;
}

export function memoryGetRun(runDate: string): DailyFritzRunRecord | null {
  return runs.get(runDate) ?? seedRun(runDate);
}

export function memoryUpsertRun(record: DailyFritzRunRecord): DailyFritzRunRecord {
  runs.set(record.runDate, record);
  return record;
}

export function memoryGetAttempt(runDate: string, userId: string): DailyFritzAttemptRecord | null {
  for (const attempt of attempts.values()) {
    if (attempt.runDate === runDate && attempt.userId === userId) return attempt;
  }
  return null;
}

export function memoryGetAttemptById(attemptId: string, userId: string): DailyFritzAttemptRecord | null {
  const attempt = attempts.get(attemptId);
  if (!attempt || attempt.userId !== userId) return null;
  return attempt;
}

export function memoryUpsertAttempt(record: DailyFritzAttemptRecord): DailyFritzAttemptRecord {
  const next = { ...record };
  attempts.set(next.id, next);
  return next;
}

export function memoryCreateAttempt(runDate: string, userId: string): DailyFritzAttemptRecord {
  const now = new Date().toISOString();
  const record: DailyFritzAttemptRecord = {
    id: randomUUID(),
    runDate,
    userId,
    status: 'started',
    currentHandIndex: 0,
    currentGameNumber: 1,
    revision: 0,
    challengeId: null,
    challengeContractVersion: null,
    generationVersion: null,
    gameRulesVersion: null,
    transcriptProtocolVersion: null,
    fritzPolicyVersion: null,
    rankingVersion: null,
    authoritySchemaVersion: 1,
    startedAt: now,
    completedAt: null,
    verifiedMatchId: null,
    completionHash: null,
    result: null,
    finalScore: null,
    opponentScore: null,
    pointDiff: null,
    won: null,
    movesUsed: null,
    handsPlayed: null,
  };
  attempts.set(record.id, record);
  return record;
}

export function memoryListAttemptsForUser(userId: string, limit: number): DailyFritzAttemptRecord[] {
  return [...attempts.values()]
    .filter((attempt) => attempt.userId === userId)
    .sort((a, b) => b.runDate.localeCompare(a.runDate))
    .slice(0, limit);
}

export function memoryListAttemptsForDate(runDate: string): DailyFritzAttemptRecord[] {
  return [...attempts.values()].filter((attempt) => attempt.runDate === runDate);
}

export function memoryListStrandedAttempts(startedBeforeIso: string, limit: number): DailyFritzAttemptRecord[] {
  const cutoff = Date.parse(startedBeforeIso);
  return [...attempts.values()]
    .filter((attempt) => attempt.status === 'started' && Date.parse(attempt.startedAt) < cutoff)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(0, limit);
}
