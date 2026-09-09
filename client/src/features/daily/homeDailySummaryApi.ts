import { apiGetOrThrow } from '../../api/client';

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
  return apiGetOrThrow<HomeDailySummaryResponse>('/api/home/daily-summary');
}
