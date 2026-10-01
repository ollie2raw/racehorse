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

type Pending = {
  readonly id: number;
  /** The worker serving this request; events from any other worker are stale. */
  readonly worker: Worker;
  readonly resolve: (result: EvaluateResult) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export class ReviewSearchRunner {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private nextId = 1;
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

  /** Stop the position in flight (e.g. the lease was lost). */
  abort(reason = 'review search aborted'): void {
    this.failPending(new ReviewSearchWorkerExited(reason));
    void this.killWorker();
  }

  async close(): Promise<void> {
    this.failPending(new ReviewSearchWorkerExited('review search runner closed'));
    await this.killWorker();
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
      this.pending = { id, worker, resolve, reject, timer };
      worker.postMessage({ id, snapshot, options: transferable });
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerPath, { resourceLimits: this.resourceLimits });
    worker.unref();
    worker.on('message', (message: { id: number; ok: boolean; result?: EvaluateResult; error?: string }) => {
      const pending = this.pending;
      if (!pending || pending.id !== message.id) return;
      this.pending = null;
      clearTimeout(pending.timer);
      if (message.ok) pending.resolve(message.result as EvaluateResult);
      else pending.reject(new Error(message.error ?? 'review search failed'));
    });
    worker.on('error', (error: Error) => {
      log.warn({ err: error }, 'review search worker error');
      if (this.worker === worker) this.worker = null;
      this.failPending(new ReviewSearchWorkerExited(`review search worker error: ${error.message}`), worker);
    });
    worker.on('exit', (code) => {
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
