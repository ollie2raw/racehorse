import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReservedRoom, joinRoom, resetRoomRuntimeForTests } from '../rooms';
import * as rooms from '../rooms';
import { markMatchStartReady, tryStartMatchIfReady } from './matchStartReady';
import * as telemetry from './mpAuthorityTelemetry';

describe('tryStartMatchIfReady authority funnel', () => {
  beforeEach(() => {
    resetRoomRuntimeForTests();
  });

  it('emits private_match_started only when the match actually starts', async () => {
    const emit = vi.spyOn(telemetry, 'emitMpAuthorityFunnel');
    vi.spyOn(rooms, 'initiatePregameDrawOrStartUnlocked').mockImplementation(async (code) => rooms.getRoom(code));

    createReservedRoom('STRT0');
    joinRoom('STRT0', 'seat-a');
    joinRoom('STRT0', 'seat-b');
    markMatchStartReady('STRT0', 'seat-a');

    await expect(tryStartMatchIfReady('STRT0', {} as never, {
      broadcastStateUpdate: vi.fn(),
    })).resolves.toEqual({ started: false, waitingFor: ['seat-b'] });
    expect(emit).not.toHaveBeenCalledWith('private_match_started', expect.anything());

    markMatchStartReady('STRT0', 'seat-b');
    await expect(tryStartMatchIfReady('STRT0', {} as never, {
      broadcastStateUpdate: vi.fn(),
    })).resolves.toEqual({ started: true });
    expect(emit).toHaveBeenCalledWith('private_match_started', expect.objectContaining({
      roomCode: 'STRT0',
    }));
  });
});
