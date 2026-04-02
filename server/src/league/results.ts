import type { LeagueMemberRecord, LeagueRecord } from './service';
import type { FixtureRecord } from './schedule';

export interface LeagueStandingRow {
  memberId: string;
  displayName: string;
  memberType: 'player' | 'bot';
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointsDiff: number;
  leaguePoints: number;
  position: number;
}

export interface RecordedLeagueResult {
  league: LeagueRecord;
  fixture: FixtureRecord;
  standings: LeagueStandingRow[];
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

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

async function fetchFixture(fixtureId: string): Promise<FixtureRecord> {
  const rows = await supabaseFetch<FixtureRecord[]>(
    `/rest/v1/fixtures?select=id,league_id,season,matchday,scheduled_date,home_member_id,away_member_id,home_score,away_score,status,completed_at,created_at&id=eq.${fixtureId}&limit=1`,
    { method: 'GET' },
  );
  const fixture = rows[0];
  if (!fixture) throw new Error(`Fixture not found: ${fixtureId}`);
  return fixture;
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

async function updateFixtureResult(
  fixtureId: string,
  homeScore: number,
  awayScore: number,
): Promise<FixtureRecord> {
  const now = new Date().toISOString();
  const rows = await supabaseFetch<FixtureRecord[]>(
    `/rest/v1/fixtures?id=eq.${fixtureId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        home_score: homeScore,
        away_score: awayScore,
        status: 'completed',
        completed_at: now,
      }),
    },
  );
  const fixture = rows[0];
  if (!fixture) throw new Error(`Failed to update fixture ${fixtureId}.`);
  return fixture;
}

export function computeLeagueStandings(
  members: LeagueMemberRecord[],
  fixtures: FixtureRecord[],
): LeagueStandingRow[] {
  const rows = new Map<string, LeagueStandingRow>();

  for (const member of members) {
    rows.set(member.id, {
      memberId: member.id,
      displayName: member.display_name,
      memberType: member.member_type,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointsDiff: 0,
      leaguePoints: 0,
      position: 0,
    });
  }

  for (const fixture of fixtures) {
    if (fixture.status === 'scheduled') continue;
    if (fixture.home_score === null || fixture.away_score === null) continue;

    const home = rows.get(fixture.home_member_id);
    const away = rows.get(fixture.away_member_id);
    if (!home || !away) {
      throw new Error(`Fixture ${fixture.id} references members outside the league.`);
    }

    home.played += 1;
    away.played += 1;
    home.pointsFor += fixture.home_score;
    home.pointsAgainst += fixture.away_score;
    away.pointsFor += fixture.away_score;
    away.pointsAgainst += fixture.home_score;

    if (fixture.home_score > fixture.away_score) {
      home.wins += 1;
      home.leaguePoints += 3;
      away.losses += 1;
    } else if (fixture.home_score < fixture.away_score) {
      away.wins += 1;
      away.leaguePoints += 3;
      home.losses += 1;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.leaguePoints += 1;
      away.leaguePoints += 1;
    }
  }

  const ordered = [...rows.values()].map((row) => ({
    ...row,
    pointsDiff: row.pointsFor - row.pointsAgainst,
  }));

  ordered.sort((a, b) => {
    if (b.leaguePoints !== a.leaguePoints) return b.leaguePoints - a.leaguePoints;
    if (b.pointsDiff !== a.pointsDiff) return b.pointsDiff - a.pointsDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    return a.displayName.localeCompare(b.displayName);
  });

  return ordered.map((row, idx) => ({ ...row, position: idx + 1 }));
}

export async function recordLeagueFixtureResult(
  fixtureId: string,
  homeScore: number,
  awayScore: number,
): Promise<RecordedLeagueResult> {
  if (!Number.isInteger(homeScore) || homeScore < 0) {
    throw new Error('homeScore must be a non-negative integer.');
  }
  if (!Number.isInteger(awayScore) || awayScore < 0) {
    throw new Error('awayScore must be a non-negative integer.');
  }

  const existing = await fetchFixture(fixtureId);
  if (existing.status !== 'scheduled') {
    if (existing.home_score === homeScore && existing.away_score === awayScore) {
      const league = await fetchLeague(existing.league_id);
      const members = await fetchLeagueMembers(existing.league_id);
      const fixtures = await fetchLeagueFixtures(existing.league_id, existing.season);
      return {
        league,
        fixture: existing,
        standings: computeLeagueStandings(members, fixtures),
      };
    }
    throw new Error(`Fixture ${fixtureId} is already ${existing.status}.`);
  }

  const fixture = await updateFixtureResult(fixtureId, homeScore, awayScore);
  const league = await fetchLeague(fixture.league_id);
  const members = await fetchLeagueMembers(fixture.league_id);
  const fixtures = await fetchLeagueFixtures(fixture.league_id, fixture.season);

  return {
    league,
    fixture,
    standings: computeLeagueStandings(members, fixtures),
  };
}
