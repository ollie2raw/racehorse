import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'socket.io';
import * as rooms from '../rooms';
import { supabaseFetch } from '../supabaseUtils';
import {
  MATCHMAKING_JOIN_SYNC_MAX_MS,
  tryHydrateMatchmakingRoomShell,
  waitUntilMatchmakingRoomSocketsReady,
} from './roomShellHydration';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(),
}));

describe('tryHydrateMatchmakingRoomShell', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 'skipped' for non-MM-prefixed room codes", async () => {
    const fetchMock = vi.mocked(supabaseFetch);
    const peekSpy = vi.spyOn(rooms, 'peekRoom');

    const result = await tryHydrateMatchmakingRoomShell('PRIVATE1');

    expect(result).toEqual({ kind: 'skipped' });
    expect(peekSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'already' when the room is already in memory", async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue({ code: 'MM12345' } as rooms.Room);
    const fetchMock = vi.mocked(supabaseFetch);

    const result = await tryHydrateMatchmakingRoomShell('mm12345');

    expect(result).toEqual({ kind: 'already_in_memory', room: expect.any(Object) });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'miss' when Supabase has no in_progress row", async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue(undefined);
    vi.mocked(supabaseFetch).mockResolvedValue([]);

    const result = await tryHydrateMatchmakingRoomShell('MMNOPE');

    expect(result).toEqual({ kind: 'not_found' });
    expect(supabaseFetch).toHaveBeenCalledWith(
      '/rest/v1/matchmaking_matches?room_code=eq.MMNOPE&status=eq.in_progress&select=id,player_a_id,player_b_id&limit=1',
    );
  });

  it("returns 'hydrated' and sets matchmakingMatchId on the reserved shell", async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue(undefined);
    vi.mocked(supabaseFetch).mockResolvedValue([{ id: 'mm-match-1' }]);
    const created = { matchmakingMatchId: undefined as string | undefined };
    vi.spyOn(rooms, 'createReservedRoom').mockReturnValue(created as rooms.Room);

    const result = await tryHydrateMatchmakingRoomShell('MMHYDR');

    expect(result).toEqual({
      kind: 'shell_only',
      room: created,
      matchmakingMatchId: 'mm-match-1',
    });
    expect(rooms.createReservedRoom).toHaveBeenCalledWith('MMHYDR', { winningScore: 60 });
    expect(created.matchmakingMatchId).toBe('mm-match-1');
  });

  it('rejects hydrate from a socket that is not one of the two match players (M4)', async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue(undefined);
    vi.mocked(supabaseFetch).mockResolvedValue([
      { id: 'mm-match-acl', player_a_id: 'user-a', player_b_id: 'user-b' },
    ]);
    const createSpy = vi.spyOn(rooms, 'createReservedRoom');

    const result = await tryHydrateMatchmakingRoomShell('MMACL1', 'user-stranger');

    expect(result).toEqual({ kind: 'forbidden', matchmakingMatchId: 'mm-match-acl' });
    // No shell is created for a non-participant — nothing to seat into.
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects hydrate from an anonymous socket with no identity (M4)', async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue(undefined);
    vi.mocked(supabaseFetch).mockResolvedValue([
      { id: 'mm-match-anon', player_a_id: 'user-a', player_b_id: 'user-b' },
    ]);
    const createSpy = vi.spyOn(rooms, 'createReservedRoom');

    expect(await tryHydrateMatchmakingRoomShell('MMACL2', null)).toEqual({
      kind: 'forbidden',
      matchmakingMatchId: 'mm-match-anon',
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('hydrates normally for an assigned participant and records the seat ACL (M4)', async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue(undefined);
    vi.mocked(supabaseFetch).mockResolvedValue([
      { id: 'mm-match-ok', player_a_id: 'user-a', player_b_id: 'user-b' },
    ]);
    const created = {
      matchmakingMatchId: undefined as string | undefined,
      matchmakingParticipantUserIds: undefined as string[] | undefined,
    };
    vi.spyOn(rooms, 'createReservedRoom').mockReturnValue(created as rooms.Room);

    const result = await tryHydrateMatchmakingRoomShell('MMACL3', 'user-b');

    expect(result).toEqual({
      kind: 'shell_only',
      room: created,
      matchmakingMatchId: 'mm-match-ok',
    });
    expect(created.matchmakingMatchId).toBe('mm-match-ok');
    expect(created.matchmakingParticipantUserIds).toEqual(['user-a', 'user-b']);
  });

  it("returns 'miss' when Supabase fetch throws", async () => {
    vi.spyOn(rooms, 'peekRoom').mockReturnValue(undefined);
    vi.mocked(supabaseFetch).mockRejectedValue(new Error('db_down'));

    const result = await tryHydrateMatchmakingRoomShell('MMERR');

    expect(result).toEqual({
      kind: 'persistence_unavailable',
      error: 'db_down',
    });
  });
});

describe('waitUntilMatchmakingRoomSocketsReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function makeIo(membersForRoom: Set<string> | undefined): Server {
    return {
      sockets: {
        adapter: {
          rooms: {
            get: vi.fn(() => membersForRoom),
          },
        },
      },
    } as unknown as Server;
  }

  it('returns immediately when fewer than two engine seat socket ids are provided', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const io = makeIo(new Set(['sock-a']));

    await waitUntilMatchmakingRoomSocketsReady(io, 'MMROOM', ['sock-a']);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('returns immediately when both seat sockets are already in the room', async () => {
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    const io = makeIo(new Set(['sock-a', 'sock-b']));

    await waitUntilMatchmakingRoomSocketsReady(io, 'MMROOM', ['sock-a', 'sock-b']);

    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('polls every 50ms until both seat sockets join the room', async () => {
    let members = new Set<string>(['sock-a']);
    const io = makeIo(undefined);
    vi.mocked(io.sockets.adapter.rooms.get).mockImplementation(() => members);

    const pending = waitUntilMatchmakingRoomSocketsReady(io, 'MMROOM', ['sock-a', 'sock-b']);

    await vi.advanceTimersByTimeAsync(50);
    members = new Set(['sock-a', 'sock-b']);
    await vi.advanceTimersByTimeAsync(50);

    await pending;

    expect(io.sockets.adapter.rooms.get).toHaveBeenCalled();
  });

  it('stops polling after MATCHMAKING_JOIN_SYNC_MAX_MS and reports the timeout (M6)', async () => {
    const io = makeIo(new Set(['sock-a']));
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');

    const pending = waitUntilMatchmakingRoomSocketsReady(io, 'MMROOM', ['sock-a', 'sock-b']);

    await vi.advanceTimersByTimeAsync(MATCHMAKING_JOIN_SYNC_MAX_MS + 200);

    // Callers must be able to tell "synced" from "gave up" — returning void here
    // is what let the old code deal into an unsynced seat.
    await expect(pending).resolves.toBe('timeout');

    const pollDelays = setTimeoutSpy.mock.calls.map((call) => call[1]).filter((delay) => delay === 50);
    expect(pollDelays.length).toBeGreaterThan(0);
  });

  it('resolves ready when both sockets join in time', async () => {
    let members = new Set<string>(['sock-a']);
    const io = makeIo(undefined);
    vi.mocked(io.sockets.adapter.rooms.get).mockImplementation(() => members);

    const pending = waitUntilMatchmakingRoomSocketsReady(io, 'MMROOM', ['sock-a', 'sock-b']);
    await vi.advanceTimersByTimeAsync(50);
    members = new Set(['sock-a', 'sock-b']);
    await vi.advanceTimersByTimeAsync(50);

    await expect(pending).resolves.toBe('ready');
  });

  it('counts a seat that reconnects on a new socket id inside the window (M6)', async () => {
    // sock-b dropped and came back as sock-b2; the original snapshot would
    // never be satisfied, so the resolver is re-read each poll.
    const members = new Set<string>(['sock-a', 'sock-b2']);
    const io = makeIo(members);
    let seatSockets = ['sock-a', 'sock-b'];

    const pending = waitUntilMatchmakingRoomSocketsReady(
      io,
      'MMROOM',
      seatSockets,
      () => seatSockets,
    );
    seatSockets = ['sock-a', 'sock-b2'];
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toBe('ready');
  });
});
