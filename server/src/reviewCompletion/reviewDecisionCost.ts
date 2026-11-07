/**
 * What a review decision costs on THIS server, in a form /health can show.
 *
 * A post-game review took minutes on the free instance while the same positions cost a mean 411 to 806 ms on a fast laptop (docs/review-performance-measurement-2026-11-07.md).
 * Several suspects cannot be told apart from outside: the search escalating to deeper tiers than expected, the instance being CPU-starved (a free instance is a fraction of
 * a vCPU and its container is throttled by a cgroup quota), memory pressure restarting the search worker, and cold start. This records, per decision, the tier it settled
 * at, the sampled hidden hands it solved, its wall time, the CPU time it used, whether the wall-clock ceiling fired and which attempt of the job it was; per job, the cgroup
 * throttle counters before and after; and process-wide, memory, worker restarts and a one-time CPU benchmark. Numbers and short codes only, never raw text.
 */
import { readFileSync } from 'node:fs';

export type ReviewDecisionCostSample = {
  readonly jobId: string | null;
  /** The tier the decision settled at (1-4), 'forced' for a single-action decision, or 'none' when no tier is known. */
  readonly tier: number | 'forced' | 'none';
  readonly wallMs: number;
  /** User + system CPU the whole process used during the decision (the search runs in a worker thread of this process). */
  readonly cpuMs: number | null;
  /** CPU the worker thread itself used (process.threadCpuUsage, Node 23.9+); null when Node cannot tell. */
  readonly threadCpuMs: number | null;
  /** Sampled hidden hands the search actually solved. */
  readonly samplesSolved: number | null;
  /** The search reported it did not complete (the wall-clock ceiling or the node cap). */
  readonly incomplete: boolean;
  /** The wall-clock safety ceiling fired (the result carries its diagnostic). */
  readonly ceilingHit: boolean;
  /** Which attempt of the job this decision ran under (1 for the first claim). */
  readonly attempt: number | null;
};

export type ReviewCostHistogram = {
  readonly decisions: number;
  readonly byTier: Readonly<Record<string, number>>;
  readonly meanWallMs: number;
  readonly maxWallMs: number;
  readonly meanSamplesSolved: number | null;
  /** Process CPU time / wall time over these decisions; about 1 on an unthrottled core, well under 1 when the instance is starved. */
  readonly cpuToWallRatio: number | null;
  /** The same for the worker thread alone, when Node can report it. */
  readonly threadCpuToWallRatio: number | null;
  /** Decisions whose search reported itself incomplete. */
  readonly incomplete: number;
  /** Decisions where the wall-clock ceiling fired (a tier-1 ceiling is 2,000 ms). */
  readonly ceilingHits: number;
};

export type ReviewJobThrottle = {
  readonly nrThrottledDelta: number | null;
  readonly throttledMsDelta: number | null;
  readonly jobWallMs: number;
};

export type ReviewWorkerHealth = {
  readonly rssMb: number;
  /** The worker thread's heap used and its cap, as of its last decision. */
  readonly workerHeapUsedMb: number | null;
  readonly workerHeapLimitMb: number | null;
  readonly workerRestarts: number;
  readonly workerOomCount: number;
};

export type ReviewCpuBenchmarkResult = {
  readonly snapshotId: string;
  readonly runs: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly totalMs: number;
  readonly cpuMs: number | null;
  readonly ranAt: number;
};

export type ReviewDecisionCostSnapshot = {
  /** Every decision since this process started. */
  readonly sinceBoot: ReviewCostHistogram;
  /** The most recent job that evaluated any decision. */
  readonly lastJob: (ReviewCostHistogram & { readonly jobId: string | null; readonly attempt: number | null; readonly throttle: ReviewJobThrottle | null }) | null;
  readonly memory: ReviewWorkerHealth;
  /** The one-time CPU benchmark (a fixed position at 100 sampled hands, run in the worker thread about 30 s after boot); null until it has run. */
  readonly benchmark: ReviewCpuBenchmarkResult | null;
};

type Accumulator = {
  decisions: number;
  byTier: Record<string, number>;
  wallSum: number;
  wallMax: number;
  samplesSum: number;
  samplesCount: number;
  cpuSum: number;
  cpuWall: number;
  threadCpuSum: number;
  threadCpuWall: number;
  incomplete: number;
  ceilingHits: number;
};

const newAccumulator = (): Accumulator => ({
  decisions: 0, byTier: {}, wallSum: 0, wallMax: 0, samplesSum: 0, samplesCount: 0, cpuSum: 0, cpuWall: 0, threadCpuSum: 0, threadCpuWall: 0, incomplete: 0, ceilingHits: 0,
});

function add(acc: Accumulator, sample: ReviewDecisionCostSample): void {
  acc.decisions += 1;
  const key = String(sample.tier);
  acc.byTier[key] = (acc.byTier[key] ?? 0) + 1;
  acc.wallSum += sample.wallMs;
  acc.wallMax = Math.max(acc.wallMax, sample.wallMs);
  if (sample.samplesSolved != null) {
    acc.samplesSum += sample.samplesSolved;
    acc.samplesCount += 1;
  }
  if (sample.cpuMs != null) {
    acc.cpuSum += sample.cpuMs;
    acc.cpuWall += sample.wallMs;
  }
  if (sample.threadCpuMs != null) {
    acc.threadCpuSum += sample.threadCpuMs;
    acc.threadCpuWall += sample.wallMs;
  }
  if (sample.incomplete) acc.incomplete += 1;
  if (sample.ceilingHit) acc.ceilingHits += 1;
}

const ratio = (numerator: number, denominator: number): number | null => (denominator > 0 ? Math.round((numerator / denominator) * 100) / 100 : null);

const histogram = (acc: Accumulator): ReviewCostHistogram => ({
  decisions: acc.decisions,
  byTier: { ...acc.byTier },
  meanWallMs: acc.decisions === 0 ? 0 : Math.round(acc.wallSum / acc.decisions),
  maxWallMs: Math.round(acc.wallMax),
  meanSamplesSolved: acc.samplesCount > 0 ? Math.round(acc.samplesSum / acc.samplesCount) : null,
  cpuToWallRatio: ratio(acc.cpuSum, acc.cpuWall),
  threadCpuToWallRatio: ratio(acc.threadCpuSum, acc.threadCpuWall),
  incomplete: acc.incomplete,
  ceilingHits: acc.ceilingHits,
});

let sinceBoot = newAccumulator();
let lastJob: { jobId: string | null; attempt: number | null; acc: Accumulator; throttle: ReviewJobThrottle | null } | null = null;
let workerHealth = { heapUsedMb: null as number | null, heapLimitMb: null as number | null, restarts: 0, oom: 0 };
let benchmark: ReviewCpuBenchmarkResult | null = null;

export function noteReviewDecisionCost(sample: ReviewDecisionCostSample): void {
  add(sinceBoot, sample);
  if (!lastJob || lastJob.jobId !== sample.jobId) lastJob = { jobId: sample.jobId, attempt: sample.attempt, acc: newAccumulator(), throttle: null };
  add(lastJob.acc, sample);
}

/** The container's CPU throttle counters before and after one job's pass, so a job that was throttled says so. */
export function noteReviewJobThrottle(jobId: string, before: CpuThrottle | null, after: CpuThrottle | null, jobWallMs: number): void {
  if (!lastJob || lastJob.jobId !== jobId) lastJob = { jobId, attempt: null, acc: newAccumulator(), throttle: null };
  const diff = (a: number | null | undefined, b: number | null | undefined) => (a != null && b != null ? b - a : null);
  lastJob.throttle = before && after
    ? { nrThrottledDelta: diff(before.nrThrottled, after.nrThrottled), throttledMsDelta: diff(before.throttledMs, after.throttledMs), jobWallMs: Math.round(jobWallMs) }
    : null;
}

export function noteReviewWorkerHealth(health: { heapUsedMb?: number | null; heapLimitMb?: number | null; restarts: number; oom: number }): void {
  workerHealth = {
    heapUsedMb: health.heapUsedMb ?? workerHealth.heapUsedMb,
    heapLimitMb: health.heapLimitMb ?? workerHealth.heapLimitMb,
    restarts: health.restarts,
    oom: health.oom,
  };
}

export function noteReviewCpuBenchmark(result: ReviewCpuBenchmarkResult): void {
  benchmark = result;
}

export function getReviewDecisionCost(rssBytes: number = process.memoryUsage().rss): ReviewDecisionCostSnapshot {
  return {
    sinceBoot: histogram(sinceBoot),
    lastJob: lastJob ? { jobId: lastJob.jobId, attempt: lastJob.attempt, ...histogram(lastJob.acc), throttle: lastJob.throttle } : null,
    memory: {
      rssMb: Math.round(rssBytes / 1048576),
      workerHeapUsedMb: workerHealth.heapUsedMb,
      workerHeapLimitMb: workerHealth.heapLimitMb,
      workerRestarts: workerHealth.restarts,
      workerOomCount: workerHealth.oom,
    },
    benchmark,
  };
}

export function resetReviewDecisionCostForTests(): void {
  sinceBoot = newAccumulator();
  lastJob = null;
  workerHealth = { heapUsedMb: null, heapLimitMb: null, restarts: 0, oom: 0 };
  benchmark = null;
}

export type CpuThrottle = {
  /** The container's CPU allowance in cores (quota / period), or null when unlimited or unreadable. */
  readonly quotaCpus: number | null;
  readonly nrPeriods: number | null;
  readonly nrThrottled: number | null;
  readonly throttledMs: number | null;
};

type ReadText = (path: string) => string;
const readFile: ReadText = (path) => readFileSync(path, 'utf8');

function counters(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const [key, value] = line.trim().split(/\s+/);
    if (key && value && Number.isFinite(Number(value))) out[key] = Number(value);
  }
  return out;
}

/**
 * The cgroup CPU throttle counters, cgroup v2 first (/sys/fs/cgroup/cpu.max and cpu.stat), then v1 (cpu.cfs_quota_us and cpu.stat). Returns null when neither is
 * readable (not Linux, or not in a container). `nr_throttled` rising across a review is the proof of a CPU-starved instance.
 */
export function readCpuThrottle(read: ReadText = readFile): CpuThrottle | null {
  try {
    const stat = counters(read('/sys/fs/cgroup/cpu.stat'));
    const [quota, period] = read('/sys/fs/cgroup/cpu.max').trim().split(/\s+/);
    const quotaCpus = quota && quota !== 'max' && Number(period) > 0 ? Math.round((Number(quota) / Number(period)) * 100) / 100 : null;
    return {
      quotaCpus,
      nrPeriods: stat.nr_periods ?? null,
      nrThrottled: stat.nr_throttled ?? null,
      throttledMs: stat.throttled_usec != null ? Math.round(stat.throttled_usec / 1000) : null,
    };
  } catch {
    // not cgroup v2
  }
  try {
    const stat = counters(read('/sys/fs/cgroup/cpu/cpu.stat'));
    const quota = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_quota_us').trim());
    const period = Number(read('/sys/fs/cgroup/cpu/cpu.cfs_period_us').trim());
    return {
      quotaCpus: quota > 0 && period > 0 ? Math.round((quota / period) * 100) / 100 : null,
      nrPeriods: stat.nr_periods ?? null,
      nrThrottled: stat.nr_throttled ?? null,
      throttledMs: stat.throttled_time != null ? Math.round(stat.throttled_time / 1_000_000) : null,
    };
  } catch {
    return null;
  }
}
