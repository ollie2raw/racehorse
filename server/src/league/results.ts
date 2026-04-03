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

export interface FixtureMatchResultRecord {
  id: string;
  fixture_id: string;
  mode: 'live' | 'ghost' | 'bot';
  status: 'recorded' | 'superseded';
  player_member_id: string;
  opponent_member_id: string;
  home_score: number;
  away_score: number;
  source_user_id: string | null;
  room_code: string | null;
  metadata: Record<string, unknown>;
  superseded_at: string | null;
  created_at: string;
}

interface EffectiveFixtureResolution {
  state: 'scheduled' | 'provisional' | 'completed';
  result: FixtureMatchResultRecord | null;
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
    `/rest/v1/fixtures?select=id,league_id,season,matchday,scheduled_date,home_member_id,away_member_id,home_score,away_score,status,completed_at,live_room_code,live_room_opened_at,created_at&id=eq.${fixtureId}&limit=1`,
    { method: 'GET' },
  );
  const fixture = rows[0];
  if (!fixture) throw new Error(`Fixture not found: ${fixtureId}`);
  return fixture;
}

async function fetchFixtureMatchResults(fixtureId: string): Promise<FixtureMatchResultRecord[]> {
  return await supabaseFetch<FixtureMatchResultRecord[]>(
    `/rest/v1/fixture_match_results?select=id,fixture_id,mode,status,player_member_id,opponent_member_id,home_score,away_score,source_user_id,room_code,metadata,superseded_at,created_at` +
      `&fixture_id=eq.${fixtureId}&order=created_at.asc,id.asc`,
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

async function requireActiveLeagueForFixture(fixture: FixtureRecord): Promise<LeagueRecord> {
  const league = await fetchLeague(fixture.league_id);
  if (league.status !== 'active') {
    throw new Error(`League ${league.id} is already ${league.status}.`);
  }
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
    `/rest/v1/fixtures?select=id,league_id,season,matchday,scheduled_date,home_member_id,away_member_id,home_score,away_score,status,completed_at,live_room_code,live_room_opened_at,created_at` +
      `&league_id=eq.${leagueId}&season=eq.${season}&order=matchday.asc,scheduled_date.asc,created_at.asc`,
    { method: 'GET' },
  );
}

async function updateFixtureResult(
  fixtureId: string,
  patch: Partial<Pick<FixtureRecord, 'home_score' | 'away_score' | 'status' | 'completed_at' | 'live_room_code' | 'live_room_opened_at'>>,
): Promise<FixtureRecord> {
  const rows = await supabaseFetch<FixtureRecord[]>(
    `/rest/v1/fixtures?id=eq.${fixtureId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(patch),
    },
  );
  const fixture = rows[0];
  if (!fixture) throw new Error(`Failed to update fixture ${fixtureId}.`);
  return fixture;
}

async function insertFixtureMatchResult(input: {
  fixtureId: string;
  mode: 'live' | 'ghost' | 'bot';
  playerMemberId: string;
  opponentMemberId: string;
  homeScore: number;
  awayScore: number;
  sourceUserId?: string | null;
  roomCode?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<FixtureMatchResultRecord> {
  const rows = await supabaseFetch<FixtureMatchResultRecord[]>(`/rest/v1/fixture_match_results`, {
    method: 'POST',
    body: JSON.stringify([
      {
        fixture_id: input.fixtureId,
        mode: input.mode,
        status: 'recorded',
        player_member_id: input.playerMemberId,
        opponent_member_id: input.opponentMemberId,
        home_score: input.homeScore,
        away_score: input.awayScore,
        source_user_id: input.sourceUserId ?? null,
        room_code: input.roomCode ?? null,
        metadata: input.metadata ?? {},
      },
    ]),
  });
  const inserted = rows[0];
  if (!inserted) throw new Error('Failed to record fixture match result.');
  return inserted;
}

async function supersedeFixtureMatchResults(resultIds: string[]): Promise<void> {
  if (resultIds.length === 0) return;
  await supabaseFetch<FixtureMatchResultRecord[]>(
    `/rest/v1/fixture_match_results?id=in.(${resultIds.map((id) => `"${id}"`).join(',')})`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'superseded',
        superseded_at: new Date().toISOString(),
      }),
    },
  );
}

function resolveEffectiveFixtureResolution(
  fixture: FixtureRecord,
  results: FixtureMatchResultRecord[],
): EffectiveFixtureResolution {
  if (fixture.status === 'forfeit') {
    return { state: 'completed', result: null };
  }

  const active = results.filter((result) => result.status === 'recorded');
  const live = active.find((result) => result.mode === 'live') ?? null;
  if (live) {
    return { state: 'completed', result: live };
  }

  const provisional =
    active.find((result) => result.mode === 'ghost' || result.mode === 'bot') ?? null;
  if (provisional) {
    return { state: 'provisional', result: provisional };
  }

  return { state: 'scheduled', result: null };
}

async function syncFixtureWithEffectiveResolution(
  fixture: FixtureRecord,
  results: FixtureMatchResultRecord[],
): Promise<FixtureRecord> {
  const effective = resolveEffectiveFixtureResolution(fixture, results);
  if (fixture.status === 'forfeit') {
    return fixture;
  }

  if (!effective.result) {
    return await updateFixtureResult(fixture.id, {
      home_score: null,
      away_score: null,
      status: 'scheduled',
      completed_at: null,
    });
  }

  return await updateFixtureResult(fixture.id, {
    home_score: effective.result.home_score,
    away_score: effective.result.away_score,
    status: effective.state,
    completed_at: effective.state === 'completed' ? effective.result.created_at : null,
  });
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
  if (existing.status === 'forfeit') {
    throw new Error(`Fixture ${fixtureId} is already forfeit.`);
  }
  const league = await requireActiveLeagueForFixture(existing);

  const fixture = await updateFixtureResult(fixtureId, {
    home_score: homeScore,
    away_score: awayScore,
    status: 'completed',
    completed_at: new Date().toISOString(),
  });
  const members = await fetchLeagueMembers(fixture.league_id);
  const fixtures = await fetchLeagueFixtures(fixture.league_id, fixture.season);

  return {
    league,
    fixture,
    standings: computeLeagueStandings(members, fixtures),
  };
}

export async function recordLeagueAsyncResult(params: {
  fixtureId: string;
  mode: 'ghost' | 'bot';
  playerMemberId: string;
  opponentMemberId: string;
  homeScore: number;
  awayScore: number;
  sourceUserId: string;
  metadata?: Record<string, unknown>;
}): Promise<
  RecordedLeagueResult & {
    attempt: FixtureMatchResultRecord;
    isCanonicalProvisional: boolean;
  }
> {
  const fixture = await fetchFixture(params.fixtureId);
  if (fixture.status === 'completed' || fixture.status === 'forfeit') {
    throw new Error(`Fixture ${params.fixtureId} is already ${fixture.status}.`);
  }
  const league = await requireActiveLeagueForFixture(fixture);

  const existingResults = await fetchFixtureMatchResults(params.fixtureId);
  const hasLive = existingResults.some(
    (result) => result.status === 'recorded' && result.mode === 'live',
  );
  if (hasLive) {
    throw new Error(`Fixture ${params.fixtureId} is already live-resolved.`);
  }

  const attempt = await insertFixtureMatchResult({
    fixtureId: params.fixtureId,
    mode: params.mode,
    playerMemberId: params.playerMemberId,
    opponentMemberId: params.opponentMemberId,
    homeScore: params.homeScore,
    awayScore: params.awayScore,
    sourceUserId: params.sourceUserId,
    metadata: params.metadata,
  });

  // Re-read after insert so concurrent async submissions still converge on the
  // earliest recorded async result as the effective provisional one.
  const allResults = await fetchFixtureMatchResults(params.fixtureId);
  const syncedFixture = await syncFixtureWithEffectiveResolution(fixture, allResults);
  const effective = resolveEffectiveFixtureResolution(syncedFixture, allResults);
  const members = await fetchLeagueMembers(syncedFixture.league_id);
  const fixtures = await fetchLeagueFixtures(syncedFixture.league_id, syncedFixture.season);

  return {
    league,
    fixture: syncedFixture,
    standings: computeLeagueStandings(members, fixtures),
    attempt,
    isCanonicalProvisional: effective.result?.id === attempt.id,
  };
}

export async function recordLeagueLiveResult(params: {
  fixtureId: string;
  playerMemberId: string;
  opponentMemberId: string;
  homeScore: number;
  awayScore: number;
  sourceUserId?: string | null;
  roomCode?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<
  RecordedLeagueResult & {
    attempt: FixtureMatchResultRecord;
  }
> {
  const fixture = await fetchFixture(params.fixtureId);
  if (fixture.status === 'completed' || fixture.status === 'forfeit') {
    throw new Error(`Fixture ${params.fixtureId} is already ${fixture.status}.`);
  }
  const league = await requireActiveLeagueForFixture(fixture);

  const existingResults = await fetchFixtureMatchResults(params.fixtureId);
  const recordedLiveIds = existingResults
    .filter((result) => result.status === 'recorded' && result.mode === 'live')
    .map((result) => result.id);
  if (recordedLiveIds.length > 0) {
    throw new Error(`Fixture ${params.fixtureId} already has a live result.`);
  }

  const attempt = await insertFixtureMatchResult({
    fixtureId: params.fixtureId,
    mode: 'live',
    playerMemberId: params.playerMemberId,
    opponentMemberId: params.opponentMemberId,
    homeScore: params.homeScore,
    awayScore: params.awayScore,
    sourceUserId: params.sourceUserId ?? null,
    roomCode: params.roomCode ?? null,
    metadata: params.metadata,
  });

  const asyncIdsToSupersede = existingResults
    .filter(
      (result) =>
        result.status === 'recorded' && (result.mode === 'ghost' || result.mode === 'bot'),
    )
    .map((result) => result.id);
  await supersedeFixtureMatchResults(asyncIdsToSupersede);

  const liveFixture = await updateFixtureResult(params.fixtureId, {
    home_score: params.homeScore,
    away_score: params.awayScore,
    status: 'completed',
    completed_at: new Date().toISOString(),
    live_room_code: params.roomCode ?? fixture.live_room_code,
  });
  const members = await fetchLeagueMembers(liveFixture.league_id);
  const fixtures = await fetchLeagueFixtures(liveFixture.league_id, liveFixture.season);

  return {
    league,
    fixture: liveFixture,
    standings: computeLeagueStandings(members, fixtures),
    attempt,
  };
}

export async function openLeagueFixtureLiveRoom(
  fixtureId: string,
  roomCode: string,
): Promise<FixtureRecord> {
  const fixture = await fetchFixture(fixtureId);
  if (fixture.status === 'completed' || fixture.status === 'forfeit') {
    throw new Error(`Fixture ${fixtureId} is already ${fixture.status}.`);
  }
  await requireActiveLeagueForFixture(fixture);
  return await updateFixtureResult(fixtureId, {
    live_room_code: roomCode,
    live_room_opened_at: new Date().toISOString(),
  });
}
