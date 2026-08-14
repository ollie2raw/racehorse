// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { reduceSession } from './sessionReducer';
import type { SessionSnapshot } from './sessionTypes';

describe('reduceSession', () => {
  it('clears room authority when the session is superseded by another tab', () => {
    const snapshot: SessionSnapshot = {
      phase: 'in_match',
      context: {
        roomCode: 'ROOM1',
        youId: 'seat-a',
        seated: true,
        playerReadyEmitted: true,
        intentionalDisconnect: false,
      },
    };

    const next = reduceSession(snapshot, { type: 'ROOM_SESSION_SUPERSEDED' });

    expect(next).toEqual({
      phase: 'connected',
      context: {
        roomCode: null,
        youId: '',
        seated: false,
        playerReadyEmitted: false,
        intentionalDisconnect: false,
      },
    });
  });
});
