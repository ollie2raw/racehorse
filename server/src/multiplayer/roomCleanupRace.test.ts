import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, getRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import { initRoomSession, resetRoomSessionStoresForTests, scheduleRoomCleanup, setRoomRoster, ROOM_CLEANUP_GRACE_MS } from './roomSession';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn(async () => undefined) }));

const io = { sockets: { sockets: new Map(), adapter: { rooms: new Map() } }, to: () => ({ emit: vi.fn() }) };
const archive = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  resetRoomRuntimeForTests();
  resetRoomSessionStoresForTests();
  io.sockets.sockets.clear();
  archive.mockReset().mockResolvedValue(undefined);
  initRoomSession(io as any, {
    resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
    normalizeUsername: () => 'Guest', normalizeUserId: () => null,
    tryHydrateMatchmakingRoomShell: async () => 'skipped',
    waitUntilMatchmakingRoomSocketsReady: async () => undefined,
    onAfterMatchStarted: async () => undefined, notifyRoomPlayersInGame: () => undefined,
    persistRoomMatchLog: archive, onGameOver: () => null,
  });
});
afterEach(() => { resetRoomSessionStoresForTests(); resetRoomRuntimeForTests(); vi.useRealTimers(); });

function reserve() {
  const room = createReservedRoom('RACE1', {});
  joinRoom('RACE1', 'seat-a');
  setRoomRoster('RACE1', [{ id: 'seat-a', socketId: '', username: 'A', userId: null }]);
  return room;
}

describe('room cleanup archive race', () => {
  it('preserves a room rejoined while its archive request is in flight', async () => {
    const room = reserve();
    let release!: () => void;
    archive.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    scheduleRoomCleanup('RACE1');
    await vi.advanceTimersByTimeAsync(ROOM_CLEANUP_GRACE_MS);
    expect(archive).toHaveBeenCalledTimes(1);
    io.sockets.sockets.set('connection', { connected: true });
    setRoomRoster('RACE1', [{ id: 'seat-a', socketId: 'connection', username: 'A', userId: null }]);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(getRoom('RACE1')).toBe(room);
  });

  it('cleans an empty room, including after an archive failure, without repeated timers', async () => {
    reserve();
    archive.mockRejectedValueOnce(new Error('archive unavailable'));
    scheduleRoomCleanup('RACE1');
    scheduleRoomCleanup('RACE1');
    await vi.advanceTimersByTimeAsync(ROOM_CLEANUP_GRACE_MS);
    expect(archive).toHaveBeenCalledTimes(1);
    expect(() => getRoom('RACE1')).toThrow();
  });
});
