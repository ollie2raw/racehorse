/**
 * Runs review position search in a worker thread so it can never block the
 * web server's event loop. One worker, one position at a time; a position
 * that exceeds its time limit has its worker terminated (the only way to stop
 * synchronous search) and fails with ReviewPositionBudgetExceeded, which the
 * pass records as FAILED_RETRYABLE. The next request starts a fresh worker.
 */
import path from 'node:path';
import { Worker, type ResourceLimits } from 'node:worker_threads';
import {
  adaptiveEvaluateReviewPosition,
  ReviewPositionBudgetExceeded,
  REVIEW_COMPLETION_POSITION_TIMEOUT_MS,
} from '@racehorse/review-engine';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { childLogger } from '../logger';

const log = childLogger('review-search-runner');

type EvaluateOptions = NonNullable<Parameters<typeof adaptiveEvaluateReviewPosition>[1]>;
type EvaluateResult = ReturnType<typeof adaptiveEvaluateReviewPosition>;

/** Resolves from both src/reviewCompletion and dist/reviewCompletion. */
export const REVIEW_SEARCH_WORKER_PATH = path.resolve(__dirname, '../../workers/reviewSearchWorker.cjs');

export const DEFAULT_REVIEW_WORKER_RESOURCE_LIMITS: ResourceLimits = {
  maxOldGenerationSizeMb: Number(process.env.REVIEW_WORKER_MAX_OLD_GEN_MB) || 256,
  maxYoungGenerationSizeMb: 32,
};

export class ReviewSearchWorkerExited extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewSearchWorkerExited';
  }
}

/** What the worker thread measured about the decision it just ran (its own wall time, thread CPU when Node can tell, its heap against its cap). */
export type ReviewWorkerMetrics = {
  readonly wallMs: number;
  readonly threadCpuMs: number | null;
  readonly heapUsedMb: number;
  readonly heapLimitMb: number;
};

/** The one-time CPU benchmark the worker runs on a fixed position (see reviewSearchWorker.cjs). */
export type ReviewCpuBenchmark = {
  readonly snapshotId: string;
  readonly runs: number;
  readonly medianMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly totalMs: number;
  readonly cpuMs: number | null;
};

type Pending = {
  readonly id: number;
  /** The worker serving this request; events from any other worker are stale. */
  readonly worker: Worker;
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export class ReviewSearchRunner {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  /** What the worker measured about the most recent decision it finished (calls are serialized, so this is that decision's). */
  lastMetrics: ReviewWorkerMetrics | null = null;
  /** Workers that exited or errored since this runner was created, and how many of those were out-of-memory. */
  workerRestarts = 0;
  workerOomCount = 0;
  private readonly workerPath: string;
  private readonly timeoutMs: number;
  private readonly resourceLimits: ResourceLimits;

  constructor(options: {
    readonly workerPath?: string;
    readonly timeoutMs?: number;
    readonly resourceLimits?: ResourceLimits;
  } = {}) {
    this.workerPath = options.workerPath ?? REVIEW_SEARCH_WORKER_PATH;
    this.timeoutMs = options.timeoutMs ?? REVIEW_COMPLETION_POSITION_TIMEOUT_MS;
    this.resourceLimits = options.resourceLimits ?? DEFAULT_REVIEW_WORKER_RESOURCE_LIMITS;
  }

  /** Evaluate one position off the main thread. Calls are serialized. */
  evaluate(snapshot: ReviewPositionSnapshotV2, options: EvaluateOptions = {}): Promise<EvaluateResult> {
    const run = this.queue.then(() => this.evaluateNow(snapshot, options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Run the fixed-position CPU benchmark in the worker thread (serialized with evaluations, so call it while no job is active). */
  benchmark(runs = 20): Promise<ReviewCpuBenchmark> {
    const run = this.queue.then(() => this.benchmarkNow(runs));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Stop the position in flight (e.g. the lease was lost). */
  abort(reason = 'review search aborted'): void {
    this.failPending(new ReviewSearchWorkerExited(reason));
    void this.killWorker();
  }

  async close(): Promise<void> {
    this.failPending(new ReviewSearchWorkerExited('review search runner closed'));
    await this.killWorker();
  }

  private benchmarkNow(runs: number): Promise<ReviewCpuBenchmark> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<ReviewCpuBenchmark>((resolve, reject) => {
      // Generous: 20 runs of a ~100-sample position even at 0.1 vCPU stay well inside this.
      const timer = setTimeout(() => {
        this.failPending(new ReviewPositionBudgetExceeded('review cpu benchmark exceeded its time limit'));
        void this.killWorker();
      }, 120_000);
      this.pending = { id, worker, resolve: resolve as (value: unknown) => void, reject, timer };
      worker.postMessage({ type: 'benchmark', id, runs });
    });
  }

  private evaluateNow(snapshot: ReviewPositionSnapshotV2, options: EvaluateOptions): Promise<EvaluateResult> {
    // Functions cannot cross the thread boundary; the pass checks shouldAbort
    // between positions on the main thread instead.
    const { shouldAbort: _shouldAbort, ...transferable } = options;
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<EvaluateResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        log.warn({ id, timeoutMs: this.timeoutMs }, 'review position exceeded its time limit; terminating worker');
        this.failPending(new ReviewPositionBudgetExceeded(
          `review position exceeded ${this.timeoutMs}ms`,
        ));
        void this.killWorker();
      }, this.timeoutMs);
      this.pending = { id, worker, resolve: resolve as (value: unknown) => void, reject, timer };
      worker.postMessage({ id, snapshot, options: transferable });
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerPath, { resourceLimits: this.resourceLimits });
    worker.unref();
    worker.on('message', (message: { id: number; ok: boolean; result?: EvaluateResult; metrics?: ReviewWorkerMetrics; benchmark?: ReviewCpuBenchmark; error?: string }) => {
      const pending = this.pending;
      if (!pending || pending.id !== message.id) return;
      this.pending = null;
      clearTimeout(pending.timer);
      if (message.metrics) this.lastMetrics = message.metrics;
      if (message.ok) pending.resolve(message.benchmark ?? message.result);
      else pending.reject(new Error(message.error ?? 'review search failed'));
    });
    worker.on('error', (error: Error) => {
      if ((error as NodeJS.ErrnoException).code === 'ERR_WORKER_OUT_OF_MEMORY') this.workerOomCount += 1;
      log.warn({ err: error }, 'review search worker error');
      if (this.worker === worker) this.worker = null;
      this.failPending(new ReviewSearchWorkerExited(`review search worker error: ${error.message}`), worker);
    });
    worker.on('exit', (code) => {
      // Every worker lifetime ends here (a timeout kill, a crash, an out-of-memory); a clean close at shutdown is the only expected one.
      if (code !== 0) this.workerRestarts += 1;
      if (this.worker === worker) this.worker = null;
      // A worker terminated after a timeout exits later; it must not fail the
      // request a fresh worker is already serving.
      this.failPending(new ReviewSearchWorkerExited(`review search worker exited (code ${code})`), worker);
    });
    this.worker = worker;
    return worker;
  }

  private failPending(error: Error, fromWorker?: Worker): void {
    const pending = this.pending;
    if (!pending) return;
    if (fromWorker && pending.worker !== fromWorker) return;
    this.pending = null;
    clearTimeout(pending.timer);
    pending.reject(error);
  }

  private async killWorker(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}
