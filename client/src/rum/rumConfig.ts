/** Share of page loads that report speed measurements. VITE_RUM_SAMPLE_RATE overrides it; 0 turns everything off (nothing loads, nothing sends). */
export const DEFAULT_RUM_SAMPLE_RATE = 0.25;

/** `raw` is VITE_RUM_SAMPLE_RATE. Unset gives the default (off in the dev server, so tests and local runs send nothing); anything unreadable is OFF. */
export function resolveRumSampleRate(raw: string | undefined, isDev: boolean): number {
  if (raw === undefined || raw.trim() === '') return isDev ? 0 : DEFAULT_RUM_SAMPLE_RATE;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(1, value);
}
