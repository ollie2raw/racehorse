/**
 * Feature flag for the Stakes prototype mode.
 *
 * ONLY enabled in development builds AND when VITE_ENABLE_STAKES_PROTOTYPE=true.
 */
export function isStakesPrototypeEnabled(
  value: unknown = import.meta.env.VITE_ENABLE_STAKES_PROTOTYPE,
  isDev: boolean = Boolean(import.meta.env.DEV),
): boolean {
  if (typeof window !== 'undefined') {
    const override = (window as Window & { __STAKES_ENABLED_OVERRIDE__?: unknown })
      .__STAKES_ENABLED_OVERRIDE__;
    if (override !== undefined) return override === true;
  }
  return isDev && value === 'true';
}

export function resolveStakesGatedMode<T extends string>(
  mode: T,
  enabled = isStakesPrototypeEnabled(),
): T | 'singlePlayerHub' {
  return mode === 'stakes' && !enabled ? 'singlePlayerHub' : mode;
}
