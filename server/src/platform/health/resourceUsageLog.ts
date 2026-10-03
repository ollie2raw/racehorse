/**
 * One log line per hour with this process's Supabase traffic by caller and a
 * CPU / memory sample, so idle cost is visible on Render without tracing.
 *
 *   { msg: 'resource usage', windowMs, supabase: { total, top: [...] },
 *     cpu: { userMs, systemMs, percentOfOneCore }, memory: { rssMb, heapUsedMb, externalMb } }
 *
 * bodyBytes is the decoded response size; wireBytes is the compressed
 * content-length when Supabase sends one (not on chunked responses).
 */
import { childLogger } from '../../logger';
import { takeSupabaseUsage, type SupabaseUsageEntry } from '../../supabaseUtils';

const log = childLogger('resource-usage');

export const RESOURCE_USAGE_LOG_INTERVAL_MS = 60 * 60 * 1000;

const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;

export function buildResourceUsageLine(input: {
  windowMs: number;
  usage: Map<string, SupabaseUsageEntry>;
  cpu: NodeJS.CpuUsage;
  memory: NodeJS.MemoryUsage;
  topN?: number;
}) {
  const rows = [...input.usage.entries()]
    .map(([caller, entry]) => ({ caller, ...entry }))
    .sort((a, b) => b.bodyBytes - a.bodyBytes || b.requests - a.requests);
  const total = rows.reduce(
    (acc, row) => ({
      requests: acc.requests + row.requests,
      bodyBytes: acc.bodyBytes + row.bodyBytes,
      wireBytes: acc.wireBytes + row.wireBytes,
    }),
    { requests: 0, bodyBytes: 0, wireBytes: 0 },
  );
  const cpuMs = (input.cpu.user + input.cpu.system) / 1000;
  return {
    windowMs: input.windowMs,
    supabase: { total, callers: rows.length, top: rows.slice(0, input.topN ?? 15) },
    cpu: {
      userMs: Math.round(input.cpu.user / 1000),
      systemMs: Math.round(input.cpu.system / 1000),
      percentOfOneCore: Math.round((cpuMs / input.windowMs) * 10_000) / 100,
    },
    memory: {
      rssMb: mb(input.memory.rss),
      heapUsedMb: mb(input.memory.heapUsed),
      externalMb: mb(input.memory.external),
    },
  };
}

export function startResourceUsageLog(intervalMs = RESOURCE_USAGE_LOG_INTERVAL_MS): () => void {
  let windowStart = Date.now();
  let cpuStart = process.cpuUsage();
  const timer = setInterval(() => {
    const now = Date.now();
    const line = buildResourceUsageLine({
      windowMs: now - windowStart,
      usage: takeSupabaseUsage(),
      cpu: process.cpuUsage(cpuStart),
      memory: process.memoryUsage(),
    });
    windowStart = now;
    cpuStart = process.cpuUsage();
    log.info(line, 'resource usage');
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
