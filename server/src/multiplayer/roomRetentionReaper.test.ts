import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseFetch = vi.fn();
const listRoomCodes = vi.fn<() => string[]>(() => []);

vi.mock('../supabaseUtils', () => ({ supabaseFetch: (...args: unknown[]) => supabaseFetch(...args) }));
vi.mock('../rooms', () => ({ listRoomCodes: () => listRoomCodes() }));

import {
  GUEST_ABANDONED_MATCH_LOG_RETENTION_MS,
  ROOM_LIVE_SESSION_RETENTION_MS,
  ROOM_RETENTION_BOOT_DELAY_MS,
  ROOM_RETENTION_INTERVAL_MS,
  ROOM_RETENTION_MAX_EXCLUDED_ROOMS,
  resetRoomRetentionForTests,
  runRoomRetention,
  scheduleRoomRetention,
} from './roomRetentionReaper';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');

function params(call: unknown[]): URLSearchParams {
  const path = String(call[0]);
  return new URLSearchParams(path.slice(path.indexOf('?') + 1));
}

function tableOf(call: unknown[]): string {
  return String(call[0]).split('?')[0];
}

beforeEach(() => {
  supabaseFetch.mockReset();
  supabaseFetch.mockResolvedValue([]);
  listRoomCodes.mockReset();
  listRoomCodes.mockReturnValue([]);
  delete process.env.ROOM_RETENTION_REAPER_ENABLED;
});

afterEach(() => {
  resetRoomRetentionForTests();
  vi.useRealTimers();
});

describe('runRoomRetention', () => {
  it('deletes live sessions idle 7 days and guest-only abandoned logs older than 30 days', async () => {
    supabaseFetch
      .mockResolvedValueOnce([{ room_code: 'A1' }, { room_code: 'B2' }])
      .mockResolvedValueOnce([{ room_code: 'C3' }]);

    const result = await runRoomRetention(NOW);

    expect(result).toEqual({ liveSessionsDeleted: 2, guestMatchLogsDeleted: 1 });
    expect(supabaseFetch).toHaveBeenCalledTimes(2);

    const [live, logs] = supabaseFetch.mock.calls;
    expect(tableOf(live)).toBe('/rest/v1/room_live_sessions');
    expect(live[1]).toEqual({ method: 'DELETE' });
    expect(params(live).get('updated_at')).toBe(`lt.${new Date(NOW - ROOM_LIVE_SESSION_RETENTION_MS).toISOString()}`);
    expect(params(live).has('room_code')).toBe(false);

    expect(tableOf(logs)).toBe('/rest/v1/room_match_logs');
    expect(logs[1]).toEqual({ method: 'DELETE' });
    expect(params(logs).get('status')).toBe('eq.abandoned');
    expect(params(logs).get('participant_user_ids')).toBe('eq.{}');
    expect(params(logs).get('archived_at')).toBe(`lt.${new Date(NOW - GUEST_ABANDONED_MATCH_LOG_RETENTION_MS).toISOString()}`);
  });

  it('never deletes the row of a room this process still holds in memory', async () => {
    listRoomCodes.mockReturnValue(['ABCD1', 'T1A2B3R1M1']);

    await runRoomRetention(NOW);

    expect(params(supabaseFetch.mock.calls[0]).get('room_code')).toBe('not.in.("ABCD1","T1A2B3R1M1")');
  });

  it('skips live sessions (keeping the guard) when too many rooms are in memory to exclude', async () => {
    listRoomCodes.mockReturnValue(Array.from({ length: ROOM_RETENTION_MAX_EXCLUDED_ROOMS + 1 }, (_, i) => `R${i}`));

    const result = await runRoomRetention(NOW);

    expect(result.liveSessionsDeleted).toBeNull();
    expect(supabaseFetch).toHaveBeenCalledTimes(1);
    expect(tableOf(supabaseFetch.mock.calls[0])).toBe('/rest/v1/room_match_logs');
  });

  it('one failing table does not stop the other, and nothing throws', async () => {
    supabaseFetch.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce([{ room_code: 'X' }]);

    await expect(runRoomRetention(NOW)).resolves.toEqual({ liveSessionsDeleted: null, guestMatchLogsDeleted: 1 });
  });

  it('treats an empty response body as zero deleted', async () => {
    supabaseFetch.mockResolvedValue(null);
    await expect(runRoomRetention(NOW)).resolves.toEqual({ liveSessionsDeleted: 0, guestMatchLogsDeleted: 0 });
  });
});

describe('scheduleRoomRetention', () => {
  it('runs once after the boot delay, then once a day, and nothing before', async () => {
    vi.useFakeTimers();
    scheduleRoomRetention();

    await vi.advanceTimersByTimeAsync(ROOM_RETENTION_BOOT_DELAY_MS - 1);
    expect(supabaseFetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(supabaseFetch).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(ROOM_RETENTION_INTERVAL_MS);
    expect(supabaseFetch).toHaveBeenCalledTimes(4);
  });

  it('is idempotent', async () => {
    vi.useFakeTimers();
    scheduleRoomRetention();
    scheduleRoomRetention();
    await vi.advanceTimersByTimeAsync(ROOM_RETENTION_BOOT_DELAY_MS);
    expect(supabaseFetch).toHaveBeenCalledTimes(2);
  });

  it('does nothing when ROOM_RETENTION_REAPER_ENABLED is "false"', async () => {
    vi.useFakeTimers();
    process.env.ROOM_RETENTION_REAPER_ENABLED = 'false';
    scheduleRoomRetention();
    await vi.advanceTimersByTimeAsync(ROOM_RETENTION_BOOT_DELAY_MS + ROOM_RETENTION_INTERVAL_MS);
    expect(supabaseFetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
