/**
 * Journey's account sync, with its I/O injected (docs/progress-sync.md). Local storage stays the source the app reads and writes; this only moves what is
 * missing in each direction, as a union, so it can never take progress away.
 *
 *   start()         pull on sign-in: GET what the server has, merge it into this browser, and send back anything this browser has that the server lacks
 *   schedulePush()  after a local save: debounced POST of the local progress; the answer is merged back in case another device added stages meanwhile
 *   flushNow()      push now (the tab is being hidden)
 *   retryNow()      try again after a failure (the network came back, the tab returned)
 *   refresh()       pull again (the tab returned after a while)
 *   dispose()       the account changed or the app is closing: stop, and apply nothing that is still in flight
 *
 * Offline safe: a failed request changes nothing locally and is retried with a growing delay; the player never sees it. When the server says it is not enabled
 * (flag off, table not created, an older server) the controller goes quiet for good.
 */
import { applySyncedToLocal, EMPTY_SYNCED, mergeSynced, readSyncedProgress, syncedEqual, toSyncedProgress } from './journeyProgressSync';
import type { SyncedProgress } from './journeyProgressSync';
import type { JourneyProgress } from './journeyTypes';

export type ProgressSyncResponse = { ok: false } | { ok: true; enabled: boolean; progress: unknown };

export interface ProgressSyncDeps {
  get(): Promise<ProgressSyncResponse>;
  post(progress: SyncedProgress): Promise<ProgressSyncResponse>;
  load(): JourneyProgress;
  save(progress: JourneyProgress): void;
  /** False once the account this controller was made for is no longer the one the local store points at: nothing may be read or written then. */
  scopeIsCurrent(): boolean;
  /** Tell whatever is showing progress that the stored copy changed underneath it. */
  onApplied(): void;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 2_000;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 5 * 60_000;

export interface ProgressSyncController {
  start(): Promise<void>;
  schedulePush(): void;
  flushNow(): Promise<void>;
  retryNow(): Promise<void>;
  /** Pull again (the tab came back, so another device may have added stages meanwhile). */
  refresh(): Promise<void>;
  dispose(): void;
}

export function createJourneyProgressSync(deps: ProgressSyncDeps): ProgressSyncController {
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let disposed = false;
  let disabled = false;
  let running = false;
  let rerun = false;
  let failures = 0;
  /** What the server last told us it holds (its answer, as read). Null until the first answer. */
  let lastKnown: SyncedProgress | null = null;
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const alive = (): boolean => !disposed && !disabled && deps.scopeIsCurrent();

  function clearTimers(): void {
    if (pushTimer) clearTimeout(pushTimer);
    if (retryTimer) clearTimeout(retryTimer);
    pushTimer = null;
    retryTimer = null;
  }

  function applyToLocal(incoming: SyncedProgress): void {
    const next = applySyncedToLocal(deps.load(), incoming);
    if (!next) return;
    deps.save(next);
    deps.onApplied();
  }

  function failed(): void {
    failures += 1;
    if (retryTimer) clearTimeout(retryTimer);
    const delay = Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS);
    retryTimer = setTimeout(() => void retryNow(), delay);
  }

  /** The answer of a request: false when there is nothing more to do with it (failed, not enabled, or we were disposed while it was in flight). */
  function accept(response: ProgressSyncResponse): response is { ok: true; enabled: true; progress: unknown } {
    if (!alive()) return false;
    if (!response.ok) {
      failed();
      return false;
    }
    failures = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (!response.enabled) {
      disabled = true;
      clearTimers();
      return false;
    }
    return true;
  }

  /** GET, merge into local, and POST back whatever the server lacks. */
  async function pull(): Promise<void> {
    if (!alive()) return;
    const response = await safely(() => deps.get());
    if (!accept(response)) return;
    const remote = readSyncedProgress((response as { progress: unknown }).progress);
    lastKnown = remote;
    applyToLocal(remote);
    await pushIfServerLacksSomething();
  }

  async function pushIfServerLacksSomething(): Promise<void> {
    if (!alive()) return;
    const local = toSyncedProgress(deps.load());
    const known = lastKnown ?? EMPTY_SYNCED;
    // The server already holds everything local has: merging local into it changes nothing.
    if (syncedEqual(mergeSynced(known, local), known)) return;
    const response = await safely(() => deps.post(local));
    if (!accept(response)) return;
    const merged = readSyncedProgress((response as { progress: unknown }).progress);
    lastKnown = merged;
    applyToLocal(merged);
  }

  async function push(): Promise<void> {
    if (lastKnown === null) return pull();
    return pushIfServerLacksSomething();
  }

  /** One request cycle at a time; a change that arrives while one is running earns exactly one more cycle afterwards. */
  async function exclusive(work: () => Promise<void>): Promise<void> {
    if (!alive()) return;
    if (running) {
      rerun = true;
      return;
    }
    running = true;
    try {
      await work();
      while (rerun && alive()) {
        rerun = false;
        await push();
      }
    } finally {
      running = false;
      rerun = false;
    }
  }

  async function retryNow(): Promise<void> {
    if (!alive() || failures === 0) return;
    await exclusive(push);
  }

  return {
    start: () => exclusive(pull),
    schedulePush() {
      if (!alive()) return;
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = setTimeout(() => {
        pushTimer = null;
        void exclusive(push);
      }, debounceMs);
    },
    flushNow() {
      if (pushTimer) clearTimeout(pushTimer);
      pushTimer = null;
      return exclusive(push);
    },
    retryNow,
    refresh: () => exclusive(pull),
    dispose() {
      disposed = true;
      clearTimers();
    },
  };
}

/** A transport that throws is a failed request, not an unhandled rejection. */
async function safely(request: () => Promise<ProgressSyncResponse>): Promise<ProgressSyncResponse> {
  try {
    return await request();
  } catch {
    return { ok: false };
  }
}
