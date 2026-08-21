import { beforeEach, describe, expect, it } from 'vitest';
import {
  addSocket,
  getPresence,
  getPresenceBatch,
  isOnline,
  onlineUserCount,
  removeSocket,
  resetPresenceRegistry,
  setActivity,
} from './presenceRegistry';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

beforeEach(() => { resetPresenceRegistry(); });

describe('presenceRegistry', () => {
  it('treats a user with any connected socket as online', () => {
    expect(isOnline(USER_A)).toBe(false);
    addSocket(USER_A, 'sock-1');
    expect(isOnline(USER_A)).toBe(true);
    expect(onlineUserCount()).toBe(1);
  });

  it('reports offline only when the last socket is removed', () => {
    addSocket(USER_A, 'sock-1');
    addSocket(USER_A, 'sock-2');

    expect(removeSocket(USER_A, 'sock-1')).toBe(false);
    expect(isOnline(USER_A)).toBe(true);

    expect(removeSocket(USER_A, 'sock-2')).toBe(true);
    expect(isOnline(USER_A)).toBe(false);
    expect(onlineUserCount()).toBe(0);
  });

  it('is idempotent for a socket it never held', () => {
    expect(removeSocket(USER_A, 'ghost')).toBe(false);
    addSocket(USER_A, 'sock-1');
    expect(removeSocket(USER_A, 'ghost')).toBe(false);
    expect(isOnline(USER_A)).toBe(true);
  });

  it('reports activity for online users and clears it when they go offline', () => {
    addSocket(USER_A, 'sock-1');
    setActivity(USER_A, 'in_game', 'ROOM42');
    expect(getPresence(USER_A)).toEqual({ status: 'in_game', current_mode: 'ROOM42' });

    removeSocket(USER_A, 'sock-1');
    expect(getPresence(USER_A)).toEqual({ status: 'offline', current_mode: null });

    // Stale activity must not resurrect on reconnect.
    addSocket(USER_A, 'sock-2');
    expect(getPresence(USER_A)).toEqual({ status: 'online', current_mode: null });
  });

  it('ignores activity for a user with no socket', () => {
    setActivity(USER_A, 'in_game', 'ROOM42');
    expect(getPresence(USER_A)).toEqual({ status: 'offline', current_mode: null });
  });

  it('returns an entry for every requested id in a batch', () => {
    addSocket(USER_A, 'sock-1');
    const batch = getPresenceBatch([USER_A, USER_B]);
    expect(batch.get(USER_A)).toEqual({ status: 'online', current_mode: null });
    expect(batch.get(USER_B)).toEqual({ status: 'offline', current_mode: null });
    expect(batch.size).toBe(2);
  });
});
