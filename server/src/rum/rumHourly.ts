/**
 * Publishes the hourly totals: one pino line per hour, and (RUM_SUPABASE_APPEND_ENABLED=true, default off) one row per group and
 * metric in public.rum_hourly, which a daily cleanup keeps to the last 12 months. See docs/ops/rum-beacon.md.
 */
import { childLogger } from '../logger';
import { processInterval } from '../platform/processLifecycle';
import { supabaseFetch } from '../supabaseUtils';
import { RumAggregator, type RumPublishedHour } from './rumAggregator';

const log = childLogger('rum');

export const RUM_RETENTION_MS = 365 * 24 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

export const aggregator = new RumAggregator();
const recent: RumPublishedHour[] = [];
let lastRetentionAt = 0;

export const isRumIngestEnabled = (): boolean => process.env.RUM_INGEST_ENABLED !== 'false';
export const isRumAppendEnabled = (): boolean => process.env.RUM_SUPABASE_APPEND_ENABLED === 'true';
/** Keeps the 12-month delete running after the append is switched off (rows already stored must still expire). Default off. */
export const isRumRetentionEnabled = (): boolean => process.env.RUM_RETENTION_ENABLED === 'true';

export function recentPublishedHours(): readonly RumPublishedHour[] {
  return recent;
}

export async function appendRows(published: RumPublishedHour): Promise<void> {
  if (!isRumAppendEnabled() || published.rows.length === 0) return;
  const body = published.rows.map((row) => ({
    hour: published.hour, grp: row.group, metric: row.metric, reports: row.reports, n: row.n, p50: row.p50, p75: row.p75, p95: row.p95, max: row.max,
  }));
  try {
    await supabaseFetch('/rest/v1/rum_hourly?on_conflict=hour,grp,metric', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(body),
    });
  } catch (error) {
    log.warn({ error: error instanceof Error ? error.message : String(error), hour: published.hour }, 'rum_hourly append failed (the totals are in the log line)');
  }
}

/** Deletes rows older than 12 months. At most once a day; while the append is enabled, or RUM_RETENTION_ENABLED=true when it is off. */
export async function runRetention(now: number = Date.now()): Promise<void> {
  if (!isRumAppendEnabled() && !isRumRetentionEnabled()) return;
  if (now - lastRetentionAt < DAY_MS - 3_600_000) return;
  lastRetentionAt = now;
  const cutoff = new Date(now - RUM_RETENTION_MS).toISOString();
  try {
    await supabaseFetch(`/rest/v1/rum_hourly?hour=lt.${encodeURIComponent(cutoff)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  } catch (error) {
    lastRetentionAt = 0; // try again on the next hour
    log.warn({ error: error instanceof Error ? error.message : String(error), cutoff }, 'rum_hourly retention delete failed');
  }
}

export async function publishDueHours(source: RumAggregator = aggregator, now: number = Date.now()): Promise<RumPublishedHour[]> {
  const published = source.rollover();
  for (const hour of published) {
    log.info({ rum: hour }, 'rum hourly summary');
    recent.push(hour);
    while (recent.length > 24) recent.shift();
    await appendRows(hour);
  }
  if (published.length > 0 || recent.length === 0) await runRetention(now);
  return published;
}

export function startRumHourly(): void {
  processInterval('rum-hourly', () => publishDueHours(), 60_000);
}

export function resetRumHourlyForTests(): void {
  recent.length = 0;
  lastRetentionAt = 0;
}
