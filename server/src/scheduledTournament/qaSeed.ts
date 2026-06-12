import type { Server } from 'socket.io';
import { isValidUuid } from './persistence';
import { generateBracket, resolveWaitingBotOnlyQuarterfinals } from './engine';
import { dispatchTournamentMatch } from './matchDispatch';
import {
  QA_FIXTURE_LIVE_QF,
  QA_FIXTURE_NEAR_30_QF,
  QA_FIXTURE_OVERLAY_QF_WIN,
} from './qaSeedRoomFixture';
import type { MatchRow, ScheduledTournamentRow } from './types';
import { supabaseFetch } from '../supabaseUtils';

const QA_TOURNAMENT_FORMAT = 'qa_browser_p0';
const SUPPORTED_QA_SEED_STATES = [
  'waiting_room',
  'bracket_lock',
  'assigned_qf',
  'live_qf',
  'near_30_qf',
  'overlay_qf_win',
] as const;
const UNIMPLEMENTED_QA_SEED_STATES = [
  'overlay_qf_loss',
  'post_qf_bracket',
  'assigned_sf',
  'assigned_final',
  'champion_path',
] as const;
const QA_WIN_TARGET = 30;
const QA_MAX_PLAYERS = 8;

export type SupportedQaSeedState = (typeof SUPPORTED_QA_SEED_STATES)[number];
export type UnimplementedQaSeedState = (typeof UNIMPLEMENTED_QA_SEED_STATES)[number];
export type QaSeedState = SupportedQaSeedState | UnimplementedQaSeedState | string;

type QaUserProfile = {
  id: string;
  username: string | null;
};

type QaTournamentStore = {
  cancelPriorQaTournaments(format: string): Promise<number>;
  fetchQaUserProfile(userId: string): Promise<QaUserProfile | null>;
  createTournament(input: {
    registrationOpenAt: string;
    registrationCloseAt: string;
    scheduledStart: string;
    status: ScheduledTournamentRow['status'];
    format: string;
    winTarget: number;
    maxPlayers: number;
  }): Promise<ScheduledTournamentRow>;
  createRegistrations(rows: Array<{
    tournament_id: string;
    user_id: string;
    status: 'registered';
  }>): Promise<void>;
  fetchMatches(tournamentId: string): Promise<MatchRow[]>;
  updateMatch(matchId: string, patch: Partial<MatchRow>): Promise<void>;
};

export type QaSeedDeps = {
  env: NodeJS.ProcessEnv;
  now: Date;
  io: Server;
  log: (...args: unknown[]) => void;
  store: QaTournamentStore;
  generateBracket: typeof generateBracket;
  resolveWaitingBotOnlyQuarterfinals: typeof resolveWaitingBotOnlyQuarterfinals;
  dispatchTournamentMatch: typeof dispatchTournamentMatch;
};

export type QaSeedResult = {
  tournamentId: string;
  fixtureState: SupportedQaSeedState;
  qaUserId: string;
  qaUsername: string | null;
  scheduledStart: string;
  registrationCloseAt: string;
  roomCode: string | null;
  humanMatchId: string | null;
  canceledPriorQaFixtures: number;
  supportedStates: readonly SupportedQaSeedState[];
  nextQaStep: string;
};

function buildNoopIo(): Server {
  return {
    emit: () => undefined,
    sockets: {
      sockets: new Map(),
    },
  } as unknown as Server;
}

function isTruthyFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function assertSupportedState(state: QaSeedState): asserts state is SupportedQaSeedState {
  if ((SUPPORTED_QA_SEED_STATES as readonly string[]).includes(state)) return;
  if ((UNIMPLEMENTED_QA_SEED_STATES as readonly string[]).includes(state)) {
    throw new Error(`fixture_state_not_implemented:${state}`);
  }
  throw new Error(`unsupported_fixture_state:${state}`);
}

function assertQaSeedEnv(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV === 'production') {
    throw new Error('qa_seed_blocked_in_production');
  }
  if (!isTruthyFlag(env.ENABLE_QA_TOURNAMENT_SEED)) {
    throw new Error('qa_seed_requires_ENABLE_QA_TOURNAMENT_SEED');
  }
  const qaUserId = env.QA_TOURNAMENT_USER_ID?.trim() ?? '';
  if (!qaUserId) {
    throw new Error('qa_seed_requires_QA_TOURNAMENT_USER_ID');
  }
  if (!isValidUuid(qaUserId)) {
    throw new Error('qa_seed_requires_valid_QA_TOURNAMENT_USER_ID');
  }
  const supabaseUrl = env.SUPABASE_URL?.trim() ?? '';
  if (!supabaseUrl) {
    throw new Error('qa_seed_requires_SUPABASE_URL');
  }
  if (isObviousNonLocalSupabaseUrl(supabaseUrl) && !isTruthyFlag(env.QA_ALLOW_NONLOCAL_STAGING)) {
    throw new Error('qa_seed_refused_nonlocal_supabase_without_QA_ALLOW_NONLOCAL_STAGING');
  }
  return qaUserId;
}

function isObviousNonLocalSupabaseUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1') return false;
    if (host.endsWith('.local')) return false;
    return host.endsWith('.supabase.co');
  } catch {
    return true;
  }
}

function buildFixtureTimes(state: SupportedQaSeedState, now: Date): {
  status: ScheduledTournamentRow['status'];
  registrationOpenAt: string;
  registrationCloseAt: string;
  scheduledStart: string;
} {
  const nowMs = now.getTime();
  if (state === 'waiting_room') {
    const scheduledStartMs = nowMs + 12 * 60_000;
    return {
      status: 'registration_open',
      registrationOpenAt: new Date(nowMs - 5 * 60_000).toISOString(),
      registrationCloseAt: new Date(scheduledStartMs - 2 * 60_000).toISOString(),
      scheduledStart: new Date(scheduledStartMs).toISOString(),
    };
  }
  if (state === 'bracket_lock') {
    const scheduledStartMs = nowMs + 60_000;
    return {
      status: 'registration_open',
      registrationOpenAt: new Date(nowMs - 20 * 60_000).toISOString(),
      registrationCloseAt: new Date(scheduledStartMs - 2 * 60_000).toISOString(),
      scheduledStart: new Date(scheduledStartMs).toISOString(),
    };
  }
  const scheduledStartMs = nowMs - 60_000;
  return {
    status: 'registration_open',
    registrationOpenAt: new Date(nowMs - 20 * 60_000).toISOString(),
    registrationCloseAt: new Date(scheduledStartMs - 2 * 60_000).toISOString(),
    scheduledStart: new Date(scheduledStartMs).toISOString(),
  };
}

function buildQaEntrants(tournamentId: string, qaUserId: string, qaUsername: string | null) {
  const humanName = qaUsername?.trim() || 'QA Player';
  const bots = Array.from({ length: 7 }, (_, index) => ({
    userId: `bot:fritz:${tournamentId}:${index + 1}`,
    username: 'Fritz',
    rating: 1200 - index * 10,
    isBot: true,
    botTier: 'standard' as const,
  }));
  return [
    { userId: qaUserId, username: humanName, rating: 2400 },
    bots[0],
    bots[1],
    bots[2],
    bots[3],
    bots[4],
    bots[5],
    bots[6],
  ];
}

function nextQaStepForState(state: SupportedQaSeedState): string {
  if (state === 'waiting_room') {
    return 'Sign in with the QA account, open Tournament, confirm registered waiting-room state, then run bracket_lock.';
  }
  if (state === 'bracket_lock') {
    return 'Open the bracket lobby, verify lock/countdown state, then run assigned_qf to exercise attach.';
  }
  if (state === 'assigned_qf') {
    return 'Open Tournament signed in, verify Join Match is available, then execute TQ-06 through TQ-08 and reload checks.';
  }
  if (state === 'live_qf') {
    return 'Attach or rejoin the live quarterfinal; run TQ-07 through TQ-09, TQ-22, and TQ-26.';
  }
  if (state === 'near_30_qf') {
    return 'Attach to the near-terminal quarterfinal and verify HUD target 30 and final-move timing (TQ-07, TQ-28).';
  }
  return 'Attach to the completed quarterfinal overlay fixture and verify overlay persistence and reload (TQ-10, TQ-11, TQ-23).';
}

function qaFixtureReasonForState(state: SupportedQaSeedState): string | null {
  if (state === 'live_qf') return QA_FIXTURE_LIVE_QF;
  if (state === 'near_30_qf') return QA_FIXTURE_NEAR_30_QF;
  if (state === 'overlay_qf_win') return QA_FIXTURE_OVERLAY_QF_WIN;
  return null;
}

function needsAssignedQuarterfinal(state: SupportedQaSeedState): boolean {
  return state === 'assigned_qf' || state === 'live_qf' || state === 'near_30_qf' || state === 'overlay_qf_win';
}

function needsInProgressMatch(state: SupportedQaSeedState): boolean {
  return state === 'live_qf' || state === 'near_30_qf' || state === 'overlay_qf_win';
}

function findHumanQuarterfinal(matches: MatchRow[], qaUserId: string): MatchRow {
  const match = matches.find(
    (candidate) =>
      candidate.round === 1 &&
      (candidate.player1_id === qaUserId || candidate.player2_id === qaUserId),
  );
  if (!match) {
    throw new Error('qa_seed_human_quarterfinal_not_found');
  }
  return match;
}

function createDefaultStore(): QaTournamentStore {
  return {
    async cancelPriorQaTournaments(format: string): Promise<number> {
      const tournaments = await supabaseFetch<Array<{ id: string }>>(
        `/rest/v1/scheduled_tournaments` +
          `?select=id` +
          `&format=eq.${encodeURIComponent(format)}` +
          `&status=in.(upcoming,registration_open,in_progress)`,
      ).catch(() => []);
      for (const tournament of tournaments) {
        await supabaseFetch(
          `/rest/v1/scheduled_tournaments?id=eq.${encodeURIComponent(tournament.id)}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: 'cancelled' }),
          },
        );
      }
      return tournaments.length;
    },
    async fetchQaUserProfile(userId: string): Promise<QaUserProfile | null> {
      const rows = await supabaseFetch<Array<QaUserProfile>>(
        `/rest/v1/profiles?select=id,username&id=eq.${encodeURIComponent(userId)}&limit=1`,
      ).catch(() => []);
      return rows[0] ?? null;
    },
    async createTournament(input): Promise<ScheduledTournamentRow> {
      const inserted = await supabaseFetch<ScheduledTournamentRow[]>(
        '/rest/v1/scheduled_tournaments',
        {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify({
            scheduled_start: input.scheduledStart,
            registration_open_at: input.registrationOpenAt,
            registration_close_at: input.registrationCloseAt,
            status: input.status,
            format: input.format,
            win_target: input.winTarget,
            max_players: input.maxPlayers,
            winner_id: null,
          }),
        },
      );
      const row = inserted[0];
      if (!row) throw new Error('qa_seed_failed_to_create_tournament');
      return row;
    },
    async createRegistrations(rows): Promise<void> {
      await supabaseFetch('/rest/v1/scheduled_tournament_registrations', {
        method: 'POST',
        body: JSON.stringify(rows),
      });
    },
    async fetchMatches(tournamentId: string): Promise<MatchRow[]> {
      return supabaseFetch<MatchRow[]>(
        `/rest/v1/scheduled_tournament_matches` +
          `?select=*` +
          `&tournament_id=eq.${encodeURIComponent(tournamentId)}` +
          `&order=round.asc,match_number.asc`,
      );
    },
    async updateMatch(matchId, patch): Promise<void> {
      await supabaseFetch(
        `/rest/v1/scheduled_tournament_matches?id=eq.${encodeURIComponent(matchId)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        },
      );
    },
  };
}

function createDefaultDeps(): QaSeedDeps {
  return {
    env: process.env,
    now: new Date(),
    io: buildNoopIo(),
    log: (...args: unknown[]) => console.log(...args),
    store: createDefaultStore(),
    generateBracket,
    resolveWaitingBotOnlyQuarterfinals,
    dispatchTournamentMatch,
  };
}

export async function seedTournamentQa(
  state: QaSeedState,
  depsInput?: Partial<QaSeedDeps>,
): Promise<QaSeedResult> {
  const deps = { ...createDefaultDeps(), ...depsInput } as QaSeedDeps;
  assertSupportedState(state);
  const qaUserId = assertQaSeedEnv(deps.env);
  const canceledPriorQaFixtures = await deps.store.cancelPriorQaTournaments(QA_TOURNAMENT_FORMAT);
  const qaProfile = await deps.store.fetchQaUserProfile(qaUserId);
  const qaUsername = qaProfile?.username ?? null;
  const fixtureTimes = buildFixtureTimes(state, deps.now);

  deps.log('[tournament:qa-seed] start', {
    state,
    qaUserId,
    canceledPriorQaFixtures,
    scheduledStart: fixtureTimes.scheduledStart,
    registrationCloseAt: fixtureTimes.registrationCloseAt,
  });

  const tournament = await deps.store.createTournament({
    ...fixtureTimes,
    format: QA_TOURNAMENT_FORMAT,
    winTarget: QA_WIN_TARGET,
    maxPlayers: QA_MAX_PLAYERS,
  });
  const entrants = buildQaEntrants(tournament.id, qaUserId, qaUsername);
  await deps.store.createRegistrations(
    [{
      tournament_id: tournament.id,
      user_id: qaUserId,
      status: 'registered' as const,
    }],
  );

  let roomCode: string | null = null;
  let humanMatchId: string | null = null;

  if (state === 'bracket_lock' || needsAssignedQuarterfinal(state)) {
    await deps.generateBracket(deps.io, tournament.id, undefined, entrants);
  }

  if (needsAssignedQuarterfinal(state)) {
    await deps.resolveWaitingBotOnlyQuarterfinals(deps.io, tournament.id, undefined, deps.now);
    const matches = await deps.store.fetchMatches(tournament.id);
    const humanQuarterfinal = findHumanQuarterfinal(matches, qaUserId);
    const dispatch = await deps.dispatchTournamentMatch(
      deps.io,
      humanQuarterfinal.id,
      { reason: 'repair', emitIfAlreadyReady: true },
    );
    humanMatchId = dispatch.matchId;
    roomCode = dispatch.roomCode;

    if (needsInProgressMatch(state)) {
      const joinedAt = deps.now.toISOString();
      const humanIsPlayer1 = humanQuarterfinal.player1_id === qaUserId;
      await deps.store.updateMatch(humanQuarterfinal.id, {
        status: 'in_progress',
        started_at: joinedAt,
        status_reason: qaFixtureReasonForState(state),
        player1_joined_at: humanIsPlayer1 ? joinedAt : humanQuarterfinal.player1_joined_at,
        player2_joined_at: !humanIsPlayer1 ? joinedAt : humanQuarterfinal.player2_joined_at,
        player1_score: humanIsPlayer1 ? (state === 'overlay_qf_win' ? 30 : state === 'near_30_qf' ? 29 : 12) : humanQuarterfinal.player1_score,
        player2_score: !humanIsPlayer1 ? (state === 'overlay_qf_win' ? 30 : state === 'near_30_qf' ? 29 : 12) : humanQuarterfinal.player2_score,
      });
    }
  }

  const result: QaSeedResult = {
    tournamentId: tournament.id,
    fixtureState: state,
    qaUserId,
    qaUsername,
    scheduledStart: tournament.scheduled_start,
    registrationCloseAt: tournament.registration_close_at,
    roomCode,
    humanMatchId,
    canceledPriorQaFixtures,
    supportedStates: SUPPORTED_QA_SEED_STATES,
    nextQaStep: nextQaStepForState(state),
  };

  deps.log('[tournament:qa-seed] ready', result);
  return result;
}

export { QA_TOURNAMENT_FORMAT, SUPPORTED_QA_SEED_STATES, UNIMPLEMENTED_QA_SEED_STATES };
