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
  status: 'scheduled' | 'provisional' | 'completed' | 'forfeit';
  completed_at: string | null;
  live_room_code?: string | null;
  live_room_opened_at?: string | null;
  created_at: string;
}

export interface FixtureResolutionMeta {
  effectiveStatus: FixtureRecord['status'];
  effectiveMode: 'live' | 'ghost' | 'bot' | null;
  asyncAttempts: number;
  liveAttempts: number;
  liveCanOverride: boolean;
  liveRoomCode: string | null;
  liveRoomOpenedAt: string | null;
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

export interface LeagueHistorySeason {
  season: number;
  division: number;
  finalPosition: number;
  promoted: boolean;
  relegated: boolean;
  wins: number;
  draws: number;
  losses: number;
  createdAt: string;
}

export interface LeagueHistoryResponse {
  seasons: LeagueHistorySeason[];
  currentDivision: number | null;
}

export interface LeaguePlayerState {
  league: LeagueRecord;
  members: LeagueMemberRecord[];
  memberMeta: Record<string, { personality: string | null; isFritz: boolean }>;
  standings: LeagueStandingRow[];
  you: LeagueMemberRecord;
  todaysFixture: FixtureRecord | null;
  todaysOpponent: {
    memberId: string;
    displayName: string;
    memberType: 'player' | 'bot';
    online: boolean;
    personality: string | null;
    difficulty: number | null;
    isFritz: boolean;
    currentPosition: number | null;
    record: { wins: number; draws: number; losses: number } | null;
  } | null;
  isByeDay: boolean;
  newRealPlayerJoined: boolean;
  recentResults: FixtureRecord[];
  fullSchedule: FixtureRecord[];
  fixtureResolutionById: Record<string, FixtureResolutionMeta>;
}
