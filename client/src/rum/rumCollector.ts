/**
 * The speed-measurement collector (docs/ops/rum-beacon.md). Loaded lazily, after first paint, only in a sampled visit (startRum.ts).
 *
 * It times what the player waits for by watching what the screens already render (rumSelectors.ts), so no screen carries timing code:
 *   - a tap to the next screen appearing (hub, setup, Play vs Fritz match, Daily match, multiplayer room), measured from the tap's timestamp
 *     to the frame after the screen appears;
 *   - a match appearing to the first tile the player can play;
 *   - the hand-result dialog closing to the first tile playable in the next hand;
 *   - hand:ready and room:join acknowledgements (rumRecord, called from the two places that await them);
 *   - INP, from web-vitals.
 * A summary (median and max per metric, plus coarse bands, never an identifier) is sent with navigator.sendBeacon when the tab is hidden or
 * the page is left, at most once per 20 minutes and three times per page load.
 */
import { analyticsPlatform } from '../lib/analytics';
import { resolveGameServerUrl } from '../lib/gameServerUrl';
import { MAX_SAMPLES_PER_METRIC, bandMemory, bandNet, bandScreen, buildBeacon, formOf, type BeaconContext } from './rumPayload';
import { SELECTORS } from './rumSelectors';
import { setRumSink } from './rumSink';

const NAV_WATCH_MS = 5_000;
const POLL_MS = 100;
const AWAIT_PLAYABLE_MAX_MS = 60_000;
export const MIN_SEND_GAP_MS = 20 * 60_000;
export const MAX_SENDS = 3;

const NAV_TARGETS: Array<{ metric: string; selector: string; match?: 'pvf' | 'daily' }> = [
  { metric: 'nav.home_to_hub', selector: SELECTORS.hub },
  { metric: 'nav.hub_to_setup', selector: SELECTORS.setup },
  { metric: 'nav.start_to_match.pvf', selector: SELECTORS.matchPvf, match: 'pvf' },
  { metric: 'nav.start_to_match.daily', selector: SELECTORS.matchDaily, match: 'daily' },
  { metric: 'nav.private_to_room.mp', selector: SELECTORS.room },
];

export type CollectorEnv = {
  doc: Document;
  win: Window;
  now: () => number;
  raf: (cb: () => void) => void;
  context: () => BeaconContext;
  send: (url: string, body: string) => void;
  loadVitals: () => Promise<{ onINP: (cb: (metric: { value: number }) => void, opts?: { reportAllChanges?: boolean }) => void }>;
  url: string;
};

function defaultContext(win: Window): BeaconContext {
  const nav = win.navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string } };
  const shortSide = Math.min(win.screen?.width || win.innerWidth, win.screen?.height || win.innerHeight);
  const touchOnly = typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse) and (hover: none)').matches;
  const version = String(import.meta.env.VITE_APP_VERSION ?? '').slice(0, 7);
  return {
    app: /^[A-Za-z0-9._-]{1,16}$/.test(version) ? version : 'dev',
    plat: analyticsPlatform(),
    form: formOf(touchOnly, shortSide),
    scr: bandScreen(shortSide),
    mem: bandMemory(nav.deviceMemory),
    net: bandNet(nav.connection?.effectiveType),
  };
}

function defaultEnv(): CollectorEnv {
  return {
    doc: document,
    win: window,
    now: () => performance.now(),
    raf: (cb) => { window.requestAnimationFrame(() => window.requestAnimationFrame(cb)); },
    context: () => defaultContext(window),
    // sendBeacon only: if the browser declines it the summary is dropped (these are statistics, not state worth a retry).
    send: (url, body) => {
      if (typeof navigator.sendBeacon === 'function') navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
    },
    loadVitals: () => import('web-vitals') as Promise<{ onINP: (cb: (metric: { value: number }) => void, opts?: { reportAllChanges?: boolean }) => void }>,
    url: `${resolveGameServerUrl()}/api/rum`,
  };
}

export function startCollector(env: CollectorEnv = defaultEnv()): () => void {
  const { doc, win } = env;
  const samples = new Map<string, number[]>();
  let inp: number | null = null;
  let inpReported: number | null = null;
  let sends = 0;
  let lastSendAt = -Infinity;

  const record = (metric: string, ms: number): void => {
    if (!Number.isFinite(ms) || ms < 0) return;
    const list = samples.get(metric) ?? [];
    if (list.length < MAX_SAMPLES_PER_METRIC) list.push(Math.round(ms));
    samples.set(metric, list);
  };
  setRumSink(record);

  // ── a tap, then the next screen ──
  let navObserver: MutationObserver | null = null;
  let navTimer: number | null = null;
  let appearedMatch: { kind: 'pvf' | 'daily'; at: number } | null = null;
  const matchOnScreen = (): boolean => doc.querySelector('.bot-match-screen') !== null;
  const stopNavWatch = (): void => {
    navObserver?.disconnect();
    navObserver = null;
    if (navTimer !== null) win.clearTimeout(navTimer);
    navTimer = null;
  };
  const onPointerDown = (event: Event): void => {
    if (matchOnScreen()) return; // a tap during play is not a navigation: never watch the board
    stopNavWatch();
    const tappedAt = (event as PointerEvent).timeStamp || env.now();
    const before = new Set(NAV_TARGETS.filter((t) => doc.querySelector(t.selector)).map((t) => t.metric));
    const check = (): void => {
      const found = NAV_TARGETS.find((t) => !before.has(t.metric) && doc.querySelector(t.selector));
      if (!found) return;
      stopNavWatch();
      env.raf(() => {
        const at = env.now();
        record(found.metric, at - tappedAt);
        if (found.match) appearedMatch = { kind: found.match, at };
      });
    };
    const observer = new MutationObserver(check);
    navObserver = observer;
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    navTimer = win.setTimeout(stopNavWatch, NAV_WATCH_MS);
  };
  doc.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });

  // ── the match, the hand result, the first playable tile (seconds, so a light poll is enough) ──
  let match: { kind: 'pvf' | 'daily' | 'mp'; t0: number; done: boolean } | null = null;
  let modalOpen = false;
  let awaiting: { t0: number; kind: 'solo' | 'mp' } | null = null;
  const tick = (): void => {
    if (doc.hidden) return;
    const kind = doc.querySelector(SELECTORS.matchDaily) ? 'daily' : doc.querySelector(SELECTORS.matchPvf) ? 'pvf' : doc.querySelector(SELECTORS.matchMp) ? 'mp' : null;
    const now = env.now();
    if (!kind) { match = null; awaiting = null; modalOpen = false; return; }
    if (!match || match.kind !== kind) {
      const fresh = appearedMatch && appearedMatch.kind === kind && now - appearedMatch.at < 2_000 ? appearedMatch.at : now;
      match = { kind, t0: fresh, done: false };
      awaiting = null;
      modalOpen = false;
    }
    const playable = doc.querySelector(SELECTORS.playableTile) !== null;
    if (!match.done && playable) { match.done = true; record(`match.first_playable.${kind}`, now - match.t0); }
    const modal = doc.querySelector(SELECTORS.handOver) !== null;
    if (modal && !modalOpen) modalOpen = true;
    else if (!modal && modalOpen) { modalOpen = false; awaiting = { t0: now, kind: kind === 'mp' ? 'mp' : 'solo' }; }
    if (awaiting) {
      if (playable) { record(`hand.end_to_playable.${awaiting.kind}`, now - awaiting.t0); awaiting = null; }
      else if (now - awaiting.t0 > AWAIT_PLAYABLE_MAX_MS) awaiting = null;
    }
  };
  const poll = win.setInterval(tick, POLL_MS);

  // ── INP ──
  // reportAllChanges: the value is current when the tab is hidden, whichever of web-vitals' and our visibilitychange listeners runs first.
void env.loadVitals().then(({ onINP }) => onINP((metric) => { inp = Math.round(metric.value); }, { reportAllChanges: true })).catch(() => undefined);

  // ── the summary ──
  const flush = (): void => {
    if (sends >= MAX_SENDS) return;
    const now = env.now();
    if (now - lastSendAt < MIN_SEND_GAP_MS) return;
    const withInp = new Map(samples);
    if (inp !== null && inp !== inpReported) withInp.set('inp', [inp]);
    const beacon = buildBeacon(env.context(), withInp);
    if (!beacon) return;
    env.send(env.url, JSON.stringify(beacon));
    sends += 1;
    lastSendAt = now;
    inpReported = inp;
    samples.clear();
  };
  const onVisibility = (): void => { if (doc.visibilityState === 'hidden') flush(); };
  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', flush);

  return () => {
    stopNavWatch();
    win.clearInterval(poll);
    doc.removeEventListener('pointerdown', onPointerDown, { capture: true });
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', flush);
    setRumSink(null);
  };
}
