export interface DailyPuzzleStreak {
  lastCompletedDate: string | null;
  currentStreak: number;
}

function streakKey(): string {
  return 'dailyPuzzle:streak';
}

export function readStreak(): DailyPuzzleStreak {
  if (typeof window === 'undefined') {
    return { lastCompletedDate: null, currentStreak: 0 };
  }
  try {
    const raw = window.localStorage.getItem(streakKey());
    if (!raw) return { lastCompletedDate: null, currentStreak: 0 };
    const parsed = JSON.parse(raw) as DailyPuzzleStreak;
    return {
      lastCompletedDate:
        typeof parsed.lastCompletedDate === 'string' ? parsed.lastCompletedDate : null,
      currentStreak: Number.isFinite(parsed.currentStreak) ? Math.max(0, parsed.currentStreak) : 0,
    };
  } catch {
    return { lastCompletedDate: null, currentStreak: 0 };
  }
}

export function writeStreak(streak: DailyPuzzleStreak): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(streakKey(), JSON.stringify(streak));
}

function parseLocalDateKeyToDate(dateKey: string): Date | null {
  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const parsed = new Date(y, m - 1, d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function diffLocalCalendarDays(prev: string, next: string): number | null {
  const prevDate = parseLocalDateKeyToDate(prev);
  const nextDate = parseLocalDateKeyToDate(next);
  if (!prevDate || !nextDate) return null;
  const ms = nextDate.getTime() - prevDate.getTime();
  return Math.round(ms / 86400000);
}

/** Updates streak after a solve; returns the streak count for that completion. */
export function recordSolvedStreak(dateKey: string): number {
  const streak = readStreak();
  if (streak.lastCompletedDate === dateKey) {
    const sameDay = Math.max(1, streak.currentStreak || 1);
    writeStreak({ lastCompletedDate: dateKey, currentStreak: sameDay });
    return sameDay;
  }

  const dayDiff = streak.lastCompletedDate ? diffLocalCalendarDays(streak.lastCompletedDate, dateKey) : null;
  const nextStreak = dayDiff === 1 ? Math.max(1, streak.currentStreak + 1) : 1;
  writeStreak({ lastCompletedDate: dateKey, currentStreak: nextStreak });
  return nextStreak;
}

/** Streak to show for a given calendar day key (respects broken streaks). */
export function getDisplayStreak(todayDateKey: string): number {
  const streak = readStreak();
  if (!streak.lastCompletedDate || streak.currentStreak <= 0) return 0;
  const dayDiff = diffLocalCalendarDays(streak.lastCompletedDate, todayDateKey);
  if (dayDiff === null) return Math.max(0, streak.currentStreak);
  if (dayDiff <= 1) return Math.max(0, streak.currentStreak);
  return 0;
}
