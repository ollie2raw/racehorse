import type { BoardState, Tile, TileOrientation } from '../types';
import { supabase } from '../lib/supabase';
import type {
  CuratedDailyPuzzle,
  CuratedDailyPuzzleRow,
  DailyPuzzleCompleteResponse,
  DailyPuzzleLeaderboardResponse,
  DailyPuzzleLeaderboardRow,
  DailyPuzzleStartResponse,
  DailyPuzzleSubmitSlotRequest,
  DailyPuzzleSubmitSlotResponse,
  DailyPuzzleTodayResponse,
  DailyPuzzleType,
} from './types';
import { getLocalDateKey, normalizeDateInputToLocalKey } from './date';

const DEFAULT_SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
const DEFAULT_SERVER_ORIGIN = 'http://localhost:3001';

const DAILY_PUZZLE_TYPE_ORDER: DailyPuzzleType[] = [
  'one_turn_high_score',
  'setup_and_strike',
  'branch_mastery',
  'reach_target',
];

function resolveServerBaseUrl(): string {
  const configured = DEFAULT_SERVER_URL.trim();
  if (configured) return configured.replace(/\/$/, '');
  if (typeof window !== 'undefined') {
    const { hostname, port } = window.location;
    if (port === '5173' || hostname === 'localhost' || hostname === '127.0.0.1') return '';
    return '';
  }
  return DEFAULT_SERVER_ORIGIN;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (!supabase) return headers;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    // no-op
  }
  return headers;
}

async function requestServerJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = {
    ...(await authHeaders()),
    ...(init?.headers ?? {}),
  };
  const response = await fetch(`${resolveServerBaseUrl()}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });
  const text = await response.text().catch(() => '');
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      if (!response.ok) {
        throw new Error(
          text.startsWith('<!DOCTYPE') || text.startsWith('<html')
            ? `Daily Puzzle backend returned HTML for ${path}. Check production API routing / VITE_SERVER_URL.`
            : `${path} failed with ${response.status}`,
        );
      }
      throw new Error(`Invalid JSON response from ${path}`);
    }
  }
  if (!response.ok) {
    throw new Error(parsed?.error ?? `${path} failed with ${response.status}`);
  }
  return parsed as T;
}

function isTile(value: unknown): value is Tile {
  if (!value || typeof value !== 'object') return false;
  const v = value as { low?: unknown; high?: unknown };
  return Number.isInteger(v.low) && Number.isInteger(v.high);
}

function normalizeTile(value: unknown): Tile | null {
  if (Array.isArray(value) && value.length === 2) {
    const a = Number(value[0]);
    const b = Number(value[1]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return null;
    return { low: Math.min(a, b), high: Math.max(a, b) };
  }

  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  const lowRaw = rec.low ?? rec.left;
  const highRaw = rec.high ?? rec.right;
  const low = Number(lowRaw);
  const high = Number(highRaw);
  if (!Number.isInteger(low) || !Number.isInteger(high)) return null;
  return { low: Math.min(low, high), high: Math.max(low, high) };
}

function normalizeOrientation(
  value: unknown,
  fallback: 'horizontal-normal' | 'vertical-normal',
): TileOrientation {
  if (
    value === 'horizontal-normal' ||
    value === 'horizontal-flipped' ||
    value === 'vertical-normal' ||
    value === 'vertical-flipped'
  ) {
    return value;
  }
  return fallback;
}

function normalizePlacement(
  value: unknown,
  defaultOrientation: 'horizontal-normal' | 'vertical-normal',
): { tile: Tile; orientation: TileOrientation } | null {
  if (!value || typeof value !== 'object') {
    const directTile = normalizeTile(value);
    return directTile
      ? { tile: directTile, orientation: defaultOrientation }
      : null;
  }

  const rec = value as Record<string, unknown>;
  const tile = normalizeTile(rec.tile ?? rec);
  if (!tile) return null;
  return {
    tile,
    orientation: normalizeOrientation(rec.orientation, defaultOrientation),
  };
}

function endpointFromPlacement(placement: { tile: Tile; orientation: TileOrientation }, side: 'left' | 'right'): number {
  const { tile, orientation } = placement;
  if (tile.low === tile.high) return tile.high;
  if (orientation.endsWith('flipped')) {
    return side === 'left' ? tile.high : tile.low;
  }
  return side === 'left' ? tile.low : tile.high;
}

function isBoardState(value: unknown): value is BoardState {
  if (!value || typeof value !== 'object') return false;
  const board = value as BoardState;

  const placementsValid =
    Array.isArray(board.mainLine) &&
    board.mainLine.every(
      (placement) =>
        Boolean(placement) && isTile(placement.tile) && typeof placement.orientation === 'string',
    );
  const hubsValid =
    Array.isArray(board.hubDoubles) &&
    board.hubDoubles.every(
      (hub) =>
        Array.isArray(hub.branches) &&
        hub.branches.every(
          (branch) =>
            !branch ||
            (Array.isArray(branch.tiles) &&
              branch.tiles.every(
                (placement) =>
                  Boolean(placement) &&
                  isTile(placement.tile) &&
                  typeof placement.orientation === 'string',
              )),
        ),
    );

  return (
    placementsValid &&
    typeof board.leftEnd === 'number' &&
    typeof board.rightEnd === 'number' &&
    typeof board.leftEndIsDouble === 'boolean' &&
    typeof board.rightEndIsDouble === 'boolean' &&
    hubsValid
  );
}

export function normalizeBoardState(raw: unknown): BoardState | null {
  if (typeof raw === 'string') {
    try {
      return normalizeBoardState(JSON.parse(raw));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const board = raw as Record<string, unknown>;
  const mainLineRaw = Array.isArray(board.mainLine)
    ? board.mainLine
    : Array.isArray(board.main_line)
      ? board.main_line
      : null;

  if (!mainLineRaw) {
    return null;
  }

  const mainLine = mainLineRaw.map((placement) =>
    normalizePlacement(placement, 'horizontal-normal'),
  );
  if (mainLine.some((placement) => !placement) || mainLine.length === 0) return null;

  const hubDoublesRaw = Array.isArray(board.hubDoubles)
    ? board.hubDoubles
    : Array.isArray(board.hub_doubles)
      ? board.hub_doubles
      : [];
  const hubDoubles = hubDoublesRaw.map((hubRaw, hubIdx) => {
    if (!hubRaw || typeof hubRaw !== 'object') return null;
    const hub = hubRaw as Record<string, unknown>;
    const hubValueFallback = mainLine[0]?.tile.high ?? 0;
    const branchesRaw = Array.isArray(hub.branches) ? hub.branches : [];

    const branches = branchesRaw.map((branchRaw) => {
      if (!branchRaw || typeof branchRaw !== 'object') return null;
      const branch = branchRaw as Record<string, unknown>;
      const tilesRaw = Array.isArray(branch.tiles) ? branch.tiles : [];
      const tiles = tilesRaw
        .map((placement) => normalizePlacement(placement, 'vertical-normal'))
        .filter((placement): placement is { tile: Tile; orientation: TileOrientation } =>
          Boolean(placement),
        );
      const last = tiles[tiles.length - 1] ?? null;
      return {
        ...branch,
        openEnd:
          typeof branch.openEnd === 'number'
            ? branch.openEnd
            : last
              ? endpointFromPlacement(last, 'right')
              : typeof hub.hubValue === 'number'
                ? hub.hubValue
                : hubValueFallback,
        openEndIsDouble:
          typeof branch.openEndIsDouble === 'boolean'
            ? branch.openEndIsDouble
            : Boolean(last && last.tile.low === last.tile.high),
        tiles,
      };
    });
    return {
      ...hub,
      tileIndex: Number.isInteger(hub.tileIndex) ? Number(hub.tileIndex) : hubIdx,
      hubValue: typeof hub.hubValue === 'number' ? hub.hubValue : hubValueFallback,
      isCrossed: typeof hub.isCrossed === 'boolean' ? hub.isCrossed : branches.length > 0,
      branches: branches as BoardState['hubDoubles'][number]['branches'],
    } as BoardState['hubDoubles'][number];
  });

  if (hubDoubles.some((hub) => !hub)) return null;
  const firstPlacement = mainLine[0] as { tile: Tile; orientation: TileOrientation };
  const lastPlacement = mainLine[mainLine.length - 1] as { tile: Tile; orientation: TileOrientation };
  const leftEnd = typeof board.leftEnd === 'number' ? board.leftEnd : endpointFromPlacement(firstPlacement, 'left');
  const rightEnd =
    typeof board.rightEnd === 'number' ? board.rightEnd : endpointFromPlacement(lastPlacement, 'right');
  const leftEndIsDouble =
    typeof board.leftEndIsDouble === 'boolean'
      ? board.leftEndIsDouble
      : firstPlacement.tile.low === firstPlacement.tile.high;
  const rightEndIsDouble =
    typeof board.rightEndIsDouble === 'boolean'
      ? board.rightEndIsDouble
      : lastPlacement.tile.low === lastPlacement.tile.high;

  const normalized: BoardState = {
    mainLine: mainLine as BoardState['mainLine'],
    leftEnd,
    rightEnd,
    leftEndIsDouble,
    rightEndIsDouble,
    hubDoubles: hubDoubles as BoardState['hubDoubles'],
  };

  return isBoardState(normalized) ? normalized : null;
}

function coercePuzzleRow(row: CuratedDailyPuzzleRow): CuratedDailyPuzzle {
  const board = normalizeBoardState(row.starting_board);
  if (!board) {
    throw new Error(
      'Invalid puzzle: starting_board must include valid placements (tile {low,high} + orientation) in mainLine and hub branches.',
    );
  }

  if (!Array.isArray(row.starting_hand) || !row.starting_hand.every(isTile)) {
    throw new Error('Invalid puzzle: starting_hand must be an array of tiles.');
  }

  if (board.mainLine.some((placement) => !placement?.tile || !isTile(placement.tile))) {
    throw new Error('Invalid puzzle: every mainLine placement must include tile {low,high}.');
  }

  const puzzleTypeRaw = row.puzzle_type;
  const puzzleType: DailyPuzzleType =
    puzzleTypeRaw === 'reach_target' ||
    puzzleTypeRaw === 'one_turn_high_score' ||
    puzzleTypeRaw === 'setup_and_strike' ||
    puzzleTypeRaw === 'branch_mastery'
      ? puzzleTypeRaw
      : 'one_turn_high_score';
  const dealSize =
    typeof row.deal_size === 'number' && Number.isFinite(row.deal_size) ? row.deal_size : 7;

  return {
    id: row.id,
    puzzleDate: row.puzzle_date,
    title: row.title?.trim() || 'Daily Puzzle',
    startingBoard: board,
    startingHand: row.starting_hand,
    maxMoves: row.max_moves,
    targetScore: row.target_score,
    puzzleType,
    dealSize,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(
      () => reject(new Error(`Request timed out after ${timeoutMs}ms. Try again.`)),
      timeoutMs,
    );
    promise
      .then((value) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
}

export async function getDailyPuzzleForDate(
  date: Date,
  puzzleType: DailyPuzzleType = 'one_turn_high_score',
): Promise<CuratedDailyPuzzle | null> {
  if (!supabase) return null;

  const seed = getLocalDateKey(date);
  const t0 = performance.now();
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from('daily_puzzles')
        .select(
          'id, puzzle_date, title, starting_board, starting_hand, max_moves, target_score, puzzle_type, deal_size, created_at',
        )
        .eq('puzzle_date', seed)
        .eq('puzzle_type', puzzleType)
        .maybeSingle(),
    ),
    8000,
  );
  const ms = Math.round(performance.now() - t0);
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.debug('[DailyPuzzle] select finished', { ms, seed, error, hasData: Boolean(data) });
  }

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;
  return coercePuzzleRow(data as CuratedDailyPuzzleRow);
}

export async function getAllDailyPuzzlesForDate(date: Date): Promise<CuratedDailyPuzzle[]> {
  if (!supabase) return [];

  const seed = getLocalDateKey(date);
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from('daily_puzzles')
        .select(
          'id, puzzle_date, title, starting_board, starting_hand, max_moves, target_score, puzzle_type, deal_size, created_at',
        )
        .eq('puzzle_date', seed),
    ),
    8000,
  );

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return [];

  return (data as CuratedDailyPuzzleRow[])
    .map(coercePuzzleRow)
    .sort(
      (a, b) =>
        DAILY_PUZZLE_TYPE_ORDER.indexOf(a.puzzleType) -
        DAILY_PUZZLE_TYPE_ORDER.indexOf(b.puzzleType),
    );
}

export async function getDailyPuzzleByDateSeed(
  dateSeed: string,
  puzzleType: DailyPuzzleType = 'one_turn_high_score',
): Promise<CuratedDailyPuzzle | null> {
  if (!supabase) return null;

  const canonicalDate = normalizeDateInputToLocalKey(dateSeed);
  const t0 = performance.now();
  const { data, error } = await withTimeout(
    (async () =>
      await supabase
        .from('daily_puzzles')
        .select(
          'id, puzzle_date, title, starting_board, starting_hand, max_moves, target_score, puzzle_type, deal_size, created_at',
        )
        .eq('puzzle_date', canonicalDate)
        .eq('puzzle_type', puzzleType)
        .maybeSingle())(),
    8000,
  );
  const ms = Math.round(performance.now() - t0);
  // eslint-disable-next-line no-console
  console.log('[DailyPuzzleAdmin] select finished', {
    ms,
    canonicalDate,
    error,
    hasData: Boolean(data),
  });

  if (error) {
    throw new Error(error.message);
  }

  if (!data) return null;
  return coercePuzzleRow(data as CuratedDailyPuzzleRow);
}

export interface UpsertPuzzleInput {
  puzzleDate: string;
  title: string;
  startingBoard: BoardState;
  startingHand: Tile[];
  maxMoves: number;
  targetScore: number;
  puzzleType: DailyPuzzleType;
  dealSize: number;
}

export async function upsertDailyPuzzle(input: UpsertPuzzleInput): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const canonicalDate = normalizeDateInputToLocalKey(input.puzzleDate);
  const t0 = performance.now();
  const { error } = await withTimeout(
    (async () =>
      await supabase.from('daily_puzzles').upsert(
        {
          puzzle_date: canonicalDate,
          title: input.title,
          starting_board: input.startingBoard,
          starting_hand: input.startingHand,
          max_moves: input.maxMoves,
          target_score: input.targetScore,
          puzzle_type: input.puzzleType,
          deal_size: input.dealSize,
        },
        { onConflict: 'puzzle_date,puzzle_type' },
      ))(),
    20000,
  );
  const ms = Math.round(performance.now() - t0);
  // eslint-disable-next-line no-console
  console.log('[DailyPuzzleAdmin] upsert finished', { ms, canonicalDate, error });

  if (error) {
    throw new Error(error.message);
  }
}

export interface UpsertDailyPuzzleBestScoreInput {
  puzzleDate: string;
  userId: string;
  username: string;
  score: number;
  movesUsed: number;
  seconds?: number;
}

export interface UpsertDailyPuzzleCompletionInput {
  puzzleDate: string;
  userId: string;
  username: string;
  score: number;
  bestPossibleScore: number;
  perfect: boolean;
  currentStreak: number;
}

export interface DailyPuzzleLeaderboardEntry {
  userId: string;
  username: string;
  bestScore: number;
  bestMovesUsed: number;
  bestSeconds: number;
  updatedAt: string;
}

function sanitizeLeaderboardUsername(storedUsername: string | null | undefined): string {
  const storedName = (storedUsername ?? '').trim();
  if (storedName && !/^user_[a-f0-9]{8}$/i.test(storedName)) return storedName;

  return 'Player';
}

export async function upsertDailyPuzzleBestScore(
  input: UpsertDailyPuzzleBestScoreInput,
): Promise<void> {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const canonicalDate = normalizeDateInputToLocalKey(input.puzzleDate);
  const nextSeconds = Math.max(0, Math.floor(input.seconds ?? 0));
  const { data: existing, error: selectError } = await withTimeout(
    Promise.resolve(
      supabase
        .from('daily_puzzle_scores')
        .select('best_score, best_moves_used, best_seconds')
        .eq('puzzle_date', canonicalDate)
        .eq('user_id', input.userId)
        .maybeSingle(),
    ),
  );

  if (selectError) {
    throw new Error(selectError.message);
  }

  if (!existing) {
    const { error: insertError } = await withTimeout(
      Promise.resolve(
        supabase.from('daily_puzzle_scores').insert({
          puzzle_date: canonicalDate,
          user_id: input.userId,
          username: input.username,

          // legacy columns (keep compatible)
          score: input.score,
          moves_used: input.movesUsed,

          best_score: input.score,
          best_moves_used: input.movesUsed,
          best_seconds: nextSeconds,
          updated_at: new Date().toISOString(),
        }),
      ),
    );
    if (insertError) {
      throw new Error(insertError.message);
    }
    return;
  }

  const currentBestScore = Number(existing.best_score ?? 0);
  const currentBestMoves = Number(existing.best_moves_used ?? Number.MAX_SAFE_INTEGER);
  const currentBestSeconds = Number(existing.best_seconds ?? Number.MAX_SAFE_INTEGER);

  const shouldUpdate =
    input.score > currentBestScore ||
    (input.score === currentBestScore && input.movesUsed < currentBestMoves) ||
    (input.score === currentBestScore &&
      input.movesUsed === currentBestMoves &&
      nextSeconds < currentBestSeconds);

  if (!shouldUpdate) return;

  const { error: updateError } = await withTimeout(
    Promise.resolve(
      supabase
        .from('daily_puzzle_scores')
        .update({
          // legacy columns (keep compatible)
          score: input.score,
          moves_used: input.movesUsed,

          best_score: input.score,
          best_moves_used: input.movesUsed,
          best_seconds: nextSeconds,
          username: input.username,
          updated_at: new Date().toISOString(),
        })
        .eq('puzzle_date', canonicalDate)
        .eq('user_id', input.userId),
    ),
  );

  if (updateError) {
    throw new Error(updateError.message);
  }
}

export async function fetchDailyPuzzleLeaderboard(
  puzzleDate: string,
  limit = 25,
): Promise<DailyPuzzleLeaderboardEntry[]> {
  if (!supabase) return [];

  const canonicalDate = normalizeDateInputToLocalKey(puzzleDate);
  const { data, error } = await withTimeout(
    Promise.resolve(
      supabase
        .from('daily_puzzle_scores')
        .select('user_id, username, best_score, best_moves_used, best_seconds, updated_at')
        .eq('puzzle_date', canonicalDate)
        .order('best_score', { ascending: false })
        .order('best_moves_used', { ascending: true })
        .order('best_seconds', { ascending: true })
        .order('updated_at', { ascending: true })
        .limit(limit),
    ),
  );

  if (error) {
    if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.error('[DailyPuzzleLeaderboard] fetch error', error);
    }
    throw new Error(error.message);
  }

  if (!data) return [];
  return data.map((row) => {
    const storedUsername = row.username as string | null;
    return {
      userId: row.user_id as string,
      username: sanitizeLeaderboardUsername(storedUsername),
      bestScore: Number(row.best_score ?? 0),
      bestMovesUsed: Number(row.best_moves_used ?? 0),
      bestSeconds: Number(row.best_seconds ?? 0),
      updatedAt: row.updated_at as string,
    };
  });
}

export async function upsertDailyPuzzleCompletion(
  input: UpsertDailyPuzzleCompletionInput,
): Promise<void> {
  if (!supabase) return;

  const canonicalDate = normalizeDateInputToLocalKey(input.puzzleDate);
  const { error } = await withTimeout(
    Promise.resolve(
      supabase.from('daily_puzzle_completions').upsert(
        {
          puzzle_date: canonicalDate,
          user_id: input.userId,
          username: input.username,
          score: input.score,
          best_possible_score: input.bestPossibleScore,
          perfect: input.perfect,
          current_streak: input.currentStreak,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'puzzle_date,user_id' },
      ),
    ),
  );

  if (error) {
    throw new Error(error.message);
  }
}

export async function getTodayDailyPuzzleLadder(): Promise<DailyPuzzleTodayResponse> {
  return requestServerJson<DailyPuzzleTodayResponse>('/api/daily-puzzle/today', {
    method: 'GET',
  });
}

export async function startDailyPuzzleLadder(runDate?: string): Promise<DailyPuzzleStartResponse> {
  return requestServerJson<DailyPuzzleStartResponse>('/api/daily-puzzle/start', {
    method: 'POST',
    body: JSON.stringify(runDate ? { runDate } : {}),
  });
}

export async function submitDailyPuzzleSlot(
  input: DailyPuzzleSubmitSlotRequest,
): Promise<DailyPuzzleSubmitSlotResponse> {
  return requestServerJson<DailyPuzzleSubmitSlotResponse>('/api/daily-puzzle/submit-slot', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function completeDailyPuzzleLadder(input: {
  attemptId: string;
  puzzleDate: string;
}): Promise<DailyPuzzleCompleteResponse> {
  return requestServerJson<DailyPuzzleCompleteResponse>('/api/daily-puzzle/complete', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function fetchDailyPuzzleLadderLeaderboard(
  date: string,
): Promise<DailyPuzzleLeaderboardRow[]> {
  const response = await requestServerJson<DailyPuzzleLeaderboardResponse>(
    `/api/daily-puzzle/leaderboard?date=${encodeURIComponent(normalizeDateInputToLocalKey(date))}`,
    { method: 'GET' },
  );
  return response.rows;
}

export { getLocalDateKey, normalizeDateInputToLocalKey };
