import { resolveRumSampleRate } from './rumConfig';

type Deps = {
  rate?: number;
  random?: () => number;
  load?: () => Promise<{ startCollector: () => unknown }>;
  whenIdle?: (run: () => void) => void;
};

/**
 * Decides, once per page load and in memory only (nothing is stored on the device), whether this visit is measured. Rate 0, or a visit
 * outside the sample, returns before anything is imported, listened to or sent. A sampled visit loads the collector after first paint, in
 * an idle callback, so it adds nothing to the cold-load JavaScript.
 */
export function startRumAfterFirstPaint(deps: Deps = {}): boolean {
  const rate = deps.rate ?? resolveRumSampleRate(import.meta.env.VITE_RUM_SAMPLE_RATE as string | undefined, import.meta.env.DEV === true);
  if (!(rate > 0)) return false;
  if (!((deps.random ?? Math.random)() < rate)) return false;
  const load = deps.load ?? (() => import('./rumCollector'));
  const idle = deps.whenIdle ?? ((run: () => void) => {
    const go = () => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(run, { timeout: 5000 }) : window.setTimeout(run, 2000));
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  });
  idle(() => { void load().then((m) => m.startCollector()).catch(() => undefined); });
  return true;
}
