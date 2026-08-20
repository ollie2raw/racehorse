import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../supabaseUtils', () => ({ supabaseFetch: vi.fn() }));

import { supabaseFetch } from '../supabaseUtils';
import {
  MP_AUTHORITY_EVENT_WRITE_TIMEOUT_MS,
  flushMpAuthorityEventPersistForTests,
  groupMpAuthorityFunnelMetrics,
  pacificEventDate,
  queryMpAuthorityFunnelMetrics,
  recordMpAuthorityEvent,
  recordMpAuthorityEventBestEffort,
} from './mpAuthorityEventStore';
import { emitMpAuthorityFunnel } from './mpAuthorityTelemetry';

describe('mp.authority event store', () => {
  beforeEach(() => {
    vi.mocked(supabaseFetch).mockReset();
  });

  afterEach(async () => {
    await flushMpAuthorityEventPersistForTests();
  });

  it('writes a funnel row to PostgREST', async () => {
    vi.mocked(supabaseFetch).mockResolvedValue(undefined);

    await recordMpAuthorityEvent({
      event: 'private_lobby_created',
      ts: '2026-08-20T07:30:00.000Z',
      roomCode: 'ROOM1',
      seatId: 'seat-a',
      requestId: 'req-1',
      failureCode: null,
      sourceType: 'private',
      payload: { host: true },
    });

    expect(supabaseFetch).toHaveBeenCalledWith(
      '/rest/v1/mp_authority_events',
      expect.objectContaining({
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        timeoutMs: MP_AUTHORITY_EVENT_WRITE_TIMEOUT_MS,
      }),
    );
    const body = JSON.parse(String(vi.mocked(supabaseFetch).mock.calls[0]?.[1]?.body))[0];
    expect(body).toEqual({
      event: 'private_lobby_created',
      ts: '2026-08-20T07:30:00.000Z',
      room_code: 'ROOM1',
      seat_id: 'seat-a',
      request_id: 'req-1',
      failure_code: null,
      source_type: 'private',
      payload: { host: true },
    });
  });

  it('best-effort insert failure does not throw', async () => {
    vi.mocked(supabaseFetch).mockRejectedValue(new Error('db_down'));
    await expect(recordMpAuthorityEventBestEffort({
      event: 'private_action_committed',
      ts: new Date().toISOString(),
      roomCode: 'ROOM1',
      seatId: null,
      requestId: 'req-1',
      failureCode: null,
      sourceType: 'private',
      payload: {},
    })).resolves.toBeUndefined();
  });

  it('emitMpAuthorityFunnel keeps the console line and does not throw when persist fails', async () => {
    vi.mocked(supabaseFetch).mockRejectedValue(new Error('db_down'));
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    expect(() => emitMpAuthorityFunnel('private_action_uncertain', {
      roomCode: 'ROOM1',
      requestId: 'req-1',
      failureCode: 'missing_request_id',
    })).not.toThrow();

    expect(info).toHaveBeenCalledWith(
      '[mp.authority]',
      expect.stringContaining('"event":"private_action_uncertain"'),
    );

    await flushMpAuthorityEventPersistForTests();
    expect(supabaseFetch).toHaveBeenCalled();
    info.mockRestore();
  });

  it('round-trips inserts through the funnel view grouping (Pacific date + event)', async () => {
    const inserted: Array<{ event: string; ts: string }> = [];
    vi.mocked(supabaseFetch).mockImplementation(async (path: string, init?: RequestInit) => {
      if (String(path).includes('/mp_authority_events') && init?.method === 'POST') {
        const rows = JSON.parse(String(init.body)) as Array<{ event: string; ts: string }>;
        inserted.push(...rows);
        return undefined;
      }
      if (String(path).includes('/mp_authority_funnel_metrics')) {
        return groupMpAuthorityFunnelMetrics(inserted).map((row) => ({
          event_date: row.eventDate,
          event: row.event,
          total: row.total,
        }));
      }
      throw new Error(`unexpected ${init?.method} ${path}`);
    });

    // 2026-08-20T06:30Z is still 2026-08-19 in America/Los_Angeles (PDT, UTC-7).
    await recordMpAuthorityEvent({
      event: 'private_lobby_created',
      ts: '2026-08-20T06:30:00.000Z',
      roomCode: 'A',
      seatId: null,
      requestId: null,
      failureCode: null,
      sourceType: 'private',
      payload: {},
    });
    await recordMpAuthorityEvent({
      event: 'private_lobby_created',
      ts: '2026-08-20T07:30:00.000Z',
      roomCode: 'B',
      seatId: null,
      requestId: null,
      failureCode: null,
      sourceType: 'private',
      payload: {},
    });
    await recordMpAuthorityEvent({
      event: 'private_match_started',
      ts: '2026-08-20T07:45:00.000Z',
      roomCode: 'B',
      seatId: null,
      requestId: null,
      failureCode: null,
      sourceType: 'private',
      payload: {},
    });

    expect(pacificEventDate('2026-08-20T06:30:00.000Z')).toBe('2026-08-19');
    expect(pacificEventDate('2026-08-20T07:30:00.000Z')).toBe('2026-08-20');

    await expect(queryMpAuthorityFunnelMetrics()).resolves.toEqual([
      { eventDate: '2026-08-19', event: 'private_lobby_created', total: 1 },
      { eventDate: '2026-08-20', event: 'private_lobby_created', total: 1 },
      { eventDate: '2026-08-20', event: 'private_match_started', total: 1 },
    ]);
  });
});
