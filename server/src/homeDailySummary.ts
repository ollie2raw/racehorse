export const HOME_WEEK_LABELS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export interface HomeDailyCompletionEntry {
  fritz: boolean;
  puzzle: boolean;
  complete: boolean;
}

export type HomeDailyCompletionMap = Record<string, HomeDailyCompletionEntry>;

export interface HomeDailySummaryWeekDay {
  dateKey: string;
  label: string;
  fritzCompleted: boolean;
  puzzleCompleted: boolean;
  complete: boolean;
  isToday: boolean;
  isFuture: boolean;
}

export interface HomeDailySummaryPayload {
  today: string;
  week: HomeDailySummaryWeekDay[];
  weeklyCompletedCount: number;
  currentStreakCount: number;
  todayComplete: boolean;
}

export function createHomeDailyCompletionMap(
  fritzDates: string[],
  puzzleDates: string[],
): HomeDailyCompletionMap {
  const map: HomeDailyCompletionMap = {};

  for (const dateKey of fritzDates) {
    if (!map[dateKey]) map[dateKey] = { fritz: false, puzzle: false, complete: false };
    map[dateKey].fritz = true;
    map[dateKey].complete = map[dateKey].fritz || map[dateKey].puzzle;
  }

  for (const dateKey of puzzleDates) {
    if (!map[dateKey]) map[dateKey] = { fritz: false, puzzle: false, complete: false };
    map[dateKey].puzzle = true;
    map[dateKey].complete = map[dateKey].fritz || map[dateKey].puzzle;
  }

  return map;
}

function addDateKeyDays(dateKey: string, deltaDays: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

function getWeekdayIndexForPacificDate(date: Date): number {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'short',
  }).format(date).toUpperCase();
  const label = weekday.slice(0, 3) as (typeof HOME_WEEK_LABELS)[number];
  const index = HOME_WEEK_LABELS.indexOf(label);
  return index >= 0 ? index : 0;
}

export function buildHomeDailySummary(
  todayDateKey: string,
  completionMap: HomeDailyCompletionMap,
  now: Date = new Date(),
): HomeDailySummaryPayload {
  const todayWeekIndex = getWeekdayIndexForPacificDate(now);
  const weekStart = addDateKeyDays(todayDateKey, -todayWeekIndex);
  const week = HOME_WEEK_LABELS.map((label, index) => {
    const dateKey = addDateKeyDays(weekStart, index);
    const entry = completionMap[dateKey] ?? { fritz: false, puzzle: false, complete: false };
    const isFuture = dateKey > todayDateKey;
    const complete = isFuture ? false : entry.complete;
    return {
      dateKey,
      label,
      fritzCompleted: isFuture ? false : entry.fritz,
      puzzleCompleted: isFuture ? false : entry.puzzle,
      complete,
      isToday: dateKey === todayDateKey,
      isFuture,
    };
  });

  const weeklyCompletedCount = week.filter((day) => day.complete).length;
  const todayComplete = Boolean(completionMap[todayDateKey]?.complete);
  const yesterdayKey = addDateKeyDays(todayDateKey, -1);
  const yesterdayComplete = Boolean(completionMap[yesterdayKey]?.complete);

  let currentStreakCount = 0;
  const anchorDateKey = todayComplete ? todayDateKey : yesterdayComplete ? yesterdayKey : null;
  if (anchorDateKey) {
    let cursor = anchorDateKey;
    while (completionMap[cursor]?.complete) {
      currentStreakCount += 1;
      cursor = addDateKeyDays(cursor, -1);
    }
  }

  return {
    today: todayDateKey,
    week,
    weeklyCompletedCount,
    currentStreakCount,
    todayComplete,
  };
}
