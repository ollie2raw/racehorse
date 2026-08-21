import { describe, expect, it, vi } from 'vitest';
import { createRoomCommandRequestId, emitGameStart, emitHandReady } from './roomTransport';

describe('roomTransport requestId for hand lifecycle emits (A1 client follow-up)', () => {
  it('createRoomCommandRequestId returns kind-prefixed ids', () => {
    expect(createRoomCommandRequestId('game-start')).toMatch(/^game-start-/);
    expect(createRoomCommandRequestId('hand-ready')).toMatch(/^hand-ready-/);
  });

  it('emitGameStart includes a requestId payload', async () => {
    const emit = vi.fn((_event: string, _code: string, _payload: unknown, cb: (r: unknown) => void) => {
      cb({ ok: true });
    });
    const socket = { emit };
    await emitGameStart(socket, 'ABCD');
    expect(emit).toHaveBeenCalledWith(
      'game:start',
      'ABCD',
      expect.objectContaining({ requestId: expect.stringMatching(/^game-start-/) }),
      expect.any(Function),
    );
  });

  it('emitHandReady includes handNumber + requestId payload', async () => {
    const emit = vi.fn(
      (_event: string, _code: string, _payload: unknown, cb: (r: unknown) => void) => {
        cb({ ok: true });
      },
    );
    const socket = { emit };
    await emitHandReady(socket, 'ABCD', 3);
    expect(emit).toHaveBeenCalledWith(
      'hand:ready',
      'ABCD',
      expect.objectContaining({
        handNumber: 3,
        requestId: expect.stringMatching(/^hand-ready-/),
      }),
      expect.any(Function),
    );
  });
});
