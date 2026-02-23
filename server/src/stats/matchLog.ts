import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type MatchLogEntry = {
  id: string;
  endedAtMs: number;
  roomCode: string;
  tournamentId?: string;
  tournamentMatchId?: string;
  a: { socketId: string; userId: string | null; username: string };
  b: { socketId: string; userId: string | null; username: string };
  scoreA: number;
  scoreB: number;
  winnerSocketId: string;
  pointDiff: number;
  maxDeficitWinner?: number;
};

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE_PATH = path.join(DATA_DIR, 'matches.jsonl');

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function appendMatch(entry: Omit<MatchLogEntry, 'id'> & { id?: string }): MatchLogEntry {
  ensureDir();
  const full: MatchLogEntry = {
    id: entry.id ?? randomUUID(),
    ...entry,
  };
  fs.appendFileSync(FILE_PATH, JSON.stringify(full) + '\n', 'utf8');
  return full;
}

export function readMatches(): MatchLogEntry[] {
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8').trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as MatchLogEntry);
  } catch {
    return [];
  }
}

export function getWeekWindowMs(nowMs: number): { startMs: number; endMs: number } {
  // Monday 00:00 -> next Monday 00:00, using server local time
  const now = new Date(nowMs);
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const diffToMonday = (day + 6) % 7; // Mon->0, Sun->6
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - diffToMonday);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return { startMs: start.getTime(), endMs: end.getTime() };
}

export type WeeklyAwards = {
  weekStartISO: string;
  weekEndISO: string;
  awards: Array<{
    key: 'mostWins' | 'mostGames' | 'biggestWin' | 'closestWin' | 'longestWinStreak' | 'biggestComeback';
    title: string;
    leader: { userId: string | null; username: string; value: number } | null;
    leaderboard: Array<{ userId: string | null; username: string; value: number }>;
  }>;
};

function sortDesc<T>(arr: T[], get: (x: T) => number): T[] {
  return [...arr].sort((a, b) => get(b) - get(a));
}

export function computeWeeklyAwards(nowMs: number): WeeklyAwards {
  const { startMs, endMs } = getWeekWindowMs(nowMs);
  const matches = readMatches().filter((m) => m.endedAtMs >= startMs && m.endedAtMs < endMs);

  const iso = (ms: number) => new Date(ms).toISOString();
  const weekStartISO = iso(startMs);
  const weekEndISO = iso(endMs);

  type Key = string; // userId preferred, fallback to socketId
  const keyOf = (m: MatchLogEntry, side: 'a' | 'b'): Key =>
    (m[side].userId ?? '') ? `u:${m[side].userId}` : `s:${m[side].socketId}`;
  const nameOf = (m: MatchLogEntry, side: 'a' | 'b'): string => m[side].username;
  const userIdOf = (m: MatchLogEntry, side: 'a' | 'b'): string | null => m[side].userId;

  const games: Record<Key, { username: string; userId: string | null; count: number }> = {};
  const wins: Record<Key, { username: string; userId: string | null; count: number }> = {};
  const biggestWin: Record<Key, { username: string; userId: string | null; value: number }> = {};
  const closestWin: Record<Key, { username: string; userId: string | null; value: number }> = {};
  const biggestComeback: Record<Key, { username: string; userId: string | null; value: number }> = {};

  for (const m of matches) {
    const aK = keyOf(m, 'a');
    const bK = keyOf(m, 'b');
    games[aK] ??= { username: nameOf(m, 'a'), userId: userIdOf(m, 'a'), count: 0 };
    games[bK] ??= { username: nameOf(m, 'b'), userId: userIdOf(m, 'b'), count: 0 };
    games[aK].count += 1;
    games[bK].count += 1;

    const winnerSide = m.winnerSocketId === m.a.socketId ? 'a' : 'b';
    const wK = keyOf(m, winnerSide);
    wins[wK] ??= { username: nameOf(m, winnerSide), userId: userIdOf(m, winnerSide), count: 0 };
    wins[wK].count += 1;

    biggestWin[wK] ??= { username: nameOf(m, winnerSide), userId: userIdOf(m, winnerSide), value: 0 };
    biggestWin[wK].value = Math.max(biggestWin[wK].value, m.pointDiff);

    closestWin[wK] ??= { username: nameOf(m, winnerSide), userId: userIdOf(m, winnerSide), value: Number.POSITIVE_INFINITY };
    closestWin[wK].value = Math.min(closestWin[wK].value, m.pointDiff);

    const deficit = typeof m.maxDeficitWinner === 'number' ? m.maxDeficitWinner : 0;
    biggestComeback[wK] ??= { username: nameOf(m, winnerSide), userId: userIdOf(m, winnerSide), value: 0 };
    biggestComeback[wK].value = Math.max(biggestComeback[wK].value, deficit);
  }

  // Longest win streak within the week window
  const streakBest: Record<Key, { username: string; userId: string | null; value: number }> = {};
  const byPlayer: Record<Key, MatchLogEntry[]> = {};
  for (const m of matches) {
    for (const side of ['a', 'b'] as const) {
      const k = keyOf(m, side);
      byPlayer[k] ??= [];
      byPlayer[k].push(m);
    }
  }
  for (const [k, ms] of Object.entries(byPlayer)) {
    const sorted = [...ms].sort((x, y) => x.endedAtMs - y.endedAtMs);
    let cur = 0;
    let best = 0;
    let meta: { username: string; userId: string | null } | null = null;

    for (const m of sorted) {
      const isA = keyOf(m, 'a') === k;
      const side = isA ? 'a' : 'b';
      meta ??= { username: nameOf(m, side), userId: userIdOf(m, side) };
      const won = (side === 'a' && m.winnerSocketId === m.a.socketId) || (side === 'b' && m.winnerSocketId === m.b.socketId);
      cur = won ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    if (meta) streakBest[k] = { ...meta, value: best };
  }

  const toBoard = (obj: Record<Key, { username: string; userId: string | null; count?: number; value?: number }>, field: 'count' | 'value') =>
    sortDesc(Object.values(obj).map((x) => ({ username: x.username, userId: x.userId, value: (x as any)[field] as number })), (x) => x.value);

  const mostWinsBoard = toBoard(wins as any, 'count');
  const mostGamesBoard = toBoard(games as any, 'count');
  const biggestWinBoard = toBoard(biggestWin as any, 'value');
  const closestWinBoardRaw = toBoard(closestWin as any, 'value');
  const closestWinBoard = [...closestWinBoardRaw].filter((x) => Number.isFinite(x.value)).sort((a,b)=>a.value-b.value);
  const comebackBoard = toBoard(biggestComeback as any, 'value');
  const streakBoard = sortDesc(Object.values(streakBest), (x) => x.value).map((x) => ({ username: x.username, userId: x.userId, value: x.value }));

  const mk = (key: WeeklyAwards['awards'][number]['key'], title: string, leaderboard: any[]) => ({
    key,
    title,
    leader: leaderboard[0] ?? null,
    leaderboard: leaderboard.slice(0, 5),
  });

  return {
    weekStartISO,
    weekEndISO,
    awards: [
      mk('mostWins', 'Most wins', mostWinsBoard),
      mk('mostGames', 'Most games played', mostGamesBoard),
      mk('biggestWin', 'Biggest win (margin)', biggestWinBoard),
      mk('closestWin', 'Closest win (margin)', closestWinBoard),
      mk('biggestComeback', 'Biggest comeback (down by)', comebackBoard),
      mk('longestWinStreak', 'Longest win streak', streakBoard),
    ],
  };
}
