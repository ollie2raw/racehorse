/**
 * Durable outbox for the finished-review save (`POST /api/game-reviews`).
 *
 * The save used to be one fire-and-forget request from a React effect: close the tab, background the phone or hit one
 * transient error and the finished review was never written to the player's history. Now the body is parked here
 * first (localStorage, bound to the signed-in account), sent with backoff while the page is open, and sent again on
 * the next app load, when the device comes back online, or when the tab becomes visible. The server write is
 * idempotent (by game digest), so a retry or a double send is always safe.
 *
 * This is the same shape as a chess.com game save: the game is stored first, delivery is retried until it lands.
 */

export const REVIEW_WRITE_OUTBOX_KEY = 'racehorse_review_write_outbox_v1';
/** Keep the newest few: a replay artifact is large and localStorage is small. */
export const REVIEW_WRITE_OUTBOX_MAX_ENTRIES = 3;
export const REVIEW_WRITE_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Delay before the Nth automatic retry while the page stays open (then it waits for the next load / online event). */
export const REVIEW_WRITE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 45_000, 120_000] as const;

/**
 * All the outbox needs to know about a queued body: its game digest (the key). Deliberately not the full review type, so
 * this module (which the auth layer imports to clear it on account change) never depends back on the review modules.
 */
export type ReviewWriteBodyBase = { readonly gameDigest: string };

export type ReviewWriteOutboxEntry = {
  /** Game digest: one entry per game, so re-queueing replaces. */
  readonly key: string;
  readonly userId: string;
  readonly queuedAt: number;
  readonly body: ReviewWriteBodyBase;
};

export type ReviewWriteSendResult = { readonly ok: true } | { readonly ok: false; readonly status?: number };
export type ReviewWriteSender<T extends ReviewWriteBodyBase = ReviewWriteBodyBase> = (body: T) => Promise<ReviewWriteSendResult>;

/** In-memory mirror so a full or blocked localStorage still lets this session retry. */
const memory = new Map<string, ReviewWriteOutboxEntry>();

function readStored(): ReviewWriteOutboxEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(REVIEW_WRITE_OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ReviewWriteOutboxEntry => (
      Boolean(entry)
      && typeof (entry as ReviewWriteOutboxEntry).key === 'string'
      && typeof (entry as ReviewWriteOutboxEntry).userId === 'string'
      && typeof (entry as ReviewWriteOutboxEntry).queuedAt === 'number'
      && typeof (entry as ReviewWriteOutboxEntry).body === 'object'
    ));
  } catch {
    return [];
  }
}

function writeStored(entries: readonly ReviewWriteOutboxEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (entries.length === 0) window.localStorage.removeItem(REVIEW_WRITE_OUTBOX_KEY);
    else window.localStorage.setItem(REVIEW_WRITE_OUTBOX_KEY, JSON.stringify(entries));
  } catch {
    // Quota or blocked storage: the in-memory copy still drives retries for this session.
  }
}

function allEntries(now: number): ReviewWriteOutboxEntry[] {
  const merged = new Map<string, ReviewWriteOutboxEntry>();
  for (const entry of readStored()) merged.set(entry.key, entry);
  for (const entry of memory.values()) merged.set(entry.key, entry);
  return [...merged.values()]
    .filter((entry) => now - entry.queuedAt <= REVIEW_WRITE_OUTBOX_MAX_AGE_MS)
    .sort((a, b) => b.queuedAt - a.queuedAt)
    .slice(0, REVIEW_WRITE_OUTBOX_MAX_ENTRIES);
}

function persist(entries: readonly ReviewWriteOutboxEntry[]): void {
  memory.clear();
  for (const entry of entries) memory.set(entry.key, entry);
  writeStored(entries);
}

export function listReviewWriteOutbox(now = Date.now()): ReviewWriteOutboxEntry[] {
  return allEntries(now);
}

export function enqueueReviewWrite(userId: string, body: ReviewWriteBodyBase, now = Date.now()): ReviewWriteOutboxEntry {
  const entry: ReviewWriteOutboxEntry = { key: body.gameDigest, userId, queuedAt: now, body };
  persist([entry, ...allEntries(now).filter((existing) => existing.key !== entry.key)].slice(0, REVIEW_WRITE_OUTBOX_MAX_ENTRIES));
  return entry;
}

export function removeReviewWrite(key: string, now = Date.now()): void {
  persist(allEntries(now).filter((entry) => entry.key !== key));
}

/** Account switch / sign-out: drop what belongs to the previous account. */
export function clearReviewWriteOutbox(userId?: string): void {
  if (userId === undefined) {
    persist([]);
    return;
  }
  persist(allEntries(Date.now()).filter((entry) => entry.userId !== userId));
}

/** Not worth retrying: the server understood the request and refused it. */
function isPermanentRefusal(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export type ReviewWriteFlushResult = {
  readonly sent: number;
  readonly remaining: number;
  /** Keys the server refused for good (not retried, removed from the queue). */
  readonly refused: readonly string[];
};

let flushing: Promise<ReviewWriteFlushResult> | null = null;

/**
 * Send everything queued for `userId`, oldest-failed-first is irrelevant: each entry is independent and idempotent.
 * One flush at a time; a second caller shares the first's result.
 */
export function flushReviewWriteOutbox<T extends ReviewWriteBodyBase = ReviewWriteBodyBase>(userId: string, send: ReviewWriteSender<T>): Promise<ReviewWriteFlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    const refused: string[] = [];
    for (const entry of allEntries(Date.now()).filter((candidate) => candidate.userId === userId)) {
      let result: ReviewWriteSendResult;
      try {
        result = await send(entry.body as T);
      } catch {
        result = { ok: false };
      }
      if (result.ok) {
        removeReviewWrite(entry.key);
        sent += 1;
      } else if (isPermanentRefusal(result.status)) {
        removeReviewWrite(entry.key);
        refused.push(entry.key);
      }
    }
    return { sent, refused, remaining: allEntries(Date.now()).filter((candidate) => candidate.userId === userId).length };
  })().finally(() => { flushing = null; });
  return flushing;
}

/** Test seam. */
export function resetReviewWriteOutboxForTests(): void {
  memory.clear();
  flushing = null;
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(REVIEW_WRITE_OUTBOX_KEY); } catch { /* noop */ }
  }
}
