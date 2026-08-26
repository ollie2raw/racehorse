import { supabaseFetch } from '../../supabaseUtils';
import { childLogger } from '../../logger';
import type { DailyFritzDayHealthMetrics } from '../routes/dailyFritzHealthPolicy';

const log = childLogger('daily-fritz');

type FunnelRow = { event_type: string; total: number };
type FailureRow = { verifier_code: string | null; total: number };
type AttemptRow = { status?: string; result: Record<string, unknown> | null };

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
  unverifiedHandAttempts: number,
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
    unverifiedHandAttempts,
    unverifiedHandAttemptRate: rate(unverifiedHandAttempts, attemptsStarted),
    recoveryStarted,
    recoveryFailed,
    firstMoveCount,
  };
}

/**
 * Attempts that entered unverified_hands, protocol v2 only.
 *
 * Counted per attempt, not per hand: one run that lost six hands to the same
 * root cause is one affected player, and rate-per-attempt is what the
 * completion figures compare against. Legacy pre-authority rows are excluded —
 * they carry no receipt by construction, so including them would hide a real
 * v2 regression behind a constant baseline.
 */
export function countDailyFritzUnverifiedHandAttempts(
  rows: Array<{ result: Record<string, unknown> | null }>,
): number {
  return rows.filter((row) => {
    if (Number(row.result?.verification_protocol_version) !== 2) return false;
    const hands = row.result?.unverified_hands;
    return Array.isArray(hands) && hands.length > 0;
  }).length;
}

/**
 * One pass over the day's attempts serving both unverified counters.
 *
 * The status filter that used to live in this query was dropped: a run still
 * in progress can already have lost a hand, and that is precisely the signal
 * worth alerting on — waiting for completion hides a live regression for the
 * rest of the day. The legacy counter keeps its completed-only semantics by
 * filtering in memory instead.
 */
async function listDailyFritzAttemptResults(runDate: string): Promise<AttemptRow[]> {
  return supabaseFetch<AttemptRow[]>(
    `/rest/v1/daily_fritz_attempts?run_date=${encodeURIComponent(`eq.${runDate}`)}&select=status,result`,
    { method: 'GET' },
  );
}

function countLegacyUnverifiedCompletions(rows: AttemptRow[]): number {
  return rows.filter(
    (row) => row.status === 'completed' && row.result?.verification_status === 'legacy_unverified',
  ).length;
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
  const attemptRows = await listDailyFritzAttemptResults(runDate);
  const legacyUnverifiedCompletions = countLegacyUnverifiedCompletions(attemptRows);
  const unverifiedHandAttempts = countDailyFritzUnverifiedHandAttempts(attemptRows);
  const metrics = buildDayMetrics(
    runDate,
    funnelRows,
    failureRows,
    legacyUnverifiedCompletions,
    unverifiedHandAttempts,
  );

  // Single greppable daily line. Deliberately not an alert by itself: it gives
  // alerting a stable string to key on without standing up new infrastructure.
  log.info({
    runDate,
    unverifiedHandAttempts,
    unverifiedHandAttemptRate: metrics.unverifiedHandAttemptRate,
    attemptsStarted: metrics.attemptsStarted,
    attemptsCompleted: metrics.attemptsCompleted,
    legacyUnverifiedCompletions,
  }, '[daily-fritz-unverified-rate] protocol-v2 attempts entering unverified_hands');

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
