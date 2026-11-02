import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({
  closing: false,
  timeouts: [] as Array<{ name: string; ms: number; task: () => unknown }>,
  intervals: [] as Array<{ name: string; ms: number; task: () => unknown }>,
}));
vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));
vi.mock('../logger', () => ({ childLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock('../platform/processLifecycle', () => ({
  isProcessClosing: () => lifecycle.closing,
  processTimeout: (name: string, task: () => unknown, ms: number) => {
    lifecycle.timeouts.push({ name, ms, task });
    return { unref: () => undefined };
  },
  processInterval: (name: string, task: () => unknown, ms: number) => {
    lifecycle.intervals.push({ name, ms, task });
    return { unref: () => undefined };
  },
}));

import {
  GUEST_CLEANUP_BOOT_DELAY_MS,
  GUEST_CLEANUP_INTERVAL_MS,
  guestCleanupMode,
  resetGuestCleanupForTests,
  runGuestCleanup,
  scheduleGuestCleanup,
} from './guestCleanup';

beforeEach(() => {
  lifecycle.closing = false;
  lifecycle.timeouts.length = 0;
  lifecycle.intervals.length = 0;
  resetGuestCleanupForTests();
  delete process.env.GUEST_CLEANUP_MODE;
});

describe('guestCleanupMode', () => {
  it('deletes by default, and for the word delete in any case', () => {
    expect(guestCleanupMode(undefined)).toBe('delete');
    expect(guestCleanupMode('')).toBe('delete');
    expect(guestCleanupMode(' DELETE ')).toBe('delete');
  });

  it('can be switched to report or off', () => {
    expect(guestCleanupMode('report')).toBe('report');
    expect(guestCleanupMode('off')).toBe('off');
  });

  it('treats anything unrecognised as report, so a typo can never delete', () => {
    expect(guestCleanupMode('dlete')).toBe('report');
    expect(guestCleanupMode('true')).toBe('report');
  });
});

describe('runGuestCleanup', () => {
  const body = (call: ReturnType<typeof vi.fn>) => JSON.parse(call.mock.calls[0][1].body);

  it('delete mode asks for a real run of 30 days and up to 500', async () => {
    const call = vi.fn().mockResolvedValue(3);
    expect(await runGuestCleanup('delete', call)).toEqual({ mode: 'delete', count: 3 });
    expect(call.mock.calls[0][0]).toBe('/rest/v1/rpc/delete_inactive_guests');
    expect(body(call)).toEqual({ p_inactive_days: 30, p_limit: 500, p_dry_run: false });
  });

  it('report mode is always a dry run', async () => {
    const call = vi.fn().mockResolvedValue(7);
    expect(await runGuestCleanup('report', call)).toEqual({ mode: 'report', count: 7 });
    expect(body(call).p_dry_run).toBe(true);
  });

  it('off mode does not call the database at all', async () => {
    const call = vi.fn();
    expect(await runGuestCleanup('off', call)).toEqual({ mode: 'off', count: null });
    expect(call).not.toHaveBeenCalled();
  });

  it('never throws: a failing call (migration not applied, network) is a null count', async () => {
    const call = vi.fn().mockRejectedValue(new Error('Supabase request failed: 404 PGRST202'));
    await expect(runGuestCleanup('delete', call)).resolves.toEqual({ mode: 'delete', count: null });
  });

  it('does not trust a result that is not a count', async () => {
    expect((await runGuestCleanup('delete', vi.fn().mockResolvedValue({ weird: true }))).count).toBeNull();
    expect((await runGuestCleanup('delete', vi.fn().mockResolvedValue(null))).count).toBeNull();
  });

  it('accepts a count that arrives as text', async () => {
    expect((await runGuestCleanup('delete', vi.fn().mockResolvedValue('4'))).count).toBe(4);
  });
});

describe('scheduleGuestCleanup', () => {
  it('runs once after boot and then daily, once however many times it is called', () => {
    scheduleGuestCleanup();
    scheduleGuestCleanup();
    expect(lifecycle.timeouts).toHaveLength(1);
    expect(lifecycle.timeouts[0]).toMatchObject({ name: 'guest-cleanup', ms: GUEST_CLEANUP_BOOT_DELAY_MS });
    expect(lifecycle.intervals).toHaveLength(1);
    expect(lifecycle.intervals[0]).toMatchObject({ name: 'guest-cleanup', ms: GUEST_CLEANUP_INTERVAL_MS });
    expect(GUEST_CLEANUP_INTERVAL_MS).toBe(24 * 60 * 60_000);
  });

  it('schedules nothing when switched off', () => {
    process.env.GUEST_CLEANUP_MODE = 'off';
    scheduleGuestCleanup();
    expect(lifecycle.timeouts).toHaveLength(0);
    expect(lifecycle.intervals).toHaveLength(0);
  });

  it('does not start a run once the process is shutting down', () => {
    scheduleGuestCleanup();
    lifecycle.closing = true;
    expect(lifecycle.intervals[0].task()).toBeUndefined();
  });
});
