import type { LeagueMemberRecord, LeagueRecord } from './service';
import type { FixtureRecord } from './schedule';
import { computeLeagueStandings, type LeagueStandingRow } from './results';

export interface ForfeitProcessedFixture {
  fixtureId: string;
  leagueId: string;
  scheduledDate: string;
  winnerMemberId: string;
  loserMemberId: string;
  homeScore: number;
  awayScore: number;
}

export interface ForfeitSkippedFixture {
  fixtureId: string;
  leagueId: string;
  scheduledDate: string;
  reason: 'both_players' | 'both_bots' | 'missing_member';
}

export interface ForfeitJobResult {
  throughDate: string;
  processed: ForfeitProcessedFixture[];
  skipped: ForfeitSkippedFixture[];
  standingsByLeague: Array<{
    league: LeagueRecord;
    standings: LeagueStandingRow[];
  }>;
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const FORFEIT_WIN_SCORE = 30;
const FORFEIT_LOSS_SCORE = 0;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function getConfig() {
  return {
    supabaseUrl: requireEnv('SUPABASE_URL', SUPABASE_URL),
    serviceKey: requireEnv('SUPABASE_SERVICE_KEY', SUPABASE_SERVICE_KEY),
  };
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function supabaseFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { supabaseUrl, serviceKey } = getConfig();
  const url = new URL(path, supabaseUrl);
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) return [] as T;
  return (await response.json()) as T;
}

async function fetchOverdueScheduledFixtures(throughDate: string): Promise<FixtureRecord[]> {
  return await supabaseFetch<FixtureRecord[]>(
    `/rest/v1/fixtures?select=id,league_id,season,matchday,scheduled_date,home_member_id,away_member_id,home_score,away_score,status,completed_at,created_at` +
      `&status=eq.scheduled&scheduled_date=lte.${throughDate}&order=scheduled_date.asc,created_at.asc`,
    { method: 'GET' },
  );
}

async function fetchLeague(leagueId: string): Promise<LeagueRecord> {
  const rows = await supabaseFetch<LeagueRecord[]>(
    `/rest/v1/leagues?select=id,division,season,week_start,week_end,status,created_at&id=eq.${leagueId}&limit=1`,
    { method: 'GET' },
  );
  const league = rows[0];
  if (!league) throw new Error(`League not found: ${leagueId}`);
  return league;
}

async function fetchLeagueMembers(leagueId: string): Promise<LeagueMemberRecord[]> {
  return await supabaseFetch<LeagueMemberRecord[]>(
    `/rest/v1/league_members?select=id,league_id,slot,member_type,player_user_id,bot_id,display_name,joined_at` +
      `&league_id=eq.${leagueId}&order=slot.asc`,
    { method: 'GET' },
  );
}

async function fetchLeagueFixtures(leagueId: string, season: number): Promise<FixtureRecord[]> {
  return await supabaseFetch<FixtureRecord[]>(
    `/rest/v1/fixtures?select=id,league_id,season,matchday,scheduled_date,home_member_id,away_member_id,home_score,away_score,status,completed_at,created_at` +
      `&league_id=eq.${leagueId}&season=eq.${season}&order=matchday.asc,scheduled_date.asc,created_at.asc`,
    { method: 'GET' },
  );
}

async function patchForfeitFixture(
  fixtureId: string,
  homeScore: number,
  awayScore: number,
): Promise<FixtureRecord> {
  const rows = await supabaseFetch<FixtureRecord[]>(
    `/rest/v1/fixtures?id=eq.${fixtureId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        home_score: homeScore,
        away_score: awayScore,
        status: 'forfeit',
        completed_at: new Date().toISOString(),
      }),
    },
  );
  const fixture = rows[0];
  if (!fixture) throw new Error(`Failed to mark fixture ${fixtureId} as forfeit.`);
  return fixture;
}

function determineForfeitOutcome(
  fixture: FixtureRecord,
  members: Map<string, LeagueMemberRecord>,
): ForfeitProcessedFixture | ForfeitSkippedFixture {
  const home = members.get(fixture.home_member_id);
  const away = members.get(fixture.away_member_id);
  if (!home || !away) {
    return {
      fixtureId: fixture.id,
      leagueId: fixture.league_id,
      scheduledDate: fixture.scheduled_date,
      reason: 'missing_member',
    };
  }

  if (home.member_type === 'bot' && away.member_type === 'player') {
    return {
      fixtureId: fixture.id,
      leagueId: fixture.league_id,
      scheduledDate: fixture.scheduled_date,
      winnerMemberId: home.id,
      loserMemberId: away.id,
      homeScore: FORFEIT_WIN_SCORE,
      awayScore: FORFEIT_LOSS_SCORE,
    };
  }

  if (home.member_type === 'player' && away.member_type === 'bot') {
    return {
      fixtureId: fixture.id,
      leagueId: fixture.league_id,
      scheduledDate: fixture.scheduled_date,
      winnerMemberId: away.id,
      loserMemberId: home.id,
      homeScore: FORFEIT_LOSS_SCORE,
      awayScore: FORFEIT_WIN_SCORE,
    };
  }

  return {
    fixtureId: fixture.id,
    leagueId: fixture.league_id,
    scheduledDate: fixture.scheduled_date,
    reason: home.member_type === 'bot' && away.member_type === 'bot' ? 'both_bots' : 'both_players',
  };
}

export async function runLeagueForfeitJob(throughDate = todayUtcDate()): Promise<ForfeitJobResult> {
  const overdue = await fetchOverdueScheduledFixtures(throughDate);
  const processed: ForfeitProcessedFixture[] = [];
  const skipped: ForfeitSkippedFixture[] = [];
  const affectedLeagueIds = new Set<string>();
  const membersByLeague = new Map<string, LeagueMemberRecord[]>();

  for (const fixture of overdue) {
    let members = membersByLeague.get(fixture.league_id);
    if (!members) {
      members = await fetchLeagueMembers(fixture.league_id);
      membersByLeague.set(fixture.league_id, members);
    }

    const outcome = determineForfeitOutcome(
      fixture,
      new Map(members.map((member) => [member.id, member])),
    );

    if ('reason' in outcome) {
      skipped.push(outcome);
      continue;
    }

    await patchForfeitFixture(fixture.id, outcome.homeScore, outcome.awayScore);
    processed.push(outcome);
    affectedLeagueIds.add(fixture.league_id);
  }

  const standingsByLeague: ForfeitJobResult['standingsByLeague'] = [];
  for (const leagueId of affectedLeagueIds) {
    const league = await fetchLeague(leagueId);
    const members = membersByLeague.get(leagueId) ?? (await fetchLeagueMembers(leagueId));
    const fixtures = await fetchLeagueFixtures(leagueId, league.season);
    standingsByLeague.push({
      league,
      standings: computeLeagueStandings(members, fixtures),
    });
  }

  return {
    throughDate,
    processed,
    skipped,
    standingsByLeague,
  };
}
