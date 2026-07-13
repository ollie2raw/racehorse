export function parseSpectatorModeFlag(value: unknown): boolean {
  return value === 'true';
}

export function isSpectatorModeEnabled(value: unknown = import.meta.env.VITE_ENABLE_SPECTATOR_MODE): boolean {
  return parseSpectatorModeFlag(value);
}

export function resolveSpectatorGatedMode<T extends string>(mode: T, enabled = isSpectatorModeEnabled()): T | 'home' {
  return mode === 'live' && !enabled ? 'home' : mode;
}
