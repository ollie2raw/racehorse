/** Pure helpers: what a summary contains. Nothing here reads an identifier; every value is a band, a version or a whole number of milliseconds. */
export const BEACON_VERSION = 1;
export const MAX_SAMPLES_PER_METRIC = 60;

export type Scr = 'xs' | 's' | 'm' | 'l';
export type Mem = 'le2' | '4' | '8p' | 'na';
export type Net = 'slow' | '3g' | '4g' | 'na';
export type Form = 'phone' | 'tablet' | 'desktop';
export type Plat = 'web' | 'ios' | 'android';

/** Short side of the screen in CSS pixels: under 400, 400-599, 600-1023, 1024 and up. */
export const bandScreen = (shortSide: number): Scr => (shortSide < 400 ? 'xs' : shortSide < 600 ? 's' : shortSide < 1024 ? 'm' : 'l');

/** navigator.deviceMemory (Chromium only, already rounded by the browser): up to 2 GB, 4 GB, 8 GB or more, or not shared. */
export function bandMemory(deviceMemory: unknown): Mem {
  if (typeof deviceMemory !== 'number' || !Number.isFinite(deviceMemory) || deviceMemory <= 0) return 'na';
  return deviceMemory <= 2 ? 'le2' : deviceMemory <= 4 ? '4' : '8p';
}

/** navigator.connection.effectiveType (Chromium only). */
export function bandNet(effectiveType: unknown): Net {
  if (effectiveType === 'slow-2g' || effectiveType === '2g') return 'slow';
  return effectiveType === '3g' ? '3g' : effectiveType === '4g' ? '4g' : 'na';
}

/** Touch-only devices are phones under 600 CSS px on the short side and tablets above it; everything else is a computer. */
export const formOf = (touchOnly: boolean, shortSide: number): Form => (!touchOnly ? 'desktop' : shortSide < 600 ? 'phone' : 'tablet');

export function summarize(samples: readonly number[]): [number, number, number] | null {
  const clean = samples.filter((v) => Number.isFinite(v) && v >= 0).map((v) => Math.min(600_000, Math.round(v))).sort((a, b) => a - b);
  if (clean.length === 0) return null;
  const median = clean[Math.floor((clean.length - 1) / 2)]!;
  return [clean.length, median, clean[clean.length - 1]!];
}

export type BeaconContext = { app: string; plat: Plat; form: Form; scr: Scr; mem: Mem; net: Net };
export type Beacon = BeaconContext & { v: 1; m: Record<string, [number, number, number]> };

/** Returns null when there is nothing to report. */
export function buildBeacon(context: BeaconContext, samples: ReadonlyMap<string, readonly number[]>): Beacon | null {
  const m: Record<string, [number, number, number]> = {};
  for (const [metric, values] of samples) {
    const summary = summarize(values);
    if (summary) m[metric] = summary;
  }
  if (Object.keys(m).length === 0) return null;
  return { v: BEACON_VERSION, app: context.app, plat: context.plat, form: context.form, scr: context.scr, mem: context.mem, net: context.net, m };
}
