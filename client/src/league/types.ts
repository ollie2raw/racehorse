export interface LeagueRecord {
  id: string;
  division: 1 | 2 | 3;
  season: number;
  week_start: string;
  week_end: string;
  status: 'active' | 'completed';
  created_at: string;
}

export interface LeagueMemberRecord {
  id: string;
  league_id: string;
  slot: number;
  member_type: 'player' | 'bot';
  player_user_id: string | null;
  bot_id: string | null;
  display_name: string;
  joined_at: string;
}

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
  status: 'scheduled' | 'completed' | 'forfeit';
  completed_at: string | null;
  created_at: string;
}

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
