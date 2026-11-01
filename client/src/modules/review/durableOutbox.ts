/**
 * A small durable outbox: park a payload in localStorage (bound to the signed-in account), send it with the caller's
 * sender, keep it on transient failure, drop it on success or a permanent refusal. Used for the saved game record and
 * the finished review, which share the delivery guarantee: stored first, delivered until the server says yes.
 *
 * This file must stay free of imports from the rest of the app (the auth layer imports the outboxes built on it to
 * clear them on account change, and an import back would close a dependency cycle).
 */

export type OutboxBody = { readonly gameDigest?: string };

export type OutboxEntry<B> = {
  readonly key: string;
  readonly userId: string;
  readonly queuedAt: number;
  readonly body: B;
};

export type OutboxSendResult = { readonly ok: true } | { readonly ok: false; readonly status?: number };
export type OutboxSender<B> = (body: B) => Promise<OutboxSendResult>;

export type OutboxFlushResult = {
  readonly sent: number;
  readonly remaining: number;
  /** Keys the server refused for good (not retried, removed from the queue). */
  readonly refused: readonly string[];
};

export type DurableOutboxOptions<B> = {
  readonly storageKey: string;
  readonly maxEntries: number;
  readonly maxAgeMs: number;
  /** One entry per key: queueing the same key again replaces. */
  readonly keyOf: (body: B) => string;
};

/** Not worth retrying: the server understood the request and refused it. */
function isPermanentRefusal(status: number | undefined): boolean {
  return status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
}

export function createDurableOutbox<B>(options: DurableOutboxOptions<B>) {
  const { storageKey, maxEntries, maxAgeMs, keyOf } = options;
  /** In-memory mirror so a full or blocked localStorage still lets this session retry. */
  const memory = new Map<string, OutboxEntry<B>>();
  let flushing: Promise<OutboxFlushResult> | null = null;

  function readStored(): OutboxEntry<B>[] {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((entry): entry is OutboxEntry<B> => (
        Boolean(entry)
        && typeof (entry as OutboxEntry<B>).key === 'string'
        && typeof (entry as OutboxEntry<B>).userId === 'string'
        && typeof (entry as OutboxEntry<B>).queuedAt === 'number'
        && typeof (entry as OutboxEntry<B>).body === 'object'
      ));
    } catch {
      return [];
    }
  }

  function writeStored(entries: readonly OutboxEntry<B>[]): void {
    if (typeof window === 'undefined') return;
    try {
      if (entries.length === 0) window.localStorage.removeItem(storageKey);
      else window.localStorage.setItem(storageKey, JSON.stringify(entries));
    } catch {
      // Quota or blocked storage: the in-memory copy still drives retries for this session.
    }
  }

  function all(now: number): OutboxEntry<B>[] {
    const merged = new Map<string, OutboxEntry<B>>();
    for (const entry of readStored()) merged.set(entry.key, entry);
    for (const entry of memory.values()) merged.set(entry.key, entry);
    return [...merged.values()]
      .filter((entry) => now - entry.queuedAt <= maxAgeMs)
      .sort((a, b) => b.queuedAt - a.queuedAt)
      .slice(0, maxEntries);
  }

  function persist(entries: readonly OutboxEntry<B>[]): void {
    memory.clear();
    for (const entry of entries) memory.set(entry.key, entry);
    writeStored(entries);
  }

  function list(now = Date.now()): OutboxEntry<B>[] {
    return all(now);
  }

  function enqueue(userId: string, body: B, now = Date.now()): OutboxEntry<B> {
    const entry: OutboxEntry<B> = { key: keyOf(body), userId, queuedAt: now, body };
    persist([entry, ...all(now).filter((existing) => existing.key !== entry.key)].slice(0, maxEntries));
    return entry;
  }

  function remove(key: string, now = Date.now()): void {
    persist(all(now).filter((entry) => entry.key !== key));
  }

  /** Account switch / sign-out: drop what belongs to the previous account (everything when no user is given). */
  function clear(userId?: string): void {
    if (userId === undefined) {
      persist([]);
      return;
    }
    persist(all(Date.now()).filter((entry) => entry.userId !== userId));
  }

  /**
   * Send everything queued for `userId`. Each entry is independent and the server write is idempotent, so a repeat is
   * always safe. One flush at a time; a second caller shares the first's result.
   */
  function flush(userId: string, send: OutboxSender<B>): Promise<OutboxFlushResult> {
    if (flushing) return flushing;
    flushing = (async () => {
      let sent = 0;
      const refused: string[] = [];
      for (const entry of all(Date.now()).filter((candidate) => candidate.userId === userId)) {
        let result: OutboxSendResult;
        try {
          result = await send(entry.body);
        } catch {
          result = { ok: false };
        }
        if (result.ok) {
          remove(entry.key);
          sent += 1;
        } else if (isPermanentRefusal(result.status)) {
          remove(entry.key);
          refused.push(entry.key);
        }
      }
      return { sent, refused, remaining: all(Date.now()).filter((candidate) => candidate.userId === userId).length };
    })().finally(() => { flushing = null; });
    return flushing;
  }

  /** Test seam. */
  function resetForTests(): void {
    memory.clear();
    flushing = null;
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem(storageKey); } catch { /* noop */ }
    }
  }

  return { list, enqueue, remove, clear, flush, resetForTests };
}
