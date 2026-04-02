import type { LeagueMemberRecord, LeagueRecord } from './service';
import { computeLeagueStandings, type LeagueStandingRow } from './results';
import { generateLeagueFixtures, type GeneratedLeagueSchedule, type FixtureRecord } from './schedule';

interface BotRecord {
  id: string;
  display_name: string;
  division: 1 | 2 | 3;
  personality: string;
  difficulty: number;
  is_fritz: boolean;
  active: boolean;
}

interface HistoryRecord {
  id: number;
  player_user_id: string;
  season: number;
  division: 1 | 2 | 3;
  league_id: string;
  final_position: number;
  promoted: boolean;
  relegated: boolean;
  created_at: string;
}

interface RolloverPlayer {
  userId: string;
  username: string;
  currentDivision: 1 | 2 | 3;
  nextDivision: 1 | 2 | 3;
}

export interface LeagueRolloverResult {
  throughDate: string;
  completedLeagues: Array<{
    league: LeagueRecord;
    standings: LeagueStandingRow[];
  }>;
  historyRowsWritten: number;
  createdLeagues: GeneratedLeagueSchedule[];
  existingNextLeagues: LeagueRecord[];
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LEAGUE_SIZE = 7;

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

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekWindowContaining(dateSeed: string): { weekStart: string; weekEnd: string } {
  const day = startOfUtcDay(new Date(`${dateSeed}T00:00:00Z`));
  const dayOfWeek = day.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = addUtcDays(day, mondayOffset);
  const sunday = addUtcDays(monday, 6);
  return { weekStart: isoDateUtc(monday), weekEnd: isoDateUtc(sunday) };
}

function nextWeekWindowFrom(dateSeed: string): { weekStart: string; weekEnd: string } {
  const current = weekWindowContaining(dateSeed);
  const nextMonday = addUtcDays(new Date(`${current.weekStart}T00:00:00Z`), 7);
  const nextSunday = addUtcDays(nextMonday, 6);
  return { weekStart: isoDateUtc(nextMonday), weekEnd: isoDateUtc(nextSunday) };
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

async function fetchLeaguesToClose(throughDate: string): Promise<LeagueRecord[]> {
  return await supabaseFetch<LeagueRecord[]>(
    `/rest/v1/leagues?select=id,division,season,week_start,week_end,status,created_at` +
      `&status=eq.active&week_end=lte.${throughDate}&order=season.asc,division.asc,created_at.asc`,
    { method: 'GET' },
  );
}

async function fetchActiveLeaguesForWeek(weekStart: string): Promise<LeagueRecord[]> {
  return await supabaseFetch<LeagueRecord[]>(
    `/rest/v1/leagues?select=id,division,season,week_start,week_end,status,created_at` +
      `&status=eq.active&week_start=eq.${weekStart}&order=division.asc,created_at.asc`,
    { method: 'GET' },
  );
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

async function fetchSeasonHistory(season: number): Promise<HistoryRecord[]> {
  return await supabaseFetch<HistoryRecord[]>(
    `/rest/v1/player_league_history?select=id,player_user_id,season,division,league_id,final_position,promoted,relegated,created_at` +
      `&season=eq.${season}`,
    { method: 'GET' },
  );
}

async function upsertSeasonHistory(
  rows: Array<{
    player_user_id: string;
    season: number;
    division: 1 | 2 | 3;
    league_id: string;
    final_position: number;
    promoted: boolean;
    relegated: boolean;
  }>,
): Promise<HistoryRecord[]> {
  if (rows.length === 0) return [];
  return await supabaseFetch<HistoryRecord[]>(
    `/rest/v1/player_league_history?on_conflict=player_user_id,season`,
    {
      method: 'POST',
      headers: {
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(rows),
    },
  );
}

async function markLeaguesCompleted(leagueIds: string[]): Promise<void> {
  if (leagueIds.length === 0) return;
  for (const leagueId of leagueIds) {
    await supabaseFetch<LeagueRecord[]>(`/rest/v1/leagues?id=eq.${leagueId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed' }),
    });
  }
}

async function fetchDivisionBots(division: 1 | 2 | 3): Promise<BotRecord[]> {
  return await supabaseFetch<BotRecord[]>(
    `/rest/v1/league_bots?select=id,display_name,division,personality,difficulty,is_fritz,active` +
      `&division=eq.${division}&active=eq.true&order=difficulty.asc,display_name.asc`,
    { method: 'GET' },
  );
}

async function createLeague(input: {
  division: 1 | 2 | 3;
  season: number;
  weekStart: string;
  weekEnd: string;
}): Promise<LeagueRecord> {
  const rows = await supabaseFetch<LeagueRecord[]>(`/rest/v1/leagues`, {
    method: 'POST',
    body: JSON.stringify([
      {
        division: input.division,
        season: input.season,
        week_start: input.weekStart,
        week_end: input.weekEnd,
        status: 'active',
      },
    ]),
  });
  const league = rows[0];
  if (!league) throw new Error('Failed to create rollover league.');
  return league;
}

async function insertLeagueMembers(
  members: Array<{
    league_id: string;
    slot: number;
    member_type: 'player' | 'bot';
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

function computeNextDivision(position: number, division: 1 | 2 | 3): 1 | 2 | 3 {
  if (position <= 2) return division === 1 ? 1 : ((division - 1) as 1 | 2);
  if (position >= 6) return division === 3 ? 3 : ((division + 1) as 2 | 3);
  return division;
}

function chunkPlayersForDivision(
  players: RolloverPlayer[],
  division: 1 | 2 | 3,
): Array<{ players: RolloverPlayer[]; includeFritz: boolean }> {
  const ordered = [...players].sort((a, b) => a.userId.localeCompare(b.userId));
  const groups: Array<{ players: RolloverPlayer[]; includeFritz: boolean }> = [];

  if (division === 1) {
    const firstGroupSize = Math.min(6, ordered.length);
    const firstGroupPlayers = ordered.splice(0, firstGroupSize);
    groups.push({ players: firstGroupPlayers, includeFritz: true });
  }

  while (ordered.length > 0) {
    groups.push({ players: ordered.splice(0, LEAGUE_SIZE), includeFritz: false });
  }

  if (division !== 1 && groups.length === 0) {
    return [];
  }

  if (division === 1 && groups.length === 0) {
    groups.push({ players: [], includeFritz: true });
  }

  return groups;
}

function pickBotFillers(
  bots: BotRecord[],
  count: number,
  usedFritz: boolean,
): BotRecord[] {
  const pool = bots.filter((bot) => !bot.is_fritz || !usedFritz);
  const nonFritz = pool.filter((bot) => !bot.is_fritz);
  const out: BotRecord[] = [];
  for (let idx = 0; idx < count; idx += 1) {
    const bot = nonFritz[idx % nonFritz.length];
    if (!bot) throw new Error('Not enough active bots to fill league.');
    out.push(bot);
  }
  return out;
}

async function createNextSeasonLeagues(
  nextSeason: number,
  nextWeekStart: string,
  nextWeekEnd: string,
  playersByDivision: Map<1 | 2 | 3, RolloverPlayer[]>,
): Promise<GeneratedLeagueSchedule[]> {
  const created: GeneratedLeagueSchedule[] = [];
  const botsByDivision = new Map<1 | 2 | 3, BotRecord[]>();

  for (const division of [1, 2, 3] as const) {
    botsByDivision.set(division, await fetchDivisionBots(division));
  }

  for (const division of [1, 2, 3] as const) {
    const players = playersByDivision.get(division) ?? [];
    const groups = chunkPlayersForDivision(players, division);
    if (division !== 1 && groups.length === 0) continue;

    for (const group of groups) {
      const league = await createLeague({
        division,
        season: nextSeason,
        weekStart: nextWeekStart,
        weekEnd: nextWeekEnd,
      });

      const divisionBots = botsByDivision.get(division) ?? [];
      const fritz = divisionBots.find((bot) => bot.is_fritz) ?? null;
      const membersToInsert: Array<{
        league_id: string;
        slot: number;
        member_type: 'player' | 'bot';
        player_user_id: string | null;
        bot_id: string | null;
        display_name: string;
      }> = [];

      let slot = 1;
      for (const player of group.players) {
        membersToInsert.push({
          league_id: league.id,
          slot,
          member_type: 'player',
          player_user_id: player.userId,
          bot_id: null,
          display_name: player.username,
        });
        slot += 1;
      }

      if (group.includeFritz) {
        if (!fritz) throw new Error('Fritz bot is required for Division 1 rollover.');
        membersToInsert.push({
          league_id: league.id,
          slot,
          member_type: 'bot',
          player_user_id: null,
          bot_id: fritz.id,
          display_name: fritz.display_name,
        });
        slot += 1;
      }

      const fillerCount = LEAGUE_SIZE - membersToInsert.length;
      const fillers = pickBotFillers(divisionBots, fillerCount, group.includeFritz);
      for (const bot of fillers) {
        membersToInsert.push({
          league_id: league.id,
          slot,
          member_type: 'bot',
          player_user_id: null,
          bot_id: bot.id,
          display_name: bot.display_name,
        });
        slot += 1;
      }

      await insertLeagueMembers(membersToInsert);
      created.push(await generateLeagueFixtures(league.id));
    }
  }

  return created;
}

export async function runLeagueSundayRollover(throughDate = todayUtcDate()): Promise<LeagueRolloverResult> {
  const leaguesToClose = await fetchLeaguesToClose(throughDate);
  if (leaguesToClose.length === 0) {
    return {
      throughDate,
      completedLeagues: [],
      historyRowsWritten: 0,
      createdLeagues: [],
      existingNextLeagues: [],
    };
  }

  const nextWeek = nextWeekWindowFrom(throughDate);
  const existingNextLeagues = await fetchActiveLeaguesForWeek(nextWeek.weekStart);

  const completedLeagues: LeagueRolloverResult['completedLeagues'] = [];
  const historyPayload: Array<{
    player_user_id: string;
    season: number;
    division: 1 | 2 | 3;
    league_id: string;
    final_position: number;
    promoted: boolean;
    relegated: boolean;
  }> = [];
  const playersByDivision = new Map<1 | 2 | 3, RolloverPlayer[]>([
    [1, []],
    [2, []],
    [3, []],
  ]);

  for (const league of leaguesToClose) {
    const members = await fetchLeagueMembers(league.id);
    const fixtures = await fetchLeagueFixtures(league.id, league.season);
    const standings = computeLeagueStandings(members, fixtures);
    completedLeagues.push({ league, standings });

    for (const row of standings) {
      const member = members.find((entry) => entry.id === row.memberId);
      if (!member || member.member_type !== 'player' || !member.player_user_id) continue;

      const nextDivision = computeNextDivision(row.position, league.division);
      historyPayload.push({
        player_user_id: member.player_user_id,
        season: league.season,
        division: league.division,
        league_id: league.id,
        final_position: row.position,
        promoted: nextDivision < league.division,
        relegated: nextDivision > league.division,
      });
      playersByDivision.get(nextDivision)?.push({
        userId: member.player_user_id,
        username: member.display_name,
        currentDivision: league.division,
        nextDivision,
      });
    }
  }

  const existingHistory = await fetchSeasonHistory(leaguesToClose[0].season);
  const existingKeys = new Set(existingHistory.map((row) => `${row.player_user_id}:${row.season}`));
  const dedupedHistory = historyPayload.filter(
    (row) => !existingKeys.has(`${row.player_user_id}:${row.season}`),
  );
  const writtenHistory = await upsertSeasonHistory(dedupedHistory);
  await markLeaguesCompleted(leaguesToClose.map((league) => league.id));

  if (existingNextLeagues.length > 0) {
    return {
      throughDate,
      completedLeagues,
      historyRowsWritten: writtenHistory.length,
      createdLeagues: [],
      existingNextLeagues,
    };
  }

  const nextSeason = Math.max(...leaguesToClose.map((league) => league.season)) + 1;
  const createdLeagues = await createNextSeasonLeagues(
    nextSeason,
    nextWeek.weekStart,
    nextWeek.weekEnd,
    playersByDivision,
  );

  return {
    throughDate,
    completedLeagues,
    historyRowsWritten: writtenHistory.length,
    createdLeagues,
    existingNextLeagues: [],
  };
}
