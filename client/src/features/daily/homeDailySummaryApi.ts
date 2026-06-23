import { apiGet } from '../../api/client';

async function throwingGet<T>(path: string): Promise<T> {
  const result = await apiGet<T>(path);
  if (result.error) throw new Error(result.error);
  return result.data as T;
}

export interface HomeDailySummaryWeekDay {
  dateKey: string;
  label: string;
  fritzCompleted: boolean;
  puzzleCompleted: boolean;
  complete: boolean;
  isToday: boolean;
  isFuture: boolean;
}

export interface HomeDailySummaryResponse {
  ok: true;
  today: string;
  week: HomeDailySummaryWeekDay[];
  weeklyCompletedCount: number;
  currentStreakCount: number;
  todayComplete: boolean;
}

export async function getHomeDailySummary(): Promise<HomeDailySummaryResponse> {
  return throwingGet<HomeDailySummaryResponse>('/api/home/daily-summary');
}
