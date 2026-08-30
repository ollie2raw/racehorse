import { getSocketTrace } from './socketTrace';
import { logger } from '../utils/logger';

/**
 * Global logging only.
 *
 * This used to also run the stale-chunk recovery reload, matching on the
 * error message of *any* uncaught error or rejected promise. That could not
 * tell a chunk the UI needs from a telemetry chunk nobody would notice, so a
 * failed web-vitals fetch could reload a working app mid-match. Recovery now
 * runs from the ErrorBoundary, where a chunk failure has demonstrably broken
 * something the user can see — see debug/moduleImportRecovery.ts.
 */
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (e) => {
    logger.error('globalErrors.ts', e.error ?? e.message, { socketTrace: getSocketTrace() });
  });

  window.addEventListener('unhandledrejection', (e) => {
    logger.error('globalErrors.ts', e.reason, { socketTrace: getSocketTrace() });
  });
}
