import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetRoomGameplayLocksForTests, withRoomGameplayLock } from './roomGameplayLock';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('withRoomGameplayLock', () => {
  afterEach(() => {
    resetRoomGameplayLocksForTests();
  });

  it('serializes concurrent work for the same room', async () => {
    const order: number[] = [];

    await Promise.all([
      withRoomGameplayLock('ROOM1', async () => {
        order.push(1);
        await delay(30);
        order.push(2);
        return 'a';
      }),
      withRoomGameplayLock('ROOM1', async () => {
        order.push(3);
        return 'b';
      }),
    ]);

    expect(order).toEqual([1, 2, 3]);
  });

  it('allows parallel work for different rooms', async () => {
    const order: string[] = [];

    await Promise.all([
      withRoomGameplayLock('ROOM-A', async () => {
        order.push('a-start');
        await delay(20);
        order.push('a-end');
      }),
      withRoomGameplayLock('ROOM-B', async () => {
        order.push('b-start');
        await delay(5);
        order.push('b-end');
      }),
    ]);

    expect(order.indexOf('b-start')).toBeLessThan(order.indexOf('a-end'));
    expect(order).toContain('a-start');
    expect(order).toContain('b-end');
  });

  it('releases the lock when work throws', async () => {
    await expect(
      withRoomGameplayLock('ROOM1', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    let ran = false;
    await withRoomGameplayLock('ROOM1', async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
