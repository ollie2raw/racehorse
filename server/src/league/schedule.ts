import type { LeagueMemberRecord, LeagueRecord } from './service';

export interface FixtureRecord {
  id: string;
  league_id: string;
  season: number;
  matchday: number;
  scheduled_date: string;
  home_member_id: string;
  away_member_id: string;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'provisional' | 'completed' | 'forfeit';
  completed_at: string | null;
  live_room_code?: string | null;
  live_room_opened_at?: string | null;
  created_at: string;
}

export interface GeneratedLeagueSchedule {
  league: LeagueRecord;
  fixtures: FixtureRecord[];
  byesByMatchday: Array<{ matchday: number; scheduledDate: string; memberId: string; displayName: string }>;
}

interface GeneratedScheduleTemplate {
  fixtures: Array<
    Omit<
      FixtureRecord,
      'id' | 'home_score' | 'away_score' | 'status' | 'completed_at' | 'created_at'
    >
  >;
  byesByMatchday: GeneratedLeagueSchedule['byesByMatchday'];
}

type RotatingMember = Pick<LeagueMemberRecord, 'id' | 'display_name' | 'slot'>;

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

function addPstDays(dateSeed: string, days: number): string {
  const [yearText, monthText, dayText] = dateSeed.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  });
}

export function buildRoundRobinSchedule(
  members: LeagueMemberRecord[],
  weekStart: string,
): GeneratedScheduleTemplate {
  if (members.length !== 7) {
    throw new Error(`Round robin requires exactly 7 league members, got ${members.length}.`);
  }

  const ordered = [...members]
    .sort((a, b) => a.slot - b.slot)
    .map((member) => ({ id: member.id, display_name: member.display_name, slot: member.slot }));

  const rotation: Array<RotatingMember | null> = [...ordered, null];
  const fixtures: Array<Omit<FixtureRecord, 'id' | 'home_score' | 'away_score' | 'status' | 'completed_at' | 'created_at'>> = [];
  const byesByMatchday: GeneratedLeagueSchedule['byesByMatchday'] = [];

  for (let round = 0; round < rotation.length - 1; round += 1) {
    const scheduledDate = addPstDays(weekStart, round);
    const left = rotation.slice(0, rotation.length / 2);
    const right = rotation.slice(rotation.length / 2).reverse();

    for (let idx = 0; idx < left.length; idx += 1) {
      const home = left[idx];
      const away = right[idx];
      if (!home || !away) {
        const bye = home ?? away;
        if (bye) {
          byesByMatchday.push({
            matchday: round + 1,
            scheduledDate,
            memberId: bye.id,
            displayName: bye.display_name,
          });
        }
        continue;
      }

      fixtures.push({
        league_id: members[0].league_id,
        season: 0,
        matchday: round + 1,
        scheduled_date: scheduledDate,
        home_member_id: round % 2 === 0 ? home.id : away.id,
        away_member_id: round % 2 === 0 ? away.id : home.id,
      });
    }

    const fixed = rotation[0];
    const moving = rotation.slice(1);
    moving.unshift(moving.pop() ?? null);
    rotation.splice(0, rotation.length, fixed, ...moving);
  }

  return { fixtures, byesByMatchday };
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

async function fetchExistingFixtures(leagueId: string, season: number): Promise<FixtureRecord[]> {
  return await supabaseFetch<FixtureRecord[]>(
    `/rest/v1/fixtures?select=id,league_id,season,matchday,scheduled_date,home_member_id,away_member_id,home_score,away_score,status,completed_at,live_room_code,live_room_opened_at,created_at` +
      `&league_id=eq.${leagueId}&season=eq.${season}&order=matchday.asc,scheduled_date.asc`,
    { method: 'GET' },
  );
}

async function insertFixtures(
  fixtures: Array<Omit<FixtureRecord, 'id' | 'home_score' | 'away_score' | 'status' | 'completed_at' | 'created_at'>>,
): Promise<FixtureRecord[]> {
  return await supabaseFetch<FixtureRecord[]>(`/rest/v1/fixtures`, {
    method: 'POST',
    body: JSON.stringify(
      fixtures.map((fixture) => ({
        ...fixture,
        status: 'scheduled',
      })),
    ),
  });
}

export async function generateLeagueFixtures(leagueId: string): Promise<GeneratedLeagueSchedule> {
  const league = await fetchLeague(leagueId);
  const members = await fetchLeagueMembers(leagueId);
  const existing = await fetchExistingFixtures(leagueId, league.season);

  const generated = buildRoundRobinSchedule(members, league.week_start);
  if (existing.length > 0) {
    return {
      league,
      fixtures: existing,
      byesByMatchday: generated.byesByMatchday,
    };
  }

  const created = await insertFixtures(
    generated.fixtures.map((fixture) => ({
      ...fixture,
      season: league.season,
    })),
  );

  return {
    league,
    fixtures: created,
    byesByMatchday: generated.byesByMatchday,
  };
}
