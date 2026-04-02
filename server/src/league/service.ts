type LeagueStatus = 'active' | 'completed';
type MemberType = 'player' | 'bot';

export interface LeagueRecord {
  id: string;
  division: 1 | 2 | 3;
  season: number;
  week_start: string;
  week_end: string;
  status: LeagueStatus;
  created_at: string;
}

export interface LeagueMemberRecord {
  id: string;
  league_id: string;
  slot: number;
  member_type: MemberType;
  player_user_id: string | null;
  bot_id: string | null;
  display_name: string;
  joined_at: string;
}

interface ProfileRecord {
  id: string;
  username: string;
}

interface BotRecord {
  id: string;
  display_name: string;
  division: 1 | 2 | 3;
  personality: string;
  difficulty: number;
  is_fritz: boolean;
  active: boolean;
}

interface AssignmentResult {
  league: LeagueRecord;
  member: LeagueMemberRecord;
  mode: 'existing_league' | 'new_league' | 'already_assigned';
}

const DIVISION_ENTRY: 3 = 3;
const LEAGUE_SIZE = 7;
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

function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function getCurrentUtcWeekWindow(now = new Date()): { weekStart: string; weekEnd: string } {
  const day = startOfUtcDay(now);
  const dayOfWeek = day.getUTCDay(); // Sun=0
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = addUtcDays(day, mondayOffset);
  const sunday = addUtcDays(monday, 6);
  return { weekStart: isoDateUtc(monday), weekEnd: isoDateUtc(sunday) };
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

async function fetchProfile(userId: string): Promise<ProfileRecord> {
  const rows = await supabaseFetch<ProfileRecord[]>(
    `/rest/v1/profiles?select=id,username&id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  const profile = rows[0];
  if (!profile) {
    throw new Error(`Profile not found for user ${userId}.`);
  }
  return profile;
}

async function fetchCurrentSeasonLeagues(division: 1 | 2 | 3): Promise<LeagueRecord[]> {
  const { weekStart, weekEnd } = getCurrentUtcWeekWindow();
  return await supabaseFetch<LeagueRecord[]>(
    `/rest/v1/leagues?select=id,division,season,week_start,week_end,status,created_at` +
      `&division=eq.${division}` +
      `&status=eq.active` +
      `&week_start=eq.${weekStart}` +
      `&week_end=eq.${weekEnd}` +
      `&order=created_at.asc`,
    { method: 'GET' },
  );
}

async function fetchNextSeasonNumber(): Promise<number> {
  const rows = await supabaseFetch<Array<Pick<LeagueRecord, 'season'>>>(
    `/rest/v1/leagues?select=season&order=season.desc&limit=1`,
    { method: 'GET' },
  );
  return (rows[0]?.season ?? 0) + 1;
}

async function fetchLeagueMembers(leagueId: string): Promise<LeagueMemberRecord[]> {
  return await supabaseFetch<LeagueMemberRecord[]>(
    `/rest/v1/league_members?select=id,league_id,slot,member_type,player_user_id,bot_id,display_name,joined_at` +
      `&league_id=eq.${leagueId}&order=slot.asc`,
    { method: 'GET' },
  );
}

async function fetchDivisionBots(division: 1 | 2 | 3): Promise<BotRecord[]> {
  return await supabaseFetch<BotRecord[]>(
    `/rest/v1/league_bots?select=id,display_name,division,personality,difficulty,is_fritz,active` +
      `&division=eq.${division}&active=eq.true&order=difficulty.asc,display_name.asc`,
    { method: 'GET' },
  );
}

async function createLeague(season: number, division: 1 | 2 | 3): Promise<LeagueRecord> {
  const { weekStart, weekEnd } = getCurrentUtcWeekWindow();
  const rows = await supabaseFetch<LeagueRecord[]>(`/rest/v1/leagues`, {
    method: 'POST',
    body: JSON.stringify([
      {
        division,
        season,
        week_start: weekStart,
        week_end: weekEnd,
        status: 'active',
      },
    ]),
  });
  const league = rows[0];
  if (!league) throw new Error('Failed to create league.');
  return league;
}

async function insertLeagueMembers(
  members: Array<{
    league_id: string;
    slot: number;
    member_type: MemberType;
    player_user_id: string | null;
    bot_id: string | null;
    display_name: string;
  }>,
): Promise<LeagueMemberRecord[]> {
  return await supabaseFetch<LeagueMemberRecord[]>(`/rest/v1/league_members`, {
    method: 'POST',
    body: JSON.stringify(members),
  });
}

async function replaceBotSlotWithPlayer(
  memberId: string,
  userId: string,
  username: string,
): Promise<LeagueMemberRecord> {
  const rows = await supabaseFetch<LeagueMemberRecord[]>(
    `/rest/v1/league_members?id=eq.${memberId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        member_type: 'player',
        player_user_id: userId,
        bot_id: null,
        display_name: username,
      }),
    },
  );
  const member = rows[0];
  if (!member) throw new Error(`Failed to replace bot slot ${memberId}.`);
  return member;
}

function chooseOpenBotSlot(
  leagues: LeagueRecord[],
  membersByLeague: Map<string, LeagueMemberRecord[]>,
): { league: LeagueRecord; botMember: LeagueMemberRecord } | null {
  for (const league of leagues) {
    const members = membersByLeague.get(league.id) ?? [];
    const existingPlayer = members.find((member) => member.member_type === 'player');
    void existingPlayer;
    const openBot = members.find((member) => member.member_type === 'bot');
    if (openBot) {
      return { league, botMember: openBot };
    }
  }
  return null;
}

async function findExistingAssignment(userId: string, leagues: LeagueRecord[]): Promise<AssignmentResult | null> {
  for (const league of leagues) {
    const members = await fetchLeagueMembers(league.id);
    const member = members.find((entry) => entry.player_user_id === userId);
    if (member) {
      return { league, member, mode: 'already_assigned' };
    }
  }
  return null;
}

async function createDivisionThreeLeagueForPlayer(
  userId: string,
  username: string,
  season: number,
): Promise<AssignmentResult> {
  const league = await createLeague(season, DIVISION_ENTRY);
  const bots = await fetchDivisionBots(DIVISION_ENTRY);
  if (bots.length < LEAGUE_SIZE - 1) {
    throw new Error('Not enough active Division 3 bots to seed a league.');
  }

  const members = await insertLeagueMembers([
    {
      league_id: league.id,
      slot: 1,
      member_type: 'player',
      player_user_id: userId,
      bot_id: null,
      display_name: username,
    },
    ...bots.slice(0, LEAGUE_SIZE - 1).map((bot, idx) => ({
      league_id: league.id,
      slot: idx + 2,
      member_type: 'bot' as const,
      player_user_id: null,
      bot_id: bot.id,
      display_name: bot.display_name,
    })),
  ]);

  const member = members.find((entry) => entry.player_user_id === userId);
  if (!member) throw new Error('Created league but failed to insert player member.');

  return { league, member, mode: 'new_league' };
}

export async function assignPlayerToLeague(userId: string): Promise<AssignmentResult> {
  const profile = await fetchProfile(userId);
  const activeLeagues = await fetchCurrentSeasonLeagues(DIVISION_ENTRY);

  const existing = await findExistingAssignment(userId, activeLeagues);
  if (existing) return existing;

  const membersByLeague = new Map<string, LeagueMemberRecord[]>();
  for (const league of activeLeagues) {
    membersByLeague.set(league.id, await fetchLeagueMembers(league.id));
  }

  const openSlot = chooseOpenBotSlot(activeLeagues, membersByLeague);
  if (openSlot) {
    const member = await replaceBotSlotWithPlayer(openSlot.botMember.id, userId, profile.username);
    return { league: openSlot.league, member, mode: 'existing_league' };
  }

  const season = activeLeagues[0]?.season ?? (await fetchNextSeasonNumber());
  return await createDivisionThreeLeagueForPlayer(userId, profile.username, season);
}
