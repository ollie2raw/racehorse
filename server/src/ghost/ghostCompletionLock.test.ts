import { describe, expect, it } from 'vitest';
import {
  getGhostCompletionLockCountForTests,
  withGhostCompletionLock,
} from './ghostCompletionLock';

// SA-4 (HARDENING_PLAN.md §11.3): the primitive itself, mirroring
// dailyFritzAttemptLock.test.ts's coverage shape for the pattern this ports.

describe('ghost completion lock', () => {
  it('serializes operations for one matchId', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = withGhostCompletionLock('match-1', async () => {
      order.push('first:start');
      await firstGate;
      order.push('first:end');
    });
    const second = withGhostCompletionLock('match-1', async () => {
      order.push('second:start');
    });

    await Promise.resolve();
    expect(order).toEqual(['first:start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    expect(getGhostCompletionLockCountForTests()).toBe(0);
  });

  it('does not block a different matchId and releases after failure', async () => {
    let otherRan = false;
    const failing = withGhostCompletionLock('match-a', async () => {
      await withGhostCompletionLock('match-b', async () => {
        otherRan = true;
      });
      throw new Error('completion failed');
    });

    await expect(failing).rejects.toThrow('completion failed');
    expect(otherRan).toBe(true);
    expect(getGhostCompletionLockCountForTests()).toBe(0);
  });
});
