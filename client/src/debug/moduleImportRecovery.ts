/**
 * Recovery from a stale chunk after a deploy.
 *
 * When a new build lands, an already-open tab holds an index.html that points
 * at hashed chunks the new deploy no longer serves. The next lazy route the
 * user opens fails to import, and the page is stuck until they reload by hand.
 * One automatic reload fixes it, because the reload fetches a fresh entry HTML.
 *
 * This used to run from the global `error` and `unhandledrejection` handlers,
 * which meant it fired for *any* rejected promise whose message matched —
 * including a telemetry chunk that no user could notice failing. That reloaded
 * working apps out from under people, potentially mid-match. It now runs only
 * where a chunk failure has actually broken UI: from an ErrorBoundary, which
 * is what catches a failed `React.lazy` import.
 */

export const MODULE_IMPORT_RECOVERY_KEY = 'rh:module-import-recovery';

/** The query key the reload adds, and strips before adding again. */
const CACHE_BUST_PARAM = 'rh_reload';

/**
 * Browser wordings for "a dynamic import did not load". They differ per engine
 * and the production report came from WebKit, so all four are matched.
 */
const CHUNK_FAILURE_PATTERNS = [
  /Importing a module script failed/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
];

export type RecoveryOutcome = 'reloaded' | 'already-attempted' | 'ignored';

export type RecoveryDeps = {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  reload: (href: string) => void;
  href: string;
};

function defaultDeps(): RecoveryDeps | null {
  if (typeof window === 'undefined') return null;
  return {
    storage: window.sessionStorage,
    reload: (href) => window.location.replace(href),
    href: `${window.location.pathname}${window.location.search}${window.location.hash}`,
  };
}

export function isChunkLoadFailure(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : '';
  if (!message) return false;
  return CHUNK_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

/** Adds a fresh cache-buster, replacing any left by a previous recovery. */
function bustedHref(href: string): string {
  const [pathAndQuery = '', hash = ''] = href.split('#');
  const [path = '', query = ''] = pathAndQuery.split('?');
  const params = new URLSearchParams(query);
  params.delete(CACHE_BUST_PARAM);
  params.set(CACHE_BUST_PARAM, String(Date.now()));
  return `${path}?${params.toString()}${hash ? `#${hash}` : ''}`;
}

/**
 * One reload per tab, per successful load. The guard stops a genuinely broken
 * deploy from putting a tab into a reload loop; `markAppLoadSuccessful` lifts
 * it once the app is up, so a later deploy can still be recovered from.
 */
export function recoverFromChunkLoadFailure(
  error: unknown,
  deps: RecoveryDeps | null = defaultDeps(),
): RecoveryOutcome {
  if (!deps) return 'ignored';
  if (!isChunkLoadFailure(error)) return 'ignored';

  try {
    if (deps.storage.getItem(MODULE_IMPORT_RECOVERY_KEY) === '1') return 'already-attempted';
    deps.storage.setItem(MODULE_IMPORT_RECOVERY_KEY, '1');
  } catch {
    // Storage unavailable (private mode, blocked cookies). Without a guard a
    // reload could loop, so decline rather than risk it.
    return 'already-attempted';
  }

  try {
    deps.reload(bustedHref(deps.href));
    return 'reloaded';
  } catch {
    return 'already-attempted';
  }
}

/**
 * Clears the guard once the app has come up.
 *
 * Without this the marker was set and never removed, so a tab got exactly one
 * recovery for its whole lifetime — and mobile tabs live for weeks. A real
 * stale-deploy failure months later had no recovery left.
 */
export function markAppLoadSuccessful(deps: RecoveryDeps | null = defaultDeps()): void {
  if (!deps) return;
  try {
    deps.storage.removeItem(MODULE_IMPORT_RECOVERY_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
