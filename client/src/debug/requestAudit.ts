/**
 * TEMPORARY, DEV-ONLY request auditing.
 *
 * Counts every request that passes through `api/client.ts` and flags repeats of
 * the same method + path inside a short window — the signature of two callers
 * independently asking for the same resource, or one effect firing more than
 * once.
 *
 * Inert unless explicitly switched on, so it costs nothing by default:
 *
 *     localStorage.REQUEST_AUDIT = '1'   // then reload
 *
 * Read it from the console:
 *
 *     __racehorseRequestAudit.summary()   // per-endpoint counts, duplicates first
 *     __racehorseRequestAudit.table()     // same, as a console.table
 *     __racehorseRequestAudit.reset()     // zero the counters before a flow
 *
 * Removal is one commit: delete this file and the `recordApiRequest` call in
 * `api/client.ts`.
 */

/** Repeats of the same key within this window are reported as duplicates. */
const DUPLICATE_WINDOW_MS = 2_000;

export type RequestAuditEntry = {
  key: string;
  method: string;
  path: string;
  count: number;
  duplicates: number;
  firstAt: number;
  lastAt: number;
  /** Gaps in ms between consecutive calls, newest last. */
  gaps: number[];
};

type AuditState = {
  startedAt: number;
  entries: Map<string, RequestAuditEntry>;
};

const state: AuditState = { startedAt: Date.now(), entries: new Map() };

function auditEnabled(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem('REQUEST_AUDIT') === '1';
  } catch {
    return false;
  }
}

/**
 * Strip the origin and normalise volatile path segments so that the same
 * logical endpoint aggregates into one row — `/api/ranking/profile/<uuid>`
 * should not read as a different endpoint per user.
 */
export function normalizeAuditPath(url: string): string {
  let path = url;
  const schemeAt = path.indexOf('://');
  if (schemeAt >= 0) {
    const slash = path.indexOf('/', schemeAt + 3);
    path = slash >= 0 ? path.slice(slash) : '/';
  }
  path = path.split('?')[0] ?? path;
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/\d{4}-\d{2}-\d{2}/g, '/:date');
}

/** Called from api/client.ts for every outgoing request. No-op when disabled. */
export function recordApiRequest(method: string, url: string): void {
  if (!auditEnabled()) return;
  const path = normalizeAuditPath(url);
  const key = `${method.toUpperCase()} ${path}`;
  const now = Date.now();
  const existing = state.entries.get(key);

  if (!existing) {
    state.entries.set(key, {
      key,
      method: method.toUpperCase(),
      path,
      count: 1,
      duplicates: 0,
      firstAt: now,
      lastAt: now,
      gaps: [],
    });
    return;
  }

  const gap = now - existing.lastAt;
  existing.count += 1;
  existing.lastAt = now;
  existing.gaps.push(gap);
  if (gap <= DUPLICATE_WINDOW_MS) {
    existing.duplicates += 1;
    // eslint-disable-next-line no-console
    console.warn(
      `[request-audit] duplicate ${key} — call #${existing.count}, ${gap}ms after the previous one`,
    );
  }
}

export type RequestAuditSummary = {
  elapsedMs: number;
  totalRequests: number;
  uniqueEndpoints: number;
  duplicateRequests: number;
  entries: RequestAuditEntry[];
};

export function getRequestAuditSummary(): RequestAuditSummary {
  const entries = [...state.entries.values()].sort(
    (a, b) => b.duplicates - a.duplicates || b.count - a.count || a.key.localeCompare(b.key),
  );
  return {
    elapsedMs: Date.now() - state.startedAt,
    totalRequests: entries.reduce((sum, e) => sum + e.count, 0),
    uniqueEndpoints: entries.length,
    duplicateRequests: entries.reduce((sum, e) => sum + e.duplicates, 0),
    entries,
  };
}

export function resetRequestAudit(): void {
  state.entries.clear();
  state.startedAt = Date.now();
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as Window & { __racehorseRequestAudit?: unknown }).__racehorseRequestAudit = {
    summary: getRequestAuditSummary,
    reset: resetRequestAudit,
    table() {
      const { entries, ...totals } = getRequestAuditSummary();
      // eslint-disable-next-line no-console
      console.log('[request-audit]', totals);
      // eslint-disable-next-line no-console
      console.table(
        entries.map((e) => ({
          endpoint: e.key,
          calls: e.count,
          duplicates: e.duplicates,
          spanMs: e.lastAt - e.firstAt,
        })),
      );
    },
  };
}
