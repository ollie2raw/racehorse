// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_RUM_SAMPLE_RATE, resolveRumSampleRate } from './rumConfig';
import { MIN_SEND_GAP_MS, startCollector, type CollectorEnv } from './rumCollector';
import { bandMemory, bandNet, bandScreen, buildBeacon, formOf, summarize } from './rumPayload';
import { rumRecord } from './rumSink';
import { startRumAfterFirstPaint } from './startRum';

describe('the sample rate', () => {
  it('defaults to 25% in a build, off in the dev server', () => {
    expect(DEFAULT_RUM_SAMPLE_RATE).toBe(0.25);
    expect(resolveRumSampleRate(undefined, false)).toBe(0.25);
    expect(resolveRumSampleRate('', false)).toBe(0.25);
    expect(resolveRumSampleRate(undefined, true)).toBe(0);
  });
  it('0, negative or unreadable means off; above 1 is 1', () => {
    expect(resolveRumSampleRate('0', false)).toBe(0);
    expect(resolveRumSampleRate('-1', false)).toBe(0);
    expect(resolveRumSampleRate('abc', false)).toBe(0);
    expect(resolveRumSampleRate('0.1', false)).toBe(0.1);
    expect(resolveRumSampleRate('5', false)).toBe(1);
  });
});

describe('startRumAfterFirstPaint', () => {
  it('rate 0: loads nothing, listens to nothing, returns before drawing a random number', () => {
    const load = vi.fn(); const random = vi.fn(() => 0); const whenIdle = vi.fn();
    const addListener = vi.spyOn(document, 'addEventListener');
    expect(startRumAfterFirstPaint({ rate: 0, random, load, whenIdle })).toBe(false);
    expect(load).not.toHaveBeenCalled(); expect(random).not.toHaveBeenCalled(); expect(whenIdle).not.toHaveBeenCalled();
    expect(addListener).not.toHaveBeenCalled();
    addListener.mockRestore();
  });
  it('a visit outside the sample loads nothing', () => {
    const load = vi.fn(); const whenIdle = vi.fn();
    expect(startRumAfterFirstPaint({ rate: 0.25, random: () => 0.9, load, whenIdle })).toBe(false);
    expect(load).not.toHaveBeenCalled(); expect(whenIdle).not.toHaveBeenCalled();
  });
  it('a sampled visit loads the collector only when the page is idle (after first paint)', async () => {
    const start = vi.fn(); const load = vi.fn(async () => ({ startCollector: start }));
    let idle: (() => void) | null = null;
    expect(startRumAfterFirstPaint({ rate: 0.25, random: () => 0.1, load, whenIdle: (run) => { idle = run; } })).toBe(true);
    expect(load).not.toHaveBeenCalled();
    idle!();
    await Promise.resolve(); await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1); expect(start).toHaveBeenCalledTimes(1);
  });
  it('a failed load never throws', async () => {
    let idle: (() => void) | null = null;
    startRumAfterFirstPaint({ rate: 1, random: () => 0, load: async () => { throw new Error('chunk'); }, whenIdle: (run) => { idle = run; } });
    expect(() => idle!()).not.toThrow();
    await Promise.resolve();
  });
});

describe('the bands and the summary', () => {
  it('bands are coarse', () => {
    expect([300, 400, 599, 600, 1023, 1024].map(bandScreen)).toEqual(['xs', 's', 's', 'm', 'm', 'l']);
    expect([undefined, 0, 0.5, 2, 4, 8, 16].map(bandMemory)).toEqual(['na', 'na', 'le2', 'le2', '4', '8p', '8p']);
    expect(['slow-2g', '2g', '3g', '4g', '5g', undefined].map(bandNet)).toEqual(['slow', 'slow', '3g', '4g', 'na', 'na']);
    expect([formOf(false, 400), formOf(true, 390), formOf(true, 800)]).toEqual(['desktop', 'phone', 'tablet']);
  });
  it('summarize gives [count, median, max] in whole milliseconds, and nothing for no samples', () => {
    expect(summarize([300, 100, 200, 400])).toEqual([4, 200, 400]);
    expect(summarize([100.6])).toEqual([1, 101, 101]);
    expect(summarize([])).toBeNull();
    expect(summarize([-5, Number.NaN])).toBeNull();
  });
  it('a beacon carries exactly the documented fields and nothing identifying', () => {
    const beacon = buildBeacon({ app: 'abc1234', plat: 'web', form: 'phone', scr: 's', mem: '4', net: '4g' }, new Map([['inp', [90]]]))!;
    expect(Object.keys(beacon).sort()).toEqual(['app', 'form', 'm', 'mem', 'net', 'plat', 'scr', 'v']);
    expect(buildBeacon({ app: 'x', plat: 'web', form: 'phone', scr: 's', mem: '4', net: '4g' }, new Map())).toBeNull();
  });
});

describe('the collector', () => {
  let sent: Array<{ url: string; body: string }>;
  let env: CollectorEnv;
  let stop: () => void;
  let visibility: 'visible' | 'hidden';

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    sent = [];
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    env = {
      doc: document, win: window,
      now: () => performance.now(),
      raf: (cb) => { setTimeout(cb, 16); },
      context: () => ({ app: 'abc1234', plat: 'web', form: 'phone', scr: 's', mem: '4', net: '4g' }),
      send: (url, body) => { sent.push({ url, body }); },
      loadVitals: async () => ({ onINP: (cb) => cb({ value: 88.4 }) }),
      url: 'https://server.invalid/api/rum',
    };
  });
  afterEach(() => { stop?.(); vi.useRealTimers(); });

  const addScreen = (cls: string) => { const el = document.createElement('div'); el.className = cls; document.body.appendChild(el); return el; };
  const tap = (ms = 0) => { const e = new Event('pointerdown', { bubbles: true }); Object.defineProperty(e, 'timeStamp', { value: performance.now() - ms }); document.body.dispatchEvent(e); };
  const flushBeacons = async () => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); return sent.map((s) => JSON.parse(s.body)); };

  it('times a tap to the next screen, from the tap to the frame after it appears', async () => {
    stop = startCollector(env);
    tap(0);
    await vi.advanceTimersByTimeAsync(120);
    addScreen('sp-solo-main');
    await vi.advanceTimersByTimeAsync(0); // the observer's microtask
    await vi.advanceTimersByTimeAsync(30);
    const [beacon] = await flushBeacons();
    const [n, median] = beacon.m['nav.home_to_hub'];
    expect(n).toBe(1);
    expect(median).toBeGreaterThanOrEqual(120); expect(median).toBeLessThan(200);
  });

  it('does not time a screen that was already showing, and does not watch the board during play', async () => {
    addScreen('sp-solo-main');
    stop = startCollector(env);
    tap(); await vi.advanceTimersByTimeAsync(50);
    document.body.innerHTML = ''; addScreen('bot-match-screen bot-match-mode-pvf');
    await vi.advanceTimersByTimeAsync(300);
    tap(); addScreen('pvf-root--setup'); await vi.advanceTimersByTimeAsync(100); // a tap during a match: not a navigation
    const beacons = await flushBeacons();
    for (const b of beacons) expect(Object.keys(b.m)).not.toContain('nav.home_to_hub');
    for (const b of beacons) expect(Object.keys(b.m)).not.toContain('nav.hub_to_setup');
  });

  it('times a match appearing to its first playable tile, per mode', async () => {
    stop = startCollector(env);
    const screen = addScreen('bot-match-screen bot-match-mode-daily-fritz');
    await vi.advanceTimersByTimeAsync(1500);
    const hand = document.createElement('div'); hand.className = 'hand-area';
    const tile = document.createElement('div'); tile.className = 'domino-tile highlight'; hand.appendChild(tile); screen.appendChild(hand);
    await vi.advanceTimersByTimeAsync(300);
    const [beacon] = await flushBeacons();
    const [, median] = beacon.m['match.first_playable.daily'];
    expect(median).toBeGreaterThanOrEqual(1500); expect(median).toBeLessThan(2000);
    expect(Object.keys(beacon.m)).not.toContain('match.first_playable.pvf');
  });

  it('a highlighted tile in the pre-game draw dock does not count as playable', async () => {
    stop = startCollector(env);
    const screen = addScreen('bot-match-screen bot-match-mode-pvf');
    const dock = document.createElement('div'); dock.className = 'hand-area pre-game-draw-hand-dock';
    const tile = document.createElement('div'); tile.className = 'domino-tile highlight'; dock.appendChild(tile); screen.appendChild(dock);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await flushBeacons()).toEqual([expect.objectContaining({ m: { inp: [1, 88, 88] } })]);
  });

  it('times the hand-result dialog closing to the next playable tile, solo and multiplayer', async () => {
    stop = startCollector(env);
    const screen = addScreen('bot-match-screen'); // multiplayer match: no bot-match-mode-* class
    const modal = document.createElement('div'); modal.setAttribute('data-testid', 'hand-over-modal'); screen.appendChild(modal);
    await vi.advanceTimersByTimeAsync(500);
    modal.remove();
    await vi.advanceTimersByTimeAsync(700);
    const hand = document.createElement('div'); hand.className = 'hand-area'; const tile = document.createElement('div'); tile.className = 'domino-tile highlight'; hand.appendChild(tile); screen.appendChild(hand);
    await vi.advanceTimersByTimeAsync(300);
    const [beacon] = await flushBeacons();
    const [, median] = beacon.m['hand.end_to_playable.mp'];
    expect(median).toBeGreaterThanOrEqual(700); expect(median).toBeLessThan(1100);
  });

  it('collects acknowledgements from rumRecord, and INP', async () => {
    stop = startCollector(env);
    rumRecord('mp.hand_ready_ack', 301.4); rumRecord('mp.hand_ready_ack', 295);
    await Promise.resolve();
    const [beacon] = await flushBeacons();
    expect(beacon.m['mp.hand_ready_ack']).toEqual([2, 295, 301]);
    expect(beacon.m.inp).toEqual([1, 88, 88]);
  });

  it('sends one text/plain summary when hidden, at most every 20 minutes and three times, then nothing', async () => {
    let clock = 0;
    env.now = () => clock;
    stop = startCollector(env);
    rumRecord('mp.room_join_ack', 100);
    await flushBeacons();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('https://server.invalid/api/rum');
    rumRecord('mp.room_join_ack', 100);
    await flushBeacons();
    expect(sent).toHaveLength(1); // under 20 minutes
    for (let i = 0; i < 4; i += 1) { clock += MIN_SEND_GAP_MS + 1000; rumRecord('mp.room_join_ack', 100); await flushBeacons(); }
    expect(sent).toHaveLength(3);
  });

  it('sends nothing when there is nothing to report, and the body has no identifier', async () => {
    env.loadVitals = async () => ({ onINP: () => undefined });
    stop = startCollector(env);
    expect(await flushBeacons()).toEqual([]);
    rumRecord('mp.hand_ready_ack', 250);
    await flushBeacons();
    expect(Object.keys(JSON.parse(sent[0]!.body)).sort()).toEqual(['app', 'form', 'm', 'mem', 'net', 'plat', 'scr', 'v']);
  });

  it('stopping removes the sink: rumRecord does nothing afterwards', async () => {
    stop = startCollector(env);
    stop();
    rumRecord('mp.hand_ready_ack', 1);
    expect(await flushBeacons()).toEqual([]);
  });
});

