/**
 * The Circuit is preserved in-repo but removed from flagship product surfaces.
 *
 * Opt-in recovery only:
 * - development builds
 * - AND VITE_ENABLE_CIRCUIT_MODE=true
 *
 * Production never discovers Circuit via normal navigation, even if the env
 * var is set (prevents accidental flagship resurfacing).
 */
export function parseCircuitModeFlag(value: unknown): boolean {
  return value === 'true';
}

export function isCircuitModeEnabled(
  value: unknown = import.meta.env.VITE_ENABLE_CIRCUIT_MODE,
  isDev: boolean = Boolean(import.meta.env.DEV),
): boolean {
  return isDev && parseCircuitModeFlag(value);
}

export function resolveCircuitGatedMode<T extends string>(
  mode: T,
  enabled = isCircuitModeEnabled(),
): T | 'singlePlayerHub' {
  return mode === 'circuit' && !enabled ? 'singlePlayerHub' : mode;
}
