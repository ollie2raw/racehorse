import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchRow, ScheduledTournamentRow } from './types';
import { seedTournamentQa, type QaSeedDeps } from './qaSeed';

const VALID_USER_ID = '11111111-1111-4111-8111-111111111111';
const TOURNAMENT_ID = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-06-03T10:00:00.000Z');

function makeTournament(partial: Partial<ScheduledTournamentRow> = {}): ScheduledTournamentRow {
  return {
    id: TOURNAMENT_ID,
    scheduled_start: new Date('2026-06-03T10:12:00.000Z').toISOString(),
    registration_open_at: new Date('2026-06-03T09:55:00.000Z').toISOString(),
    registration_close_at: new Date('2026-06-03T10:10:00.000Z').toISOString(),
    status: 'registration_open',
    format: 'qa_browser_p0',
    win_target: 30,
    max_players: 8,
    winner_id: null,
    created_at: new Date('2026-06-03T09:54:00.000Z').toISOString(),
    ...partial,
  };
}

function makeHumanQuarterfinal(partial: Partial<MatchRow> = {}): MatchRow {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tournament_id: TOURNAMENT_ID,
    round: 1,
    match_number: 1,
    player1_id: VALID_USER_ID,
    player2_id: `bot:fritz:${TOURNAMENT_ID}:7`,
    winner_id: null,
    room_code: null,
    status: 'waiting',
    ready_at: null,
    ready_deadline_at: null,
    started_at: null,
    completed_at: null,
    player1_joined_at: null,
    player2_joined_at: null,
    winner_source: null,
    status_reason: null,
    forfeit_user_id: null,
    no_show_user_id: null,
    bot_tier: 'standard',
    player1_score: null,
    player2_score: null,
    ...partial,
  };
}

function makeDeps(overrides: Partial<QaSeedDeps> = {}): QaSeedDeps {
  const cancelPriorQaTournaments = vi.fn(async () => 2);
  const fetchQaUserProfile = vi.fn(async () => ({ id: VALID_USER_ID, username: 'qa_user' }));
  const createTournament = vi.fn(async () => makeTournament());
  const createRegistrations = vi.fn(async () => undefined);
  const fetchMatches = vi.fn(async () => [makeHumanQuarterfinal()]);
  const updateMatch = vi.fn(async () => undefined);
  const generateBracket = vi.fn(async () => []);
  const resolveWaitingBotOnlyQuarterfinals = vi.fn(async () => 0);
  const dispatchTournamentMatch = vi.fn(async () => ({
    ok: true as const,
    matchId: '33333333-3333-4333-8333-333333333333',
    tournamentId: TOURNAMENT_ID,
    roomCode: 'TQATESTR1M1',
    status: 'ready' as const,
    readyAt: NOW.toISOString(),
    readyDeadlineAt: new Date(NOW.getTime() + 2 * 60_000).toISOString(),
    recipients: [],
    reusedExistingRoom: false,
    emittedReady: false,
  }));
  return {
    env: {
      NODE_ENV: 'test',
      ENABLE_QA_TOURNAMENT_SEED: '1',
      QA_TOURNAMENT_USER_ID: VALID_USER_ID,
      SUPABASE_URL: 'http://127.0.0.1:54321',
    },
    now: NOW,
    io: { emit: vi.fn(), sockets: { sockets: new Map() } } as never,
    log: vi.fn(),
    store: {
      cancelPriorQaTournaments,
      fetchQaUserProfile,
      createTournament,
      createRegistrations,
      fetchMatches,
      updateMatch,
    },
    generateBracket: generateBracket as never,
    resolveWaitingBotOnlyQuarterfinals: resolveWaitingBotOnlyQuarterfinals as never,
    dispatchTournamentMatch: dispatchTournamentMatch as never,
    ...overrides,
  };
}

describe('seedTournamentQa', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects in production', async () => {
    const deps = makeDeps({
      env: {
        NODE_ENV: 'production',
        ENABLE_QA_TOURNAMENT_SEED: '1',
        QA_TOURNAMENT_USER_ID: VALID_USER_ID,
        SUPABASE_URL: 'http://127.0.0.1:54321',
      },
    });

    await expect(seedTournamentQa('waiting_room', deps)).rejects.toThrow('qa_seed_blocked_in_production');
  });

  it('rejects when ENABLE_QA_TOURNAMENT_SEED is missing', async () => {
    const deps = makeDeps({
      env: {
        NODE_ENV: 'test',
        QA_TOURNAMENT_USER_ID: VALID_USER_ID,
        SUPABASE_URL: 'http://127.0.0.1:54321',
      },
    });

    await expect(seedTournamentQa('waiting_room', deps)).rejects.toThrow(
      'qa_seed_requires_ENABLE_QA_TOURNAMENT_SEED',
    );
  });

  it('rejects when QA_TOURNAMENT_USER_ID is missing', async () => {
    const deps = makeDeps({
      env: {
        NODE_ENV: 'test',
        ENABLE_QA_TOURNAMENT_SEED: '1',
        SUPABASE_URL: 'http://127.0.0.1:54321',
      },
    });

    await expect(seedTournamentQa('waiting_room', deps)).rejects.toThrow(
      'qa_seed_requires_QA_TOURNAMENT_USER_ID',
    );
  });

  it('rejects unsupported fixture state cleanly', async () => {
    const deps = makeDeps();
    await expect(seedTournamentQa('bogus_state', deps)).rejects.toThrow(
      'unsupported_fixture_state:bogus_state',
    );
  });

  it('rejects explicitly unimplemented fixture states cleanly', async () => {
    const deps = makeDeps();
    await expect(seedTournamentQa('overlay_qf_loss', deps)).rejects.toThrow(
      'fixture_state_not_implemented:overlay_qf_loss',
    );
  });

  it('creates waiting_room without generating a bracket', async () => {
    const deps = makeDeps();
    const result = await seedTournamentQa('waiting_room', deps);

    expect(deps.store.cancelPriorQaTournaments).toHaveBeenCalledWith('qa_browser_p0');
    expect(deps.store.createTournament).toHaveBeenCalledTimes(1);
    expect(deps.store.createRegistrations).toHaveBeenCalledTimes(1);
    const regsArg = vi.mocked(deps.store.createRegistrations).mock.calls[0]?.[0];
    expect(regsArg).toHaveLength(1);
    expect(regsArg?.[0]).toMatchObject({ tournament_id: TOURNAMENT_ID, user_id: VALID_USER_ID, status: 'registered' });
    expect(regsArg?.some((row) => row.user_id.startsWith('bot:fritz:'))).toBe(false);
    expect(deps.generateBracket).not.toHaveBeenCalled();
    expect(deps.dispatchTournamentMatch).not.toHaveBeenCalled();
    expect(result.fixtureState).toBe('waiting_room');
    expect(result.canceledPriorQaFixtures).toBe(2);
    expect(result.humanMatchId).toBeNull();
    expect(result.roomCode).toBeNull();
  });

  it('routes bracket_lock through bracket generation only', async () => {
    const deps = makeDeps();
    const result = await seedTournamentQa('bracket_lock', deps);

    expect(deps.store.createRegistrations).toHaveBeenCalledTimes(1);
    const regsArg = vi.mocked(deps.store.createRegistrations).mock.calls[0]?.[0];
    expect(regsArg).toEqual([
      { tournament_id: TOURNAMENT_ID, user_id: VALID_USER_ID, status: 'registered' },
    ]);
    expect(deps.generateBracket).toHaveBeenCalledTimes(1);
    expect(deps.resolveWaitingBotOnlyQuarterfinals).not.toHaveBeenCalled();
    expect(deps.dispatchTournamentMatch).not.toHaveBeenCalled();
    const entrantsArg = vi.mocked(deps.generateBracket).mock.calls[0]?.[3];
    expect(Array.isArray(entrantsArg)).toBe(true);
    expect(entrantsArg).toHaveLength(8);
    expect(entrantsArg?.[0]).toMatchObject({ userId: VALID_USER_ID });
    expect(entrantsArg?.slice(1).every((entry) => entry.userId.startsWith(`bot:fritz:${TOURNAMENT_ID}:`))).toBe(true);
    expect(result.fixtureState).toBe('bracket_lock');
  });

  it('routes assigned_qf through bracket generation, bot resolution, and dispatch', async () => {
    const deps = makeDeps();
    const result = await seedTournamentQa('assigned_qf', deps);

    expect(deps.store.createRegistrations).toHaveBeenCalledTimes(1);
    const regsArg = vi.mocked(deps.store.createRegistrations).mock.calls[0]?.[0];
    expect(regsArg).toEqual([
      { tournament_id: TOURNAMENT_ID, user_id: VALID_USER_ID, status: 'registered' },
    ]);
    expect(deps.generateBracket).toHaveBeenCalledTimes(1);
    const entrantsArg = vi.mocked(deps.generateBracket).mock.calls[0]?.[3];
    expect(entrantsArg).toHaveLength(8);
    expect(entrantsArg?.[0]).toMatchObject({ userId: VALID_USER_ID });
    expect(deps.resolveWaitingBotOnlyQuarterfinals).toHaveBeenCalledTimes(1);
    expect(deps.store.fetchMatches).toHaveBeenCalledWith(TOURNAMENT_ID);
    expect(deps.dispatchTournamentMatch).toHaveBeenCalledWith(
      deps.io,
      '33333333-3333-4333-8333-333333333333',
      { reason: 'repair', emitIfAlreadyReady: true },
    );
    expect(result.fixtureState).toBe('assigned_qf');
    expect(result.humanMatchId).toBe('33333333-3333-4333-8333-333333333333');
    expect(result.roomCode).toBe('TQATESTR1M1');
  });

  it('routes live_qf through dispatch and marks the match in_progress with a QA fixture reason', async () => {
    const deps = makeDeps();
    const result = await seedTournamentQa('live_qf', deps);

    expect(result.fixtureState).toBe('live_qf');
    expect(deps.dispatchTournamentMatch).toHaveBeenCalledTimes(1);
    expect(deps.store.updateMatch).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({
        status: 'in_progress',
        status_reason: 'qa_fixture:live_qf',
        player1_joined_at: expect.any(String),
      }),
    );
  });

  it('routes near_30_qf with near-terminal fixture metadata', async () => {
    const deps = makeDeps();
    const result = await seedTournamentQa('near_30_qf', deps);

    expect(result.fixtureState).toBe('near_30_qf');
    expect(deps.store.updateMatch).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({
        status_reason: 'qa_fixture:near_30_qf',
        player1_score: 29,
      }),
    );
  });

  it('routes overlay_qf_win with terminal fixture metadata', async () => {
    const deps = makeDeps();
    const result = await seedTournamentQa('overlay_qf_win', deps);

    expect(result.fixtureState).toBe('overlay_qf_win');
    expect(deps.store.updateMatch).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      expect.objectContaining({
        status_reason: 'qa_fixture:overlay_qf_win',
        player1_score: 30,
      }),
    );
  });

  it('cleanup is based on the QA format marker, not the QA user registration graph', async () => {
    const deps = makeDeps();
    await seedTournamentQa('waiting_room', deps);
    expect(deps.store.cancelPriorQaTournaments).toHaveBeenCalledTimes(1);
    expect(deps.store.cancelPriorQaTournaments).toHaveBeenCalledWith('qa_browser_p0');
  });
});
