/** Mirror of server/src/stats/matchLog.ts WeeklyAwards for socket stats:weekly payloads. */

export type WeeklyAwardLeader = {
  userId: string | null;
  username: string;
  value: number;
};

export type WeeklyAwardEntry = {
  key:
    | 'mostWins'
    | 'mostGames'
    | 'biggestWin'
    | 'closestWin'
    | 'longestWinStreak'
    | 'biggestComeback'
    | string;
  title: string;
  leader: WeeklyAwardLeader | null;
  leaderboard: WeeklyAwardLeader[];
};

export type WeeklyAwardsPayload = {
  weekStartISO?: string;
  weekEndISO?: string;
  awards?: WeeklyAwardEntry[];
};

export type PresenceOnlineSocketAck = {
  ok?: boolean;
  onlineCount?: number;
  onlineUserIds?: string[];
};

export type StatsWeeklySocketAck = {
  ok?: boolean;
  awards?: WeeklyAwardsPayload | null;
};
