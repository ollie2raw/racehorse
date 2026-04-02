import type { LeagueMemberRecord, LeagueRecord } from './service';
import { generateLeagueFixtures, type FixtureRecord } from './schedule';
import { computeLeagueStandings, type LeagueStandingRow } from './results';

interface BotRecord {
  id: string;
  display_name: string;
  division: 1 | 2 | 3;
  personality: string;
  difficulty: number;
  is_fritz: boolean;
  active: boolean;
}

export interface LeaguePlayerState {
  league: LeagueRecord;
  members: LeagueMemberRecord[];
  standings: LeagueStandingRow[];
  you: LeagueMemberRecord;
  todaysFixture: FixtureRecord | null;
  todaysOpponent: {
    memberId: string;
    displayName: string;
    memberType: 'player' | 'bot';
    personality: string | null;
    difficulty: number | null;
    isFritz: boolean;
    currentPosition: number | null;
    record: { wins: number; draws: number; losses: number } | null;
  } | null;
  isByeDay: boolean;
  recentResults: FixtureRecord[];
  fullSchedule: FixtureRecord[];
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

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function currentWeekStart(now = new Date()): string {
  const day = startOfUtcDay(now);
  const dayOfWeek = day.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  return addUtcDays(day, mondayOffset).toISOString().slice(0, 10);
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

async function fetchPlayerLeagueMembership(userId: string): Promise<LeagueMemberRecord | null> {
  const rows = await supabaseFetch<LeagueMemberRecord[]>(
    `/rest/v1/league_members?select=id,league_id,slot,member_type,player_user_id,bot_id,display_name,joined_at` +
      `&player_user_id=eq.${encodeURIComponent(userId)}&order=joined_at.desc&limit=1`,
    { method: 'GET' },
  );
  return rows[0] ?? null;
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

async function fetchBots(): Promise<BotRecord[]> {
  return await supabaseFetch<BotRecord[]>(
    `/rest/v1/league_bots?select=id,display_name,division,personality,difficulty,is_fritz,active&active=eq.true`,
    { method: 'GET' },
  );
}

export async function getLeagueStateForPlayer(userId: string): Promise<LeaguePlayerState | null> {
  const membership = await fetchPlayerLeagueMembership(userId);
  if (!membership) return null;

  const league = await fetchLeague(membership.league_id);
  if (league.status !== 'active' || league.week_start !== currentWeekStart()) {
    return null;
  }

  const [members, fixtures, bots] = await Promise.all([
    fetchLeagueMembers(league.id),
    fetchLeagueFixtures(league.id, league.season),
    fetchBots(),
  ]);
  const hydratedFixtures =
    fixtures.length > 0 ? fixtures : (await generateLeagueFixtures(league.id)).fixtures;

  const standings = computeLeagueStandings(members, hydratedFixtures);
  const today = todayUtcDate();
  const todaysFixture =
    hydratedFixtures.find(
      (fixture) =>
        fixture.scheduled_date === today &&
        (fixture.home_member_id === membership.id || fixture.away_member_id === membership.id),
    ) ?? null;
  const playedToday = Boolean(todaysFixture);
  const matchdayToday =
    todaysFixture?.matchday ??
    hydratedFixtures.find((fixture) => fixture.scheduled_date === today)?.matchday ??
    null;
  const isByeDay = !playedToday && matchdayToday !== null;
  const recentResults = hydratedFixtures
    .filter(
      (fixture) =>
        fixture.status !== 'scheduled' &&
        (fixture.home_member_id === membership.id || fixture.away_member_id === membership.id),
    )
    .slice(-3)
    .reverse();

  const memberById = new Map(members.map((member) => [member.id, member]));
  const botById = new Map(bots.map((bot) => [bot.id, bot]));
  const todaysOpponentMember =
    todaysFixture
      ? memberById.get(
          todaysFixture.home_member_id === membership.id
            ? todaysFixture.away_member_id
            : todaysFixture.home_member_id,
        ) ?? null
      : null;
  const opponentStanding = todaysOpponentMember
    ? standings.find((row) => row.memberId === todaysOpponentMember.id) ?? null
    : null;
  const opponentBot =
    todaysOpponentMember?.bot_id ? botById.get(todaysOpponentMember.bot_id) ?? null : null;

  return {
    league,
    members,
    standings,
    you: membership,
    todaysFixture,
    todaysOpponent: todaysOpponentMember
      ? {
          memberId: todaysOpponentMember.id,
          displayName: todaysOpponentMember.display_name,
          memberType: todaysOpponentMember.member_type,
          personality: opponentBot?.personality ?? null,
          difficulty: opponentBot?.difficulty ?? null,
          isFritz: Boolean(opponentBot?.is_fritz),
          currentPosition: opponentStanding?.position ?? null,
          record: opponentStanding
            ? {
                wins: opponentStanding.wins,
                draws: opponentStanding.draws,
                losses: opponentStanding.losses,
              }
            : null,
        }
      : null,
    isByeDay,
    recentResults,
    fullSchedule: hydratedFixtures,
  };
}
