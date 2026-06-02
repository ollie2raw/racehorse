import { getSocketTrace } from './socketTrace';

const MODULE_IMPORT_RECOVERY_KEY = 'rh:module-import-recovery';

function isModuleImportFailure(reason: unknown): boolean {
  if (reason instanceof Error) {
    const msg = `${reason.name}: ${reason.message}`;
    return /Importing a module script failed/i.test(msg);
  }
  if (typeof reason === 'string') {
    return /Importing a module script failed/i.test(reason);
  }
  return false;
}

function recoverFromModuleImportFailure(reason: unknown): void {
  if (!isModuleImportFailure(reason)) return;
  try {
    if (sessionStorage.getItem(MODULE_IMPORT_RECOVERY_KEY) === '1') return;
    sessionStorage.setItem(MODULE_IMPORT_RECOVERY_KEY, '1');
    // Stale chunk/index mismatch after deploy: force a clean entry HTML fetch once.
    const bust = `rh_reload=${Date.now()}`;
    const separator = window.location.search ? '&' : '?';
    window.location.replace(`${window.location.pathname}${window.location.search}${separator}${bust}${window.location.hash}`);
  } catch {
    // Ignore storage/navigation failures and keep existing logging.
  }
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (e) => {
    console.error('Global error:', e.error ?? e.message);
    console.error('Last socket events:', getSocketTrace());
    recoverFromModuleImportFailure(e.error ?? e.message);
  });

  window.addEventListener('unhandledrejection', (e) => {
    console.error('Unhandled rejection:', e.reason);
    console.error('Last socket events:', getSocketTrace());
    recoverFromModuleImportFailure(e.reason);
  });
}
