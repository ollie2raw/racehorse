import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createReservedRoom,
  deleteRoom,
  getRoom,
  joinRoom,
  startGame,
} from '../rooms';
import {
  broadcastStateUpdate,
  initRoomSession,
  setRoomRoster,
} from './roomSession';

vi.mock('../supabaseUtils', () => ({
  supabaseFetch: vi.fn(async () => undefined),
}));

function makeIo() {
  return {
    sockets: { sockets: new Map(), adapter: { rooms: new Map() } },
    to: () => ({ emit: vi.fn(), except: () => ({ emit: vi.fn() }) }),
  } as any;
}

const onGameOver = vi.fn(() => null);
const finalizeTournamentMatch = vi.fn();

function initSession() {
  initRoomSession(makeIo(), {
    resolveSocketIdentity: async () => ({ username: 'Guest', userId: null }),
    normalizeUsername: (v: unknown) => (typeof v === 'string' ? v : 'Guest'),
    normalizeUserId: (v: unknown) => (typeof v === 'string' ? v : null),
    tryHydrateMatchmakingRoomShell: async () => 'skipped',
    waitUntilMatchmakingRoomSocketsReady: async () => undefined,
    onAfterMatchStarted: async () => undefined,
    notifyRoomPlayersInGame: () => undefined,
    maybeFinalizeTournamentMatch: () => undefined,
    persistRoomMatchLog: async () => undefined,
    onGameOver,
    finalizeTournamentMatch,
  });
}

async function makeGameOverRoom(code: string) {
  const room = createReservedRoom(code, { winningScore: 30 });
  joinRoom(code, 'p1');
  joinRoom(code, 'p2');
  setRoomRoster(code, [
    { id: 'p1', socketId: '', username: 'P1', userId: 'u1' },
    { id: 'p2', socketId: '', username: 'P2', userId: 'u2' },
  ]);
  await startGame(code, makeIo());
  const started = getRoom(code);
  started.state!.gameOver = true;
  started.state!.handOver = true;
  started.state!.winnerId = started.state!.playerIds[0];
  return started;
}

describe('broadcastStateUpdate game-over routing (T-12)', () => {
  beforeEach(() => {
    onGameOver.mockClear();
    finalizeTournamentMatch.mockClear();
    initSession();
  });
  afterEach(() => {
    ['GOR_SCHED', 'GOR_LEGACY', 'GOR_PRIV'].forEach(deleteRoom);
    vi.useRealTimers();
  });

  it('scheduled-tournament room routes game-over through onGameOver, not the legacy finalizer', async () => {
    const room = await makeGameOverRoom('GOR_SCHED');
    room.scheduledTournamentMatchId = 'match-1';

    broadcastStateUpdate('GOR_SCHED');
    await new Promise((r) => setImmediate(r));

    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(finalizeTournamentMatch).not.toHaveBeenCalled();
  });

  it('legacy-league room routes game-over through finalizeTournamentMatch, not onGameOver', async () => {
    const room = await makeGameOverRoom('GOR_LEGACY');
    room.config.tournamentId = 'league-1';

    broadcastStateUpdate('GOR_LEGACY');
    await new Promise((r) => setImmediate(r));

    expect(finalizeTournamentMatch).toHaveBeenCalledTimes(1);
    expect(onGameOver).not.toHaveBeenCalled();
  });

  it('private room routes game-over through onGameOver only', async () => {
    await makeGameOverRoom('GOR_PRIV');

    broadcastStateUpdate('GOR_PRIV');
    await new Promise((r) => setImmediate(r));

    expect(onGameOver).toHaveBeenCalledTimes(1);
    expect(finalizeTournamentMatch).not.toHaveBeenCalled();
  });
});

