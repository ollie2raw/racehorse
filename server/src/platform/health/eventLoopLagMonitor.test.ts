import { afterEach, describe, expect, it } from 'vitest';
import { startEventLoopLagMonitor, type EventLoopLagWindow } from './eventLoopLagMonitor';

function blockMainThread(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* the outage, in miniature */ }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('event loop lag monitor', () => {
  const stops: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(stops.splice(0).map((stop) => stop()));
  });

  it('alerts once (rate limited) when the loop is blocked past the alert threshold', async () => {
    const alerts: EventLoopLagWindow[] = [];
    const monitor = startEventLoopLagMonitor({
      windowMs: 300, warnMs: 100, alertMs: 400, stallMs: 60_000,
      report: (window) => alerts.push(window),
    });
    stops.push(monitor.stop);
    await wait(50);
    blockMainThread(600);
    await wait(400);
    blockMainThread(600);
    await wait(400);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.maxMs).toBeGreaterThanOrEqual(400);
  });

  it('does not alert on a healthy loop', async () => {
    const alerts: EventLoopLagWindow[] = [];
    const monitor = startEventLoopLagMonitor({
      windowMs: 200, warnMs: 100, alertMs: 400, stallMs: 60_000,
      report: (window) => alerts.push(window),
    });
    stops.push(monitor.stop);
    await wait(700);
    expect(alerts).toHaveLength(0);
  });

  it('the watchdog thread detects a stall while the main thread is still blocked', async () => {
    const events: Array<{ event: string } & Record<string, unknown>> = [];
    const monitor = startEventLoopLagMonitor({
      windowMs: 60_000, alertMs: 60_000, stallMs: 1_000,
      report: () => undefined,
      onWatchdogEvent: (event) => events.push(event),
    });
    stops.push(monitor.stop);
    await wait(1_200); // heartbeat running, watchdog started
    const blockedFrom = Date.now();
    blockMainThread(2_500);
    const blockedUntil = Date.now();
    await wait(1_500);
    const stall = events.find((e) => e.event === 'stall');
    expect(stall).toBeDefined();
    // Detected during the block, not after it.
    expect(stall!.detectedAt as number).toBeGreaterThan(blockedFrom);
    expect(stall!.detectedAt as number).toBeLessThan(blockedUntil);
    expect(events.some((e) => e.event === 'recovered')).toBe(true);
  }, 20_000);
});
