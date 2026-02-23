export type TournamentStatus = 'lobby' | 'running' | 'complete';

export type TournamentPlayer = {
  socketId: string;
  username: string;
  userId?: string | null;
};

export type MatchStatus = 'pending' | 'active' | 'done';

export type Match = {
  id: string;
  a: string;
  b: string;
  roomCode?: string;
  status: MatchStatus;
  winner?: string;
  scoreA?: number;
  scoreB?: number;
};

export type Standing = {
  socketId: string;
  username: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
};

export type Tournament = {
  id: string;
  lobbyCode: string;
  hostSocketId: string;
  status: TournamentStatus;
  players: TournamentPlayer[];
  matches: Match[];
  currentMatchIndex: number;
  standings: Record<string, Standing>;
};

export function makeLobbyCode(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

export function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function initStandings(players: TournamentPlayer[]): Record<string, Standing> {
  const s: Record<string, Standing> = {};
  for (const p of players) {
    s[p.socketId] = {
      socketId: p.socketId,
      username: p.username,
      played: 0,
      wins: 0,
      losses: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    };
  }
  return s;
}

/**
 * Round-robin schedule using circle method.
 * Returns list of matches in play order.
 */
export function buildRoundRobinMatches(players: TournamentPlayer[]): Match[] {
  const ids = players.map((p) => p.socketId);
  const list: Array<string | null> = ids.slice();

  if (list.length % 2 === 1) list.push(null); // BYE

  const n = list.length;
  const rounds = n - 1;
  const half = n // 2;

  const matches: Match[] = [];

  let arr = list.slice();
  for (let r = 0; r < rounds; r++) {
    const left = arr.slice(0, half);
    const right = arr.slice(half).reverse();

    for (let i = 0; i < half; i++) {
      const a = left[i];
      const b = right[i];
      if (!a || !b) continue;
      matches.push({ id: makeId('m'), a, b, status: 'pending' });
    }

    // rotate all except first element
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop()!);
    arr = [fixed, ...rest];
  }

  return matches;
}

export function sortStandings(standings: Record<string, Standing>): Standing[] {
  return Object.values(standings).sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    const dx = (y.pointsFor - y.pointsAgainst) - (x.pointsFor - x.pointsAgainst);
    if (dx !== 0) return dx;
    return y.pointsFor - x.pointsFor;
  });
}

export function applyMatchResult(
  t: Tournament,
  matchId: string,
  winnerSocketId: string,
  scoreA: number,
  scoreB: number,
): Tournament {
  const m = t.matches.find((mm) => mm.id === matchId);
  if (!m || m.status === 'done') return t;

  m.status = 'done';
  m.winner = winnerSocketId;
  m.scoreA = scoreA;
  m.scoreB = scoreB;

  const sa = t.standings[m.a];
  const sb = t.standings[m.b];

  sa.played += 1;
  sb.played += 1;

  sa.pointsFor += scoreA;
  sa.pointsAgainst += scoreB;
  sb.pointsFor += scoreB;
  sb.pointsAgainst += scoreA;

  if (winnerSocketId === m.a) {
    sa.wins += 1;
    sb.losses += 1;
  } else {
    sb.wins += 1;
    sa.losses += 1;
  }

  return t;
}
