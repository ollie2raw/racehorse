import { supabaseFetch } from '../supabaseUtils';

type LeagueHistoryRecord = {
  id: number;
  player_user_id: string;
  season: number;
  division: number;
  league_id: string;
  final_position: number;
  promoted: boolean;
  relegated: boolean;
  created_at: string;
  leagues?: { division?: number | null } | null;
};

type LeagueMemberRecord = {
  id: string;
  league_id: string;
  player_user_id: string | null;
};

type FixtureRecord = {
  league_id: string;
  home_member_id: string;
  away_member_id: string;
  home_score: number | null;
  away_score: number | null;
  status: 'scheduled' | 'provisional' | 'completed' | 'forfeit';
};

export type LeagueHistorySeason = {
  season: number;
  division: number;
  finalPosition: number;
  promoted: boolean;
  relegated: boolean;
  wins: number;
  draws: number;
  losses: number;
  createdAt: string;
};

export type LeagueHistoryResponse = {
  seasons: LeagueHistorySeason[];
  currentDivision: number | null;
};

function encodeList(values: string[]): string {
  return `(${values.map((value) => `"${value}"`).join(',')})`;
}

export async function getLeagueHistoryForPlayer(userId: string): Promise<LeagueHistoryResponse> {
  const historyRows = await supabaseFetch<LeagueHistoryRecord[]>(
    `/rest/v1/player_league_history?select=id,player_user_id,season,division,league_id,final_position,promoted,relegated,created_at,leagues(division)` +
      `&player_user_id=eq.${encodeURIComponent(userId)}` +
      `&order=season.desc`,
  );

  if (historyRows.length === 0) {
    const activeMembership = await supabaseFetch<Array<{ leagues?: { division?: number | null } | null }>>(
      `/rest/v1/league_members?select=leagues(division)` +
        `&player_user_id=eq.${encodeURIComponent(userId)}` +
        `&order=joined_at.desc&limit=1`,
    );
    return {
      seasons: [],
      currentDivision: Number(activeMembership[0]?.leagues?.division ?? null) || null,
    };
  }

  const leagueIds = [...new Set(historyRows.map((row) => row.league_id))];
  const memberRows = await supabaseFetch<LeagueMemberRecord[]>(
    `/rest/v1/league_members?select=id,league_id,player_user_id` +
      `&league_id=in.${encodeList(leagueIds)}`,
  );
  const fixtureRows = await supabaseFetch<FixtureRecord[]>(
    `/rest/v1/fixtures?select=league_id,home_member_id,away_member_id,home_score,away_score,status` +
      `&league_id=in.${encodeList(leagueIds)}` +
      `&status=in.(provisional,completed,forfeit)`,
  );

  const memberIdByLeague = new Map<string, string>();
  for (const member of memberRows) {
    if (member.player_user_id === userId) {
      memberIdByLeague.set(member.league_id, member.id);
    }
  }

  const seasons = historyRows.map((row) => {
    const memberId = memberIdByLeague.get(row.league_id);
    let wins = 0;
    let draws = 0;
    let losses = 0;

    if (memberId) {
      for (const fixture of fixtureRows) {
        if (fixture.league_id !== row.league_id) continue;
        if (fixture.home_score === null || fixture.away_score === null) continue;
        const isHome = fixture.home_member_id === memberId;
        const isAway = fixture.away_member_id === memberId;
        if (!isHome && !isAway) continue;
        const yourScore = isHome ? fixture.home_score : fixture.away_score;
        const oppScore = isHome ? fixture.away_score : fixture.home_score;
        if (yourScore > oppScore) wins += 1;
        else if (yourScore < oppScore) losses += 1;
        else draws += 1;
      }
    }

    return {
      season: row.season,
      division: Number(row.leagues?.division ?? row.division),
      finalPosition: row.final_position,
      promoted: Boolean(row.promoted),
      relegated: Boolean(row.relegated),
      wins,
      draws,
      losses,
      createdAt: row.created_at,
    };
  });

  const activeMembership = await supabaseFetch<Array<{ leagues?: { division?: number | null } | null }>>(
    `/rest/v1/league_members?select=leagues(division)` +
      `&player_user_id=eq.${encodeURIComponent(userId)}` +
      `&order=joined_at.desc&limit=1`,
  );

  return {
    seasons,
    currentDivision: Number(activeMembership[0]?.leagues?.division ?? seasons[0]?.division ?? null) || null,
  };
}
