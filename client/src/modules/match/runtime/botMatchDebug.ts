export const BOT_MATCH_DEBUG_ENV =
  import.meta.env.DEV === true || import.meta.env.VITE_DEBUG_BOT_MATCH === 'true';

export function hasDebugLocalStorageFlag(key: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(key) === '1';
}

export function shouldLogBotMatchDebug(): boolean {
  return BOT_MATCH_DEBUG_ENV || hasDebugLocalStorageFlag('BOT_DEBUG');
}

export function botMatchDebugLog(...args: unknown[]): void {
  if (shouldLogBotMatchDebug()) console.log(...args);
}
