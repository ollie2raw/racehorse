import { beforeEach, describe, expect, it } from 'vitest';
import {
  getReviewDecisionCost,
  noteReviewCpuBenchmark,
  noteReviewDecisionCost,
  noteReviewJobThrottle,
  noteReviewWorkerHealth,
  readCpuThrottle,
  resetReviewDecisionCostForTests,
  type ReviewDecisionCostSample,
} from './reviewDecisionCost';

beforeEach(resetReviewDecisionCostForTests);

const sample = (overrides: Partial<ReviewDecisionCostSample> = {}): ReviewDecisionCostSample => ({
  jobId: 'j1', tier: 1, wallMs: 100, cpuMs: 100, threadCpuMs: 90, samplesSolved: 100, incomplete: false, ceilingHit: false, attempt: 1, ...overrides,
});

describe('review decision cost', () => {
  it('starts empty', () => {
    const cost = getReviewDecisionCost(0);
    expect(cost.sinceBoot).toMatchObject({ decisions: 0, byTier: {}, meanWallMs: 0, maxWallMs: 0, cpuToWallRatio: null, threadCpuToWallRatio: null, meanSamplesSolved: null, incomplete: 0, ceilingHits: 0 });
    expect(cost.lastJob).toBeNull();
    expect(cost.benchmark).toBeNull();
    expect(cost.memory).toMatchObject({ rssMb: 0, workerHeapUsedMb: null, workerRestarts: 0, workerOomCount: 0 });
  });

  it('counts decisions by the tier they settled at, with mean and max wall time, solved samples, incomplete and ceiling-hit counts', () => {
    noteReviewDecisionCost(sample({ tier: 1, wallMs: 100, samplesSolved: 100 }));
    noteReviewDecisionCost(sample({ tier: 1, wallMs: 2000, samplesSolved: 60, incomplete: true, ceilingHit: true }));
    noteReviewDecisionCost(sample({ tier: 2, wallMs: 900, samplesSolved: 2500 }));
    noteReviewDecisionCost(sample({ tier: 'forced', wallMs: 1, samplesSolved: null }));
    const { sinceBoot } = getReviewDecisionCost(0);
    expect(sinceBoot.decisions).toBe(4);
    expect(sinceBoot.byTier).toEqual({ '1': 2, '2': 1, forced: 1 });
    expect(sinceBoot.maxWallMs).toBe(2000);
    expect(sinceBoot.meanWallMs).toBe(750);
    expect(sinceBoot.meanSamplesSolved).toBe(887);
    expect(sinceBoot.incomplete).toBe(1);
    expect(sinceBoot.ceilingHits).toBe(1);
  });

  it('reports CPU time over wall time for the process and for the worker thread: about 1 on a free core, far below 1 when the instance is starved', () => {
    noteReviewDecisionCost(sample({ wallMs: 1000, cpuMs: 100, threadCpuMs: 80 }));
    noteReviewDecisionCost(sample({ wallMs: 1000, cpuMs: 100, threadCpuMs: 80 }));
    const { sinceBoot } = getReviewDecisionCost(0);
    expect(sinceBoot.cpuToWallRatio).toBe(0.1);
    expect(sinceBoot.threadCpuToWallRatio).toBe(0.08);
  });

  it('has no thread CPU ratio when Node cannot report thread CPU', () => {
    noteReviewDecisionCost(sample({ threadCpuMs: null }));
    expect(getReviewDecisionCost(0).sinceBoot.threadCpuToWallRatio).toBeNull();
  });

  it('keeps a separate histogram for the most recent job with its attempt, and starts a new one when the job changes', () => {
    noteReviewDecisionCost(sample({ jobId: 'j1', wallMs: 10 }));
    noteReviewDecisionCost(sample({ jobId: 'j2', tier: 3, wallMs: 5000, attempt: 2 }));
    const cost = getReviewDecisionCost(0);
    expect(cost.sinceBoot.decisions).toBe(2);
    expect(cost.lastJob).toMatchObject({ jobId: 'j2', attempt: 2, decisions: 1, byTier: { '3': 1 }, maxWallMs: 5000, throttle: null });
  });

  it('records the container throttle counters across a job as deltas: a throttled job says so', () => {
    noteReviewDecisionCost(sample({ jobId: 'j1' }));
    noteReviewJobThrottle(
      'j1',
      { quotaCpus: 0.1, nrPeriods: 100, nrThrottled: 10, throttledMs: 1000 },
      { quotaCpus: 0.1, nrPeriods: 400, nrThrottled: 310, throttledMs: 31_000 },
      42_000,
    );
    expect(getReviewDecisionCost(0).lastJob?.throttle).toEqual({ nrThrottledDelta: 300, throttledMsDelta: 30_000, jobWallMs: 42_000 });
  });

  it('has no throttle delta when the counters are unreadable (not Linux, not a container)', () => {
    noteReviewDecisionCost(sample({ jobId: 'j1' }));
    noteReviewJobThrottle('j1', null, null, 1000);
    expect(getReviewDecisionCost(0).lastJob?.throttle).toBeNull();
  });

  it('reports memory: process rss, the worker heap against its cap, and worker restarts and out-of-memory kills', () => {
    noteReviewWorkerHealth({ heapUsedMb: 120, heapLimitMb: 256, restarts: 2, oom: 1 });
    const { memory } = getReviewDecisionCost(300 * 1048576);
    expect(memory).toEqual({ rssMb: 300, workerHeapUsedMb: 120, workerHeapLimitMb: 256, workerRestarts: 2, workerOomCount: 1 });
    // a later report without heap numbers keeps the last heap reading
    noteReviewWorkerHealth({ restarts: 3, oom: 1 });
    expect(getReviewDecisionCost(0).memory).toMatchObject({ workerHeapUsedMb: 120, workerRestarts: 3 });
  });

  it('keeps the one-time CPU benchmark result', () => {
    noteReviewCpuBenchmark({ snapshotId: 'hidden-allocation-ambiguous-midgame', runs: 20, medianMs: 250, minMs: 240, maxMs: 300, totalMs: 5100, cpuMs: 200, ranAt: 1_700_000_000_000 });
    expect(getReviewDecisionCost(0).benchmark).toMatchObject({ runs: 20, medianMs: 250, totalMs: 5100 });
  });

  it('never carries anything but counts, times and a job id', () => {
    noteReviewDecisionCost(sample());
    expect(Object.keys(getReviewDecisionCost(0).lastJob ?? {}).sort()).toEqual(
      ['attempt', 'byTier', 'ceilingHits', 'cpuToWallRatio', 'decisions', 'incomplete', 'jobId', 'maxWallMs', 'meanSamplesSolved', 'meanWallMs', 'threadCpuToWallRatio', 'throttle'],
    );
  });
});

describe('readCpuThrottle', () => {
  const files = (map: Record<string, string>) => (path: string) => { if (!(path in map)) throw new Error('ENOENT'); return map[path]!; };

  it('reads cgroup v2: the quota in cores and how often the container was throttled', () => {
    expect(readCpuThrottle(files({
      '/sys/fs/cgroup/cpu.stat': 'usage_usec 5\nnr_periods 1200\nnr_throttled 900\nthrottled_usec 4500000\n',
      '/sys/fs/cgroup/cpu.max': '10000 100000\n',
    }))).toEqual({ quotaCpus: 0.1, nrPeriods: 1200, nrThrottled: 900, throttledMs: 4500 });
  });

  it('treats "max" as no quota', () => {
    expect(readCpuThrottle(files({
      '/sys/fs/cgroup/cpu.stat': 'nr_periods 10\nnr_throttled 0\nthrottled_usec 0\n',
      '/sys/fs/cgroup/cpu.max': 'max 100000\n',
    }))?.quotaCpus).toBeNull();
  });

  it('falls back to cgroup v1', () => {
    expect(readCpuThrottle(files({
      '/sys/fs/cgroup/cpu/cpu.stat': 'nr_periods 50\nnr_throttled 20\nthrottled_time 3000000000\n',
      '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '50000\n',
      '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000\n',
    }))).toEqual({ quotaCpus: 0.5, nrPeriods: 50, nrThrottled: 20, throttledMs: 3000 });
  });

  it('is null when there is no cgroup to read (not Linux, not in a container)', () => {
    expect(readCpuThrottle(() => { throw new Error('ENOENT'); })).toBeNull();
  });
});
