import { FRITZ_SYSTEM_ID } from '../ranking/glicko2';

type GhostGameRow = {
  id: string;
  user_id: string;
  played_at: string;
  final_score: number;
  opponent_score: number;
  move_log: unknown;
};

type GhostProfileRow = {
  user_id: string;
  ghost_rating: number;
  last_updated: string | null;
  composite_log: GhostCompositeLog | null;
  style_profile: GhostStyleProfile | null;
  games_played: number;
};

type ProfileLookupRow = {
  id: string;
  username: string;
};

export type GhostMoveLogEntry = {
  turn: number;
  actor?: 'you' | 'ghost';
  board_state: string;
  tile_played: string | null;
  branch: string | null;
  hand_before: string[];
  score_delta: number;
};

export type GhostCompositeCandidate = {
  tilePlayed: string;
  branch: string | null;
  count: number;
  bestScoreDelta: number;
};

export type GhostCompositeState = {
  key: string;
  turn: number;
  boardState: string;
  recommendedMove: GhostCompositeCandidate;
  candidates: GhostCompositeCandidate[];
};

export type GhostCompositeLog = {
  generatedAt: string;
  sourceGameIds: string[];
  states: GhostCompositeState[];
};

export type GhostStyleProfile = {
  scoringBias: number; // 0.0 to 1.0 (0=control, 1=points)
  doublePriority: number; // 0.0 to 1.0
  branchingFrequency: number; // 0.0 to 1.0
  avgTurnPoints: number;
};

export type GhostProfileSummary = {
  ghostRating: number;
  gamesPlayed: number;
  avgScore: number | null;
  recentScores: number[];
  paddingGames: number;
  compositeLog: GhostCompositeLog | null;
  styleProfile: GhostStyleProfile | null;
};

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

function normalizeMoveLog(raw: unknown): GhostMoveLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const rec = entry as Record<string, unknown>;
      return {
        turn: Number(rec.turn ?? 0),
        actor: rec.actor === 'ghost' ? ('ghost' as const) : ('you' as const),
        board_state: String(rec.board_state ?? ''),
        tile_played: rec.tile_played == null ? null : String(rec.tile_played),
        branch: rec.branch == null ? null : String(rec.branch),
        hand_before: Array.isArray(rec.hand_before)
          ? rec.hand_before.map((item) => String(item))
          : [],
        score_delta: Number(rec.score_delta ?? 0),
      };
    })
    .filter((entry) => entry.turn > 0 && entry.board_state);
}

async function fetchGhostProfile(userId: string): Promise<GhostProfileRow | null> {
  const rows = await supabaseFetch<GhostProfileRow[]>(
    `/rest/v1/ghost_profiles?select=user_id,ghost_rating,last_updated,composite_log,style_profile,games_played` +
      `&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
    { method: 'GET' },
  );
  return rows[0] ?? null;
}

async function fetchProfileByUsername(username: string): Promise<ProfileLookupRow | null> {
  const normalized = username.trim().replace(/^@/, '').toLowerCase();
  if (!normalized) return null;
  const rows = await supabaseFetch<ProfileLookupRow[]>(
    `/rest/v1/profiles?select=id,username&username=eq.${encodeURIComponent(normalized)}&limit=1`,
    { method: 'GET' },
  );
  return rows[0] ?? null;
}

async function upsertGhostProfile(row: {
  user_id: string;
  ghost_rating: number;
  last_updated?: string | null;
  composite_log?: GhostCompositeLog | null;
  style_profile?: GhostStyleProfile | null;
  games_played: number;
}): Promise<GhostProfileRow> {
  const rows = await supabaseFetch<GhostProfileRow[]>(
    `/rest/v1/ghost_profiles?on_conflict=user_id`,
    {
      method: 'POST',
      headers: {
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify([row]),
    },
  );
  const profile = rows[0];
  if (!profile) throw new Error('Failed to upsert ghost profile.');
  return profile;
}

async function ensureGhostProfile(userId: string): Promise<GhostProfileRow> {
  const existing = await fetchGhostProfile(userId);
  if (existing) return existing;
  return await upsertGhostProfile({
    user_id: userId,
    ghost_rating: 800,
    last_updated: null,
    composite_log: null,
    style_profile: null,
    games_played: 0,
  });
}

async function fetchRecentGhostGames(userId: string, limit = 5): Promise<GhostGameRow[]> {
  return await supabaseFetch<GhostGameRow[]>(
    `/rest/v1/ghost_games?select=id,user_id,played_at,final_score,opponent_score,move_log` +
      `&user_id=eq.${encodeURIComponent(userId)}` +
      `&order=played_at.desc&limit=${Math.max(1, Math.floor(limit))}`,
    { method: 'GET' },
  );
}

function buildCompositeLog(games: GhostGameRow[]): GhostCompositeLog {
  const states = new Map<
    string,
    {
      turn: number;
      boardState: string;
      candidates: Map<string, GhostCompositeCandidate>;
    }
  >();

  for (const game of games) {
    const moveLog = normalizeMoveLog(game.move_log);
    for (const move of moveLog) {
      if (move.actor === 'ghost') continue;
      if (!move.tile_played) continue;
      const key = `${move.turn}::${move.board_state}`;
      const candidateKey = `${move.tile_played}::${move.branch ?? ''}`;
      const state = states.get(key) ?? {
        turn: move.turn,
        boardState: move.board_state,
        candidates: new Map<string, GhostCompositeCandidate>(),
      };
      const existing = state.candidates.get(candidateKey);
      if (existing) {
        existing.count += 1;
        existing.bestScoreDelta = Math.max(existing.bestScoreDelta, move.score_delta);
      } else {
        state.candidates.set(candidateKey, {
          tilePlayed: move.tile_played,
          branch: move.branch,
          count: 1,
          bestScoreDelta: move.score_delta,
        });
      }
      states.set(key, state);
    }
  }

  const compositeStates: GhostCompositeState[] = Array.from(states.entries())
    .map(([key, state]) => {
      const candidates = Array.from(state.candidates.values()).sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        if (a.bestScoreDelta !== b.bestScoreDelta) return b.bestScoreDelta - a.bestScoreDelta;
        if (a.tilePlayed !== b.tilePlayed) return a.tilePlayed.localeCompare(b.tilePlayed);
        return (a.branch ?? '').localeCompare(b.branch ?? '');
      });
      return {
        key,
        turn: state.turn,
        boardState: state.boardState,
        recommendedMove: candidates[0],
        candidates,
      };
    })
    .sort((a, b) => {
      if (a.turn !== b.turn) return a.turn - b.turn;
      return a.boardState.localeCompare(b.boardState);
    });

  return {
    generatedAt: new Date().toISOString(),
    sourceGameIds: games.map((game) => game.id),
    states: compositeStates,
  };
}

function computeAverageScore(games: GhostGameRow[]): number | null {
  if (games.length === 0) return null;
  const total = games.reduce((sum, game) => sum + Number(game.final_score ?? 0), 0);
  return Math.round((total / games.length) * 10) / 10;
}

function analyzeStyle(games: GhostGameRow[]): GhostStyleProfile | null {
  if (games.length === 0) return null;
  let totalPoints = 0;
  let moveCount = 0;
  let doublesPlayed = 0;
  let branchesOpened = 0;

  for (const game of games) {
    const moveLog = normalizeMoveLog(game.move_log);
    for (const move of moveLog) {
      if (move.actor === 'ghost') continue;
      moveCount++;
      totalPoints += move.score_delta;
      if (move.tile_played && move.tile_played.split('-')[0] === move.tile_played.split('-')[1]) {
        doublesPlayed++;
      }
      if (move.branch && move.branch !== 'main') {
        branchesOpened++;
      }
    }
  }

  if (moveCount === 0) return null;

  return {
    scoringBias: Math.min(1.0, totalPoints / (moveCount * 10)),
    doublePriority: Math.min(1.0, doublesPlayed / (moveCount * 0.25)),
    branchingFrequency: Math.min(1.0, branchesOpened / (moveCount * 0.3)),
    avgTurnPoints: totalPoints / moveCount,
  };
}

function computeRatingChange(
  playerRating: number,
  opponentRating: number,
  playerScore: number,
  opponentScore: number,
  gamesPlayed: number,
): { newRating: number; delta: number } {
  const k = gamesPlayed < 10 ? 40 : gamesPlayed < 30 ? 32 : 20;
  const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  const total = Math.max(1, playerScore + opponentScore);
  const margin = Math.abs(playerScore - opponentScore) / total;
  const marginMultiplier = Math.log(margin * 10 + 1) / Math.log(11) + 0.5;
  const actual = playerScore > opponentScore ? 1 : 0;
  const delta = Math.round(k * (actual - expected) * marginMultiplier);
  const newRating = playerRating + delta;

  return {
    newRating,
    delta,
  };
}

export function computeFritzRatingChange(
  playerRating: number,
  playerScore: number,
  opponentScore: number,
  gamesPlayed: number,
): { newRating: number; delta: number } {
  const kBase = gamesPlayed < 10 ? 40 : gamesPlayed < 30 ? 32 : 20;
  const k = Math.min(20, kBase);
  const opponentRating = 1000;
  const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  const total = Math.max(1, playerScore + opponentScore);
  const margin = Math.abs(playerScore - opponentScore) / total;
  const marginMultiplier = Math.log(margin * 10 + 1) / Math.log(11) + 0.5;
  const actual = playerScore > opponentScore ? 1 : 0;
  const delta = Math.round(k * (actual - expected) * marginMultiplier);
  return { newRating: playerRating + delta, delta };
}

export async function getGhostProfileSummary(userId: string): Promise<GhostProfileSummary> {
  const profile = await ensureGhostProfile(userId);
  const recentGames = await fetchRecentGhostGames(userId, 5);
  const styleGames = await fetchRecentGhostGames(userId, 50);
  const compositeLog =
    profile.composite_log && Array.isArray(profile.composite_log.states)
      ? profile.composite_log
      : recentGames.length > 0
        ? buildCompositeLog(recentGames)
        : null;
  const styleProfile =
    profile.style_profile && typeof profile.style_profile === 'object'
      ? profile.style_profile
      : analyzeStyle(styleGames);

  return {
    ghostRating: Number(profile.ghost_rating ?? 800),
    gamesPlayed: Number(profile.games_played ?? recentGames.length ?? 0),
    avgScore: computeAverageScore(recentGames),
    recentScores: recentGames.map((game) => Number(game.final_score ?? 0)).reverse(),
    paddingGames: Math.max(0, 5 - recentGames.length),
    compositeLog,
    styleProfile,
  };
}

export async function getGhostProfileSummaryByUsername(
  username: string,
): Promise<{ userId: string; username: string; summary: GhostProfileSummary }> {
  const profile = await fetchProfileByUsername(username);
  if (!profile) {
    throw new Error(`Ghost profile not found for @${username.trim().replace(/^@/, '')}.`);
  }
  const summary = await getGhostProfileSummary(profile.id);
  return {
    userId: profile.id,
    username: profile.username,
    summary,
  };
}

export async function completeGhostGame(params: {
  userId: string;
  finalScore: number;
  opponentScore: number;
  moveLog: GhostMoveLogEntry[];
  opponentUserId?: string | null;
}): Promise<{
  newRating: number;
  ratingDelta: number;
  playerScore: number;
  ghostScore: number;
  playerWon: boolean;
  compositeLog: GhostCompositeLog;
  styleProfile: GhostStyleProfile | null;
}> {
  const profile = await ensureGhostProfile(params.userId);
  const opponentProfile =
    params.opponentUserId && params.opponentUserId !== params.userId
      ? await fetchGhostProfile(params.opponentUserId)
      : null;

  await supabaseFetch<GhostGameRow[]>(`/rest/v1/ghost_games`, {
    method: 'POST',
    body: JSON.stringify([
      {
        user_id: params.userId,
        final_score: Math.round(params.finalScore),
        opponent_score: Math.round(params.opponentScore),
        move_log: params.moveLog,
      },
    ]),
  });

  const recentGames = await fetchRecentGhostGames(params.userId, 5);
  const styleGames = await fetchRecentGhostGames(params.userId, 50);
  const compositeLog = buildCompositeLog(recentGames);
  const styleProfile = analyzeStyle(styleGames);

  const isFritz = params.opponentUserId === FRITZ_SYSTEM_ID;
  const rating = isFritz
    ? computeFritzRatingChange(
        Number(profile.ghost_rating ?? 800),
        params.finalScore,
        params.opponentScore,
        Number(profile.games_played ?? 0),
      )
    : computeRatingChange(
        Number(profile.ghost_rating ?? 800),
        Number(opponentProfile?.ghost_rating ?? 800),
        params.finalScore,
        params.opponentScore,
        Number(profile.games_played ?? 0),
      );

  await upsertGhostProfile({
    user_id: params.userId,
    ghost_rating: rating.newRating,
    last_updated: new Date().toISOString(),
    composite_log: isFritz ? profile.composite_log : compositeLog,
    style_profile: isFritz ? profile.style_profile : styleProfile,
    games_played: Number(profile.games_played ?? 0) + 1,
  });

  return {
    newRating: rating.newRating,
    ratingDelta: rating.delta,
    playerScore: Math.round(params.finalScore),
    ghostScore: Math.round(params.opponentScore),
    playerWon: params.finalScore > params.opponentScore,
    compositeLog: isFritz ? (profile.composite_log as GhostCompositeLog) : compositeLog,
    styleProfile: isFritz ? profile.style_profile : styleProfile,
  };
}
