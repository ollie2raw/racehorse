import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MatchTerminalJoinError, isTerminalHydrationError } from './matchTerminalJoin';
import * as roomMatchLogPersistence from './roomMatchLogPersistence';

describe('matchTerminalJoin', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('detects terminal hydration error codes', () => {
    expect(isTerminalHydrationError('snapshot_terminal')).toBe(true);
    expect(isTerminalHydrationError('snapshot_terminal_state')).toBe(true);
    expect(isTerminalHydrationError('snapshot_stale')).toBe(false);
  });

  it('builds MatchTerminalJoinError from archived row', async () => {
    vi.spyOn(roomMatchLogPersistence, 'queryLatestPersistedRoomMatchLogByRoomCode').mockResolvedValue({
      match_id: '11111111-1111-4111-8111-111111111111',
      room_code: 'ROOM1',
      status: 'completed',
      event_log_version: 1,
      last_event_sequence: 3,
      event_count: 3,
      started_at: null,
      archived_at: new Date().toISOString(),
      participant_user_ids: [],
      participants: [],
      summary: null,
      state_snapshot: null,
      events: [],
    });

    const { resolveArchivedTerminalJoin } = await import('./matchTerminalJoin');
    const error = await resolveArchivedTerminalJoin('ROOM1');
    expect(error).toBeInstanceOf(MatchTerminalJoinError);
    expect(error?.code).toBe('match_terminal');
    expect(error?.terminal).toEqual({
      status: 'completed',
      matchId: '11111111-1111-4111-8111-111111111111',
      recoverable: true,
    });
  });
});
