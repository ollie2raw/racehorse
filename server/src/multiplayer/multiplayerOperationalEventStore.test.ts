import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

import { supabaseFetch } from '../supabaseUtils';
import { recordMultiplayerOperationalEvent } from './multiplayerOperationalEventStore';

describe('multiplayer operational event store', () => {
  beforeEach(() => vi.mocked(supabaseFetch).mockReset());

  it('writes privacy-safe, idempotent fleet events with latency', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue(undefined);
    await recordMultiplayerOperationalEvent({
      eventType: 'action_accepted',
      roomCode: 'ROOM1',
      requestId: 'request-1',
      actionType: 'MOVE',
      durationMs: 12.4,
      idempotencyKey: 'action-1',
    });
    const body = JSON.parse(String(vi.mocked(supabaseFetch).mock.calls[0]?.[1]?.body))[0];
    expect(body).toMatchObject({
      event_type: 'action_accepted',
      request_id: 'request-1',
      duration_ms: 12,
      idempotency_key: 'action-1',
    });
    expect(body.room_code).toMatch(/^[a-f0-9]{16}$/);
    expect(body.room_code).not.toBe('ROOM1');
  });
});
