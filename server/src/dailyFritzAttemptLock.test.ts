import { describe, expect, it } from 'vitest';
import {
  getDailyFritzAttemptLockCountForTests,
  withDailyFritzAttemptLock,
} from './dailyFritzAttemptLock';

describe('Daily Fritz attempt operation lock', () => {
  it('serializes operations for one attempt', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withDailyFritzAttemptLock('attempt-1', async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = withDailyFritzAttemptLock('attempt-1', async () => {
      order.push('second:start');
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    expect(getDailyFritzAttemptLockCountForTests()).toBe(0);
  });

  it('does not block another attempt and releases after failure', async () => {
    let otherRan = false;
    const failing = withDailyFritzAttemptLock('attempt-a', async () => {
      await withDailyFritzAttemptLock('attempt-b', async () => {
        otherRan = true;
      });
      throw new Error('verification failed');
    });

    await expect(failing).rejects.toThrow('verification failed');
    expect(otherRan).toBe(true);
    expect(getDailyFritzAttemptLockCountForTests()).toBe(0);
  });

  it('serializes duplicate submissions and releases the lock after a failed request', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const first = withDailyFritzAttemptLock('attempt-duplicate', async () => {
      order.push('first-start');
      await firstGate;
      order.push('first-finish');
      throw new Error('simulated lost response after write');
    }).catch(() => undefined);

    const second = withDailyFritzAttemptLock('attempt-duplicate', async () => {
      order.push('second-start');
      return 'replayed';
    });

    await Promise.resolve();
    expect(order).toEqual(['first-start']);
    releaseFirst();
    await first;
    await expect(second).resolves.toBe('replayed');
    expect(order).toEqual(['first-start', 'first-finish', 'second-start']);
    expect(getDailyFritzAttemptLockCountForTests()).toBe(0);
  });
});
