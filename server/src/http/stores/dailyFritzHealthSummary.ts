import { supabaseFetch } from '../../supabaseUtils';
import type { DailyFritzDayHealthMetrics } from '../routes/dailyFritzHealthPolicy';

type FunnelRow = { event_type: string; total: number };
type FailureRow = { verifier_code: string | null; total: number };
type CompletedAttemptRow = { result: Record<string, unknown> | null };

function sumEventCounts(rows: FunnelRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const eventType = String(row.event_type);
    counts.set(eventType, (counts.get(eventType) ?? 0) + (Number(row.total) || 0));
  }
  return counts;
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function buildDayMetrics(
  runDate: string,
  funnelRows: FunnelRow[],
  failureRows: FailureRow[],
  legacyUnverifiedCompletions: number,
): DailyFritzDayHealthMetrics {
  const eventCounts = sumEventCounts(funnelRows);
  const attemptsStarted = eventCounts.get('attempt_started') ?? 0;
  const attemptsCompleted = eventCounts.get('attempt_completed') ?? 0;
  const verificationFailed = eventCounts.get('verification_failed') ?? 0;
  const handVerified = eventCounts.get('hand_verified') ?? 0;
  const requestFailed = eventCounts.get('request_failed') ?? 0;
  const recoveryStarted = eventCounts.get('recovery_started') ?? 0;
  const recoveryFailed = eventCounts.get('recovery_failed') ?? 0;
  const firstMoveCount = eventCounts.get('first_move') ?? 0;

  return {
    runDate,
    attemptsStarted,
    attemptsCompleted,
    completionRate: rate(attemptsCompleted, attemptsStarted),
    verificationFailed,
    handVerified,
    verificationFailureRate: rate(verificationFailed, handVerified + verificationFailed),
    requestFailed,
    legacyUnverifiedCompletions,
    unrankedCompletionRate: rate(legacyUnverifiedCompletions, attemptsCompleted),
    recoveryStarted,
    recoveryFailed,
    firstMoveCount,
  };
}

async function countLegacyUnverifiedCompletions(runDate: string): Promise<number> {
  const rows = await supabaseFetch<CompletedAttemptRow[]>(
    `/rest/v1/daily_fritz_attempts?run_date=eq.${encodeURIComponent(runDate)}&status=eq.completed&select=result`,
    { method: 'GET' },
  );
  return rows.filter((row) => row.result?.verification_status === 'legacy_unverified').length;
}

export type DailyFritzHealthTopFailure = {
  verifierCode: string | null;
  total: number;
};

export async function listDailyFritzHealthSummary(runDate: string): Promise<{
  metrics: DailyFritzDayHealthMetrics;
  topFailures: DailyFritzHealthTopFailure[];
}> {
  const funnelRows = await supabaseFetch<FunnelRow[]>(
    `/rest/v1/daily_fritz_funnel_metrics?run_date=eq.${encodeURIComponent(runDate)}&select=event_type,total`,
    { method: 'GET' },
  );
  const failureRows = await supabaseFetch<FailureRow[]>(
    `/rest/v1/daily_fritz_failure_metrics?run_date=eq.${encodeURIComponent(runDate)}&select=verifier_code,total`,
    { method: 'GET' },
  );
  const legacyUnverifiedCompletions = await countLegacyUnverifiedCompletions(runDate);
  const metrics = buildDayMetrics(runDate, funnelRows, failureRows, legacyUnverifiedCompletions);

  const failureTotals = new Map<string | null, number>();
  for (const row of failureRows) {
    const key = row.verifier_code ?? null;
    failureTotals.set(key, (failureTotals.get(key) ?? 0) + (Number(row.total) || 0));
  }
  const topFailures = [...failureTotals.entries()]
    .map(([verifierCode, total]) => ({ verifierCode, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);

  return { metrics, topFailures };
}

export function formatDailyFritzRunDatePacific(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date);
}

export function previousDailyFritzRunDate(runDate: string): string {
  const [year, month, day] = runDate.split('-').map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 20, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}

export function buildDailyFritzHealthDeltas(
  today: DailyFritzDayHealthMetrics,
  yesterday: DailyFritzDayHealthMetrics,
): {
  completionRatePctPoints: number;
  verificationFailureRatePctPoints: number;
  requestFailedDelta: number;
  attemptsStartedDelta: number;
} {
  return {
    completionRatePctPoints: (today.completionRate - yesterday.completionRate) * 100,
    verificationFailureRatePctPoints: (today.verificationFailureRate - yesterday.verificationFailureRate) * 100,
    requestFailedDelta: today.requestFailed - yesterday.requestFailed,
    attemptsStartedDelta: today.attemptsStarted - yesterday.attemptsStarted,
  };
}
