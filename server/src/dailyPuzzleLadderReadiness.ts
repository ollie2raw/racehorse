import { isDailyPuzzleLadderReady, normalizeDailyPuzzleSlot, sortDailyPuzzleSlots, type DailyPuzzleSlot } from './dailyPuzzle';

const PACIFIC_TZ = 'America/Los_Angeles';

export function getPacificDateKey(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Minutes after Pacific midnight when today's ladder should be ready for players. */
export const LADDER_READINESS_GRACE_MINUTES_PT = 15;

export type DailyPuzzleLadderReadinessSnapshot = {
  runDate: string;
  ready: boolean;
  publishedSlotCount: number;
  missingSlotIndexes: number[];
  legacySinglePuzzleDay: boolean;
  shouldAlert: boolean;
  alertReason: string | null;
};

export function assessDailyPuzzleLadderReadiness(
  runDate: string,
  publishedSlots: DailyPuzzleSlot[],
  now: Date = new Date(),
): DailyPuzzleLadderReadinessSnapshot {
  const sorted = sortDailyPuzzleSlots(publishedSlots);
  const ready = isDailyPuzzleLadderReady(sorted);
  const present = new Set(sorted.map((slot) => slot.slotIndex));
  const missingSlotIndexes = [1, 2, 3].filter((index) => !present.has(index as 1 | 2 | 3));
  const shouldAlert = !ready && isPastLadderReadinessGracePt(runDate, now);
  const alertReason = shouldAlert
    ? `Daily Puzzle ladder for ${runDate} is not publish-ready (${sorted.length}/3 slots, missing: ${missingSlotIndexes.join(', ') || 'metadata'})`
    : null;

  return {
    runDate,
    ready,
    publishedSlotCount: sorted.length,
    missingSlotIndexes,
    legacySinglePuzzleDay: !ready,
    shouldAlert,
    alertReason,
  };
}

/** Minutes since Pacific midnight for `now` (0–1439). Uses h23 hour cycle for stable CI/ICU parsing. */
export function getPacificMinutesSinceMidnight(now: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hourRaw = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const hour = hourRaw === 24 ? 0 : hourRaw % 24;
  return hour * 60 + minute;
}

export function isPastLadderReadinessGracePt(runDate: string, now: Date = new Date()): boolean {
  const todayPt = getPacificDateKey(now);
  if (runDate !== todayPt) return false;
  return getPacificMinutesSinceMidnight(now) >= LADDER_READINESS_GRACE_MINUTES_PT;
}

export function normalizePublishedSlotRows<T extends Parameters<typeof normalizeDailyPuzzleSlot>[0]>(
  rows: T[],
): DailyPuzzleSlot[] {
  return sortDailyPuzzleSlots(rows.map((row) => normalizeDailyPuzzleSlot(row)));
}
