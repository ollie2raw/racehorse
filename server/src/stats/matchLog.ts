import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type MatchLogSide = {
  seatId: string;
  userId: string | null;
  username: string;
};

export type MatchLogEntry = {
  id: string;
  endedAtMs: number;
  roomCode: string;
  tournamentId?: string;
  tournamentMatchId?: string;
  a: MatchLogSide;
  b: MatchLogSide;
  scoreA: number;
  scoreB: number;
  winnerSeatId: string;
  pointDiff: number;
  maxDeficitWinner?: number;
};

function normalizeMatchLogSide(raw: unknown): MatchLogSide {
  const side = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const seatId =
    typeof side.seatId === 'string'
      ? side.seatId
      : typeof side.socketId === 'string'
        ? side.socketId
        : '';
  return {
    seatId,
    userId: typeof side.userId === 'string' ? side.userId : null,
    username: typeof side.username === 'string' ? side.username : 'Guest',
  };
}

function normalizeMatchLogEntry(raw: unknown): MatchLogEntry {
  const entry = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const winnerSeatId =
    typeof entry.winnerSeatId === 'string'
      ? entry.winnerSeatId
      : typeof entry.winnerSocketId === 'string'
        ? entry.winnerSocketId
        : '';
  return {
    id: typeof entry.id === 'string' ? entry.id : randomUUID(),
    endedAtMs: typeof entry.endedAtMs === 'number' ? entry.endedAtMs : 0,
    roomCode: typeof entry.roomCode === 'string' ? entry.roomCode : '',
    tournamentId: typeof entry.tournamentId === 'string' ? entry.tournamentId : undefined,
    tournamentMatchId:
      typeof entry.tournamentMatchId === 'string' ? entry.tournamentMatchId : undefined,
    a: normalizeMatchLogSide(entry.a),
    b: normalizeMatchLogSide(entry.b),
    scoreA: typeof entry.scoreA === 'number' ? entry.scoreA : 0,
    scoreB: typeof entry.scoreB === 'number' ? entry.scoreB : 0,
    winnerSeatId,
    pointDiff: typeof entry.pointDiff === 'number' ? entry.pointDiff : 0,
    maxDeficitWinner:
      typeof entry.maxDeficitWinner === 'number' ? entry.maxDeficitWinner : undefined,
  };
}

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE_PATH = path.join(DATA_DIR, 'matches.jsonl');
const WEEKLY_AWARDS_CACHE_MS = 60_000;

let weeklyAwardsCache:
  | {
      weekKey: string;
      expiresAtMs: number;
      value: WeeklyAwards;
    }
  | null = null;

async function ensureDir(): Promise<void> {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });
}

export async function appendMatch(
  entry: Omit<MatchLogEntry, 'id'> & { id?: string },
): Promise<MatchLogEntry> {
  await ensureDir();
  const full: MatchLogEntry = {
    id: entry.id ?? randomUUID(),
    ...entry,
  };
  await fs.promises.appendFile(FILE_PATH, JSON.stringify(full) + '\n', 'utf8');
  weeklyAwardsCache = null;
  return full;
}

export async function readMatches(): Promise<MatchLogEntry[]> {
  try {
    const raw = (await fs.promises.readFile(FILE_PATH, 'utf8')).trim();
    if (!raw) return [];
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => normalizeMatchLogEntry(JSON.parse(line)));
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

export async function computeWeeklyAwards(nowMs: number): Promise<WeeklyAwards> {
  const { startMs, endMs } = getWeekWindowMs(nowMs);
  const weekKey = `${startMs}-${endMs}`;
  if (
    weeklyAwardsCache &&
    weeklyAwardsCache.weekKey === weekKey &&
    nowMs < weeklyAwardsCache.expiresAtMs
  ) {
    return weeklyAwardsCache.value;
  }

  const matches = (await readMatches()).filter((m) => m.endedAtMs >= startMs && m.endedAtMs < endMs);

  const iso = (ms: number) => new Date(ms).toISOString();
  const weekStartISO = iso(startMs);
  const weekEndISO = iso(endMs);

  type Key = string; // userId preferred, fallback to seatId
  const keyOf = (m: MatchLogEntry, side: 'a' | 'b'): Key =>
    (m[side].userId ?? '') ? `u:${m[side].userId}` : `s:${m[side].seatId}`;
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

    const winnerSide = m.winnerSeatId === m.a.seatId ? 'a' : 'b';
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
      const won =
        (side === 'a' && m.winnerSeatId === m.a.seatId) ||
        (side === 'b' && m.winnerSeatId === m.b.seatId);
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

  const result: WeeklyAwards = {
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
  weeklyAwardsCache = {
    weekKey,
    expiresAtMs: nowMs + WEEKLY_AWARDS_CACHE_MS,
    value: result,
  };
  return result;
}
