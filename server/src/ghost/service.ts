import { childLogger } from '../logger';
import { FRITZ_ELITE_ID, isFritzId } from '../ranking/glicko2';
import { processRatingPeriod } from '../ranking/periodService';
import { buildRankedGameInsertPayload } from '../ranking/rankedGamePayload';
import { getLegalMoves } from '../game/engine';
import { computePlayScore, getOpenEnds, simulatePlacement } from '../game/scoring';
import { parseBranchPosition } from '../game/types';
import type { BoardState, GameState, PlacementPosition, Tile, TileOrientation } from '../game/types';

const log = childLogger('ghost');

type GhostGameRow = {
  id: string;
  user_id: string;
  played_at: string;
  final_score: number;
  opponent_score: number;
  move_log: unknown;
  match_id: string | null;
  // xmax is a Postgres system column returned when explicitly selected.
  // '0' = freshly inserted row; non-zero = row was updated (conflict resolution).
  xmax?: string;
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

type RankingProfileRow = {
  id: string;
  glicko_rating: number;
  glicko_rd: number;
};

export type GhostMoveLogEntry = {
  turn: number;
  hand_number?: number;
  actor?: 'you' | 'ghost';
  board_state: string;
  tile_played: string | null;
  branch: string | null;
  hand_before: string[];
  score_delta: number;
  forced_draw?: boolean;
  /** Tile drawn on branch `draw`; used to reconstruct hand continuity in verifyPlayerMoveLog. */
  drawn_tile?: string | null;
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

export type GhostGameStyleSnapshot = {
  gameId: string;
  playedAt: string;
  scoringBias: number;
  doublePriority: number;
  branchingFrequency: number;
  spinnerControl: number;
  avgTurnPoints: number;
  drawPriority: number;
  pointSuppression: number;
  handSize: number;
  attackSetup: number;
  consistency: number;
};

export type GhostCompositeLog = {
  generatedAt: string;
  sourceGameIds: string[];
  states: GhostCompositeState[];
  recentGameStyles: GhostGameStyleSnapshot[];
};

export type GhostStyleProfile = {
  scoringBias: number; // 0.0 to 1.0 (0=control, 1=points)
  doublePriority: number; // 0.0 to 1.0
  branchingFrequency: number; // 0.0 to 1.0
  spinnerControl: number; // 0.0 to 1.0
  avgTurnPoints: number;
  drawPriority: number;
  pointSuppression: number;
  handSize: number;
  attackSetup: number;
  consistency: number;
  confidence: number;
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
        hand_number:
          rec.hand_number == null || !Number.isFinite(Number(rec.hand_number))
            ? undefined
            : Number(rec.hand_number),
        actor: rec.actor === 'ghost' ? ('ghost' as const) : ('you' as const),
        board_state: String(rec.board_state ?? ''),
        tile_played: rec.tile_played == null ? null : String(rec.tile_played),
        branch: rec.branch == null ? null : String(rec.branch),
        hand_before: Array.isArray(rec.hand_before)
          ? rec.hand_before.map((item) => String(item))
          : [],
        score_delta: Number(rec.score_delta ?? 0),
        forced_draw: Boolean(rec.forced_draw),
        drawn_tile: rec.drawn_tile == null ? null : String(rec.drawn_tile),
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

async function insertGhostGameRow(params: {
  userId: string;
  finalScore: number;
  opponentScore: number;
  trainingMoveLog: GhostMoveLogEntry[];
  matchId?: string | null;
}): Promise<{ isNewGame: boolean }> {
  const baseRow = {
    user_id: params.userId,
    final_score: Math.round(params.finalScore),
    opponent_score: Math.round(params.opponentScore),
    move_log: params.trainingMoveLog,
  };

  if (params.matchId) {
    try {
      const upsertedRows = await supabaseFetch<GhostGameRow[]>(
        `/rest/v1/ghost_games?on_conflict=match_id&select=id,xmax`,
        {
          method: 'POST',
          headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
          body: JSON.stringify([{ ...baseRow, match_id: params.matchId }]),
        },
      );
      return { isNewGame: upsertedRows[0]?.xmax === '0' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missingMatchIdColumn =
        message.includes('PGRST204') ||
        message.includes("match_id") ||
        message.includes('schema cache');
      if (!missingMatchIdColumn) throw error;
      log.warn('[ghost] ghost_games missing match_id column; falling back to plain insert');
    }
  }

  await supabaseFetch(`/rest/v1/ghost_games`, {
    method: 'POST',
    body: JSON.stringify([baseRow]),
  });
  return { isNewGame: true };
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

export function parseTileKey(value: string | null | undefined): Tile | null {
  if (!value) return null;
  const normalized = String(value).replace('-', '|');
  const [aRaw, bRaw] = normalized.split('|');
  const a = Number(aRaw);
  const b = Number(bRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { low: Math.min(a, b), high: Math.max(a, b) };
}

export function parseGhostBoardState(value: string): BoardState | null {
  if (!value || value === 'board:empty') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const mainLineRaw = Array.isArray(rec.mainLine) ? rec.mainLine : [];
  const hubsRaw = Array.isArray(rec.hubs) ? rec.hubs : [];
  const parseOrientation = (
    orientation: unknown,
    fallback: TileOrientation,
  ): TileOrientation => {
    return orientation === 'horizontal-normal' ||
      orientation === 'horizontal-flipped' ||
      orientation === 'vertical-normal' ||
      orientation === 'vertical-flipped'
      ? orientation
      : fallback;
  };

  const parseLaneType = (value: unknown): 'mainline' | 'branch' | undefined => {
    return value === 'mainline' || value === 'branch' ? value : undefined;
  };

  return {
    mainLine: mainLineRaw
      .map((placed) => {
        if (!placed || typeof placed !== 'object') return null;
        const placedRec = placed as Record<string, unknown>;
        const tile = Array.isArray(placedRec.tile)
          ? parseTileKey(`${placedRec.tile[0]}|${placedRec.tile[1]}`)
          : null;
        if (!tile) return null;
        return {
          tile,
          orientation: parseOrientation(placedRec.orientation, 'horizontal-normal'),
        };
      })
      .filter((placed): placed is NonNullable<typeof placed> => Boolean(placed)),
    leftEnd: Number(rec.leftEnd ?? 0),
    rightEnd: Number(rec.rightEnd ?? 0),
    leftEndIsDouble: Boolean(rec.leftEndIsDouble),
    rightEndIsDouble: Boolean(rec.rightEndIsDouble),
    hubDoubles: hubsRaw
      .map((hub, hubIndex) => {
        if (!hub || typeof hub !== 'object') return null;
        const hubRec = hub as Record<string, unknown>;
        const branchesRaw = Array.isArray(hubRec.branches) ? hubRec.branches : [];
        return {
          hubId:
            hubRec.hubId == null || !Number.isFinite(Number(hubRec.hubId))
              ? hubIndex
              : Number(hubRec.hubId),
          laneType: parseLaneType(hubRec.laneType),
          laneRef: hubRec.laneRef == null ? undefined : String(hubRec.laneRef),
          branchDepth:
            hubRec.branchDepth == null || !Number.isFinite(Number(hubRec.branchDepth))
              ? undefined
              : Number(hubRec.branchDepth),
          tileIndex: Number(hubRec.tileIndex ?? hubIndex),
          mainlineIndex:
            hubRec.mainlineIndex == null || !Number.isFinite(Number(hubRec.mainlineIndex))
              ? undefined
              : Number(hubRec.mainlineIndex),
          hubValue: Number(hubRec.hubValue ?? 0),
          leftSideFilled: Boolean(hubRec.leftSideFilled),
          rightSideFilled: Boolean(hubRec.rightSideFilled),
          isCrossed: Boolean(hubRec.isCrossed),
          branches: branchesRaw.map((branch) => {
            if (!branch || typeof branch !== 'object') return null;
            const branchRec = branch as Record<string, unknown>;
            const tilesRaw = Array.isArray(branchRec.tiles) ? branchRec.tiles : [];
            return {
              openEnd: Number(branchRec.openEnd ?? 0),
              openEndIsDouble: Boolean(branchRec.openEndIsDouble),
              tiles: tilesRaw
                .map((placed) => {
                  if (!placed || typeof placed !== 'object') return null;
                  const placedRec = placed as Record<string, unknown>;
                  const tile = Array.isArray(placedRec.tile)
                    ? parseTileKey(`${placedRec.tile[0]}|${placedRec.tile[1]}`)
                    : null;
                  if (!tile) return null;
                  return {
                    tile,
                    orientation: parseOrientation(placedRec.orientation, 'vertical-normal'),
                  };
                })
                .filter((placed): placed is NonNullable<typeof placed> => Boolean(placed)),
            };
          }) as unknown as BoardState['hubDoubles'][number]['branches'],
        };
      })
      .filter((hub): hub is NonNullable<typeof hub> => Boolean(hub)),
  };
}

export function buildAnalysisState(board: BoardState | null, hand: Tile[]): GameState {
  return {
    config: {
      maxPips: 6,
      tilesPerPlayer: 7,
      deadTileCount: 2,
      scoringMultiple: 5,
      blockedHandRule: 'lowestPips',
      endHandBonus: 'sumOpponentPenalties',
      winningScore: 60,
    },
    playerIds: ['you', 'opp'],
    players: {
      you: { id: 'you', hand, score: 0 },
      opp: { id: 'opp', hand: [], score: 0 },
    },
    board,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: board !== null,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function averageMetric(values: number[]): number {
  if (values.length === 0) return 0;
  return roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function weightedAverageMetric(
  values: number[],
  weights: number[],
): number {
  if (values.length === 0 || weights.length === 0) return 0;
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return 0;
  const weightedSum = values.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0);
  return roundMetric(weightedSum / totalWeight);
}

function variance(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / values.length;
}

function tileMatchesValue(tile: Tile, pipValue: number): boolean {
  return tile.low === pipValue || tile.high === pipValue;
}

function tileMatchesTile(a: Tile, b: Tile): boolean {
  return a.low === b.low && a.high === b.high;
}

function countMatchingValueAfterPlay(hand: Tile[], tileToPlay: Tile, pipValue: number): number {
  let removed = false;
  let count = 0;

  for (const tile of hand) {
    if (!removed && tileMatchesTile(tile, tileToPlay)) {
      removed = true;
      continue;
    }
    if (tileMatchesValue(tile, pipValue)) {
      count += 1;
    }
  }

  return count;
}

function isNewSpinnerBranchOpportunity(
  board: BoardState | null,
  hand: Tile[],
  move: { tile: Tile; position: PlacementPosition },
): boolean {
  if (!board) return false;
  const branchPos = parseBranchPosition(move.position);
  if (!branchPos) return false;

  const hubIndex = board.hubDoubles.findIndex((hub, idx) => (hub.hubId ?? idx) === branchPos.hubIndex);
  const hub = hubIndex >= 0 ? board.hubDoubles[hubIndex] : null;
  if (!hub || !hub.isCrossed || hub.branches[branchPos.armIndex]) return false;

  const remainingMatches = countMatchingValueAfterPlay(hand, move.tile, hub.hubValue);
  return remainingMatches <= 1;
}

function analyzeGameStyle(game: GhostGameRow): GhostGameStyleSnapshot | null {
  const moveLog = normalizeMoveLog(game.move_log);
  if (moveLog.length === 0) return null;

  let totalPoints = 0;
  let playCount = 0;
  let doublesPlayed = 0;
  let branchesOpened = 0;
  let forcedDrawPlays = 0;
  let scoringWithoutDraw = 0;
  let scoringOpportunities = 0;
  let suppressedScoringOpportunities = 0;
  let spinnerControlOpportunities = 0;
  let spinnerControlDecisions = 0;
  let totalHandSize = 0;
  let attackIncreases = 0;
  let attackClosures = 0;
  const handScores = new Map<number, number>();

  for (const move of moveLog) {
    if (move.actor === 'ghost') continue;
    if (!move.tile_played || move.branch === 'draw' || move.branch === 'pass') continue;

    const tile = parseTileKey(move.tile_played);
    const board = parseGhostBoardState(move.board_state);
    const hand = move.hand_before.map((entry) => parseTileKey(entry)).filter((entry): entry is Tile => Boolean(entry));
    if (!tile) continue;

    playCount += 1;
    totalPoints += move.score_delta;
    totalHandSize += hand.length;
    if (tile.low === tile.high) doublesPlayed += 1;
    if (move.branch && move.branch !== 'left' && move.branch !== 'right' && move.branch !== 'main') {
      branchesOpened += 1;
    }
    if (move.forced_draw) {
      forcedDrawPlays += 1;
    } else if (move.score_delta > 0) {
      scoringWithoutDraw += 1;
    }

    const handNumber = Number.isFinite(move.hand_number) ? Number(move.hand_number) : move.turn;
    handScores.set(handNumber, (handScores.get(handNumber) ?? 0) + move.score_delta);

    const state = buildAnalysisState(board, hand);
    const legalMoves = getLegalMoves(state, 'you').filter(
      (candidate): candidate is { type: 'play'; tile: Tile; position: PlacementPosition } =>
        candidate.type === 'play',
    );
    const riskySpinnerBranchMoves = legalMoves.filter((candidate) =>
      isNewSpinnerBranchOpportunity(board, hand, candidate),
    );
    if (riskySpinnerBranchMoves.length > 0) {
      spinnerControlOpportunities += 1;
      const choseRiskySpinnerBranch = riskySpinnerBranchMoves.some(
        (candidate) =>
          tileMatchesTile(candidate.tile, tile) && candidate.position === (move.branch ?? 'left'),
      );
      if (!choseRiskySpinnerBranch) {
        spinnerControlDecisions += 1;
      }
    }
    const legalScores = legalMoves.map((candidate) =>
      computePlayScore(simulatePlacement(board, candidate.tile, candidate.position), state.config),
    );
    const hadScoringOpportunity = legalScores.some((score) => score >= 5);
    if (hadScoringOpportunity) {
      scoringOpportunities += 1;
      if (move.score_delta < 5) suppressedScoringOpportunities += 1;
    }

    const afterBoard = simulatePlacement(board, tile, (move.branch ?? 'left') as PlacementPosition);
    const beforeOpenEnds = getOpenEnds(board).length;
    const afterOpenEnds = getOpenEnds(afterBoard).length;
    if (afterOpenEnds > beforeOpenEnds) {
      attackIncreases += 1;
    } else if (afterOpenEnds < beforeOpenEnds) {
      attackClosures += 1;
    }
  }

  if (playCount === 0) return null;

  const avgPerTurn = playCount > 0 ? totalPoints / playCount : 0;
  const aboveAvgTurns = Array.from(handScores.values()).filter((score) => score >= avgPerTurn).length;
  const consistency = handScores.size > 0 ? aboveAvgTurns / handScores.size : 0;
  return {
    gameId: game.id,
    playedAt: game.played_at,
    scoringBias: roundMetric(Math.min(1, totalPoints / (playCount * 10))),
    doublePriority: roundMetric(Math.min(1, doublesPlayed / playCount)),
    branchingFrequency: roundMetric(Math.min(1, branchesOpened / playCount)),
    spinnerControl: roundMetric(
      spinnerControlOpportunities === 0 ? 0 : spinnerControlDecisions / spinnerControlOpportunities,
    ),
    avgTurnPoints: roundMetric(totalPoints / playCount),
    drawPriority: roundMetric(
      forcedDrawPlays + scoringWithoutDraw === 0
        ? 0
        : forcedDrawPlays / (forcedDrawPlays + scoringWithoutDraw),
    ),
    pointSuppression: roundMetric(
      scoringOpportunities === 0 ? 0 : suppressedScoringOpportunities / scoringOpportunities,
    ),
    handSize: roundMetric(totalHandSize / playCount),
    attackSetup: roundMetric(
      attackIncreases + attackClosures === 0
        ? 0.5
        : attackIncreases / (attackIncreases + attackClosures),
    ),
    consistency: roundMetric(consistency),
  };
}

function buildStyleProfileFromSnapshots(
  snapshots: GhostGameStyleSnapshot[],
): GhostStyleProfile | null {
  if (snapshots.length === 0) return null;
  const weights = snapshots.map((_, index) => roundMetric(Math.pow(0.85, index)));
  const gameCount = snapshots.length;
  const confidence =
    gameCount < 5
      ? roundMetric((gameCount / 5) * 0.5)
      : gameCount < 15
        ? roundMetric(0.5 + ((gameCount - 5) / 10) * 0.35)
        : roundMetric(Math.min(1, 0.85 + Math.min(gameCount - 15, 5) / 5 * 0.15));

  return {
    scoringBias: weightedAverageMetric(snapshots.map((entry) => entry.scoringBias), weights),
    doublePriority: weightedAverageMetric(snapshots.map((entry) => entry.doublePriority), weights),
    branchingFrequency: weightedAverageMetric(snapshots.map((entry) => entry.branchingFrequency), weights),
    spinnerControl: weightedAverageMetric(snapshots.map((entry) => entry.spinnerControl), weights),
    avgTurnPoints: weightedAverageMetric(snapshots.map((entry) => entry.avgTurnPoints), weights),
    drawPriority: weightedAverageMetric(snapshots.map((entry) => entry.drawPriority), weights),
    pointSuppression: weightedAverageMetric(snapshots.map((entry) => entry.pointSuppression), weights),
    handSize: weightedAverageMetric(snapshots.map((entry) => entry.handSize), weights),
    attackSetup: weightedAverageMetric(snapshots.map((entry) => entry.attackSetup), weights),
    consistency: weightedAverageMetric(snapshots.map((entry) => entry.consistency), weights),
    confidence,
  };
}

function buildCompositeLog(
  games: GhostGameRow[],
  styleGames: GhostGameRow[],
  previousLog?: GhostCompositeLog | null,
): GhostCompositeLog {
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

  const existingSnapshots = new Map<string, GhostGameStyleSnapshot>();
  if (previousLog?.recentGameStyles) {
    for (const snapshot of previousLog.recentGameStyles) {
      existingSnapshots.set(snapshot.gameId, snapshot);
    }
  }

  const recentGameStyles = styleGames
    .map((game) => {
      const existing = existingSnapshots.get(game.id);
      if (existing) return existing;
      return analyzeGameStyle(game);
    })
    .filter((entry): entry is GhostGameStyleSnapshot => Boolean(entry))
    .slice(0, 20);

  return {
    generatedAt: new Date().toISOString(),
    sourceGameIds: games.map((game) => game.id),
    states: compositeStates,
    recentGameStyles,
  };
}

function computeAverageScore(games: GhostGameRow[]): number | null {
  if (games.length === 0) return null;
  const total = games.reduce((sum, game) => sum + Number(game.final_score ?? 0), 0);
  return Math.round((total / games.length) * 10) / 10;
}

function isGhostRatingEligible(finalScore: number | null | undefined, opponentScore: number | null | undefined): boolean {
  return Math.max(Number(finalScore ?? 0), Number(opponentScore ?? 0)) >= 10;
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
  const k = gamesPlayed < 20 ? 40 : gamesPlayed < 50 ? 32 : 20;
  const opponentRating = 1000;
  const expected = 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
  const total = Math.max(1, playerScore + opponentScore);
  const margin = Math.abs(playerScore - opponentScore) / total;
  const marginMultiplier = Math.log(margin * 10 + 1) / Math.log(11) + 0.5;
  const actual = playerScore > opponentScore ? 1 : 0;
  const delta = Math.round(k * (actual - expected) * marginMultiplier);
  return { newRating: playerRating + delta, delta };
}

/**
 * Serialized-byte ceiling for `compositeLog.states` in a profile-summary
 * response.
 *
 * `states` is ~99.7% of this payload: each entry carries an ~800-character
 * `boardState`, repeated verbatim inside `key`, so one state costs ~2.2 KB. The
 * heaviest live profile holds 1,190 of them — a 2.6 MB response returned on
 * every app load for every signed-in user, uncompressed.
 *
 * The size is not driven by lifetime games — `buildCompositeLog` already reads
 * only the last 20 — but by how many distinct positions those games visit, so
 * an active account reaches multi-megabyte responses on its own.
 */
export const COMPOSITE_LOG_STATE_BUDGET_BYTES = 256_000;

/** Repeat count for a state — how often this position recurred across games. */
function compositeStateWeight(state: GhostCompositeState): number {
  return state.candidates.reduce((sum, candidate) => sum + candidate.count, 0);
}

/**
 * Trims `compositeLog.states` to a byte budget, keeping the states most likely
 * to be matched again.
 *
 * The client uses these purely as a lookup: `pickCompositeMove` fingerprints the
 * live board and takes the bucket that matches, falling back to
 * `pickStyleWeightedMove` when nothing does. Dropping a state therefore costs at
 * most one composite match, never correctness — so the states worth keeping are
 * the ones that recurred most (high candidate count) and earliest (low turn),
 * since late-game positions are close to unique and essentially never re-match.
 *
 * Whole states only: a truncated `boardState` would silently mis-fingerprint.
 */
export function capCompositeLogStates(
  log: GhostCompositeLog | null,
  budgetBytes: number = COMPOSITE_LOG_STATE_BUDGET_BYTES,
): GhostCompositeLog | null {
  if (!log) return null;
  const states = log.states ?? [];
  if (JSON.stringify(states).length <= budgetBytes) return log;

  const ranked = [...states].sort((a, b) => {
    const weightDelta = compositeStateWeight(b) - compositeStateWeight(a);
    if (weightDelta !== 0) return weightDelta;
    if (a.turn !== b.turn) return a.turn - b.turn;
    return a.key.localeCompare(b.key);
  });

  const kept: GhostCompositeState[] = [];
  // Opening `[`, closing `]`, and one `,` per entry after the first.
  let used = 2;
  for (const state of ranked) {
    const cost = JSON.stringify(state).length + (kept.length > 0 ? 1 : 0);
    if (used + cost > budgetBytes) break;
    used += cost;
    kept.push(state);
  }

  // Restore the engine's own ordering so the retained slice reads the same way.
  kept.sort((a, b) => {
    if (a.turn !== b.turn) return a.turn - b.turn;
    return a.boardState.localeCompare(b.boardState);
  });

  return { ...log, states: kept };
}

export async function getGhostProfileSummary(userId: string): Promise<GhostProfileSummary> {
  const profile = await ensureGhostProfile(userId);
  const styleGames = await fetchRecentGhostGames(userId, 30);
  const recentGames = styleGames.slice(0, 20);
  const compositeLog = recentGames.length > 0 ? buildCompositeLog(recentGames, styleGames, profile.composite_log) : null;
  const styleProfile = compositeLog
    ? buildStyleProfileFromSnapshots(compositeLog.recentGameStyles)
    : null;

  return {
    ghostRating: Number(profile.ghost_rating ?? 800),
    gamesPlayed: Number(profile.games_played ?? recentGames.length ?? 0),
    avgScore: computeAverageScore(recentGames),
    recentScores: recentGames.map((game) => Number(game.final_score ?? 0)).reverse(),
    paddingGames: Math.max(0, 5 - recentGames.length),
    // Capped for the wire only — the full log stays in ghost_profiles, and the
    // training paths that rebuild it are untouched.
    compositeLog: capCompositeLogStates(compositeLog),
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

async function persistFritzGhostTrainingProfile(params: {
  userId: string;
  profile: GhostProfileRow;
  finalScore: number;
  opponentScore: number;
  trainingMoveLog: GhostMoveLogEntry[];
  matchId?: string | null;
  applyGlicko: boolean;
}): Promise<void> {
  const { isNewGame } = await insertGhostGameRow({
    userId: params.userId,
    finalScore: params.finalScore,
    opponentScore: params.opponentScore,
    trainingMoveLog: params.trainingMoveLog,
    matchId: params.matchId,
  });

  const styleGames = await fetchRecentGhostGames(params.userId, 30);
  const recentGames = styleGames.slice(0, 20);
  const compositeLog = buildCompositeLog(recentGames, styleGames, params.profile.composite_log);
  const styleProfile = buildStyleProfileFromSnapshots(compositeLog.recentGameStyles);
  // Same fail-closed contract as the profiles.glicko_rating write this
  // function runs alongside: applyGlicko === false means the caller could not
  // verify finalScore/opponentScore against a server-owned deal-snapshot
  // replay, so this training-profile "Ghost Rating" — also shown to users —
  // must not move from that unverified number either.
  const isRatingEligible = params.applyGlicko && isGhostRatingEligible(params.finalScore, params.opponentScore);
  const rating = isRatingEligible
    ? computeFritzRatingChange(
        Number(params.profile.ghost_rating ?? 800),
        params.finalScore,
        params.opponentScore,
        Number(params.profile.games_played ?? 0),
      )
    : { newRating: Number(params.profile.ghost_rating ?? 800), delta: 0 };

  await upsertGhostProfile({
    user_id: params.userId,
    ghost_rating: rating.newRating,
    last_updated: new Date().toISOString(),
    composite_log: compositeLog,
    style_profile: styleProfile,
    games_played:
      isNewGame && isRatingEligible
        ? Number(params.profile.games_played ?? 0) + 1
        : Number(params.profile.games_played ?? 0),
  });
}

export async function completeGhostGame(params: {
  userId: string;
  finalScore: number;
  opponentScore: number;
  moveLog: GhostMoveLogEntry[];
  playerMoveLog?: GhostMoveLogEntry[];
  opponentUserId?: string | null;
  matchId?: string | null;
  applyGlicko?: boolean;
}): Promise<{
  newRating: number;
  ratingDelta: number;
  glickoRating: number | null;
  glickoDelta: number | null;
  playerScore: number;
  ghostScore: number;
  playerWon: boolean;
  compositeLog: GhostCompositeLog;
  styleProfile: GhostStyleProfile | null;
}> {
  log.info({
    userId: params.userId,
    opponentUserId: params.opponentUserId,
  }, 'called');

  const isFritz = Boolean(params.opponentUserId && isFritzId(params.opponentUserId));
  const trainingMoveLog = normalizeMoveLog(
    isFritz && Array.isArray(params.playerMoveLog) && params.playerMoveLog.length > 0
      ? params.playerMoveLog
      : params.moveLog,
  );
  const isRatingEligible = isGhostRatingEligible(params.finalScore, params.opponentScore);

  if (isFritz) {
    const profile = await ensureGhostProfile(params.userId);
    let glickoRating: number | null = null;
    let glickoDelta: number | null = null;

    const rankingProfiles = await supabaseFetch<RankingProfileRow[]>(
      `/rest/v1/profiles?select=id,glicko_rating,glicko_rd&id=eq.${encodeURIComponent(params.userId)}&limit=1`,
      { method: 'GET' },
    );
    const rankingProfile = rankingProfiles[0];
    if (!rankingProfile) {
      throw new Error('Ranking profile not found for Fritz match.');
    }

    if (isRatingEligible && params.applyGlicko !== false) {
      const now = new Date().toISOString();
      const fritzId = params.opponentUserId ?? FRITZ_ELITE_ID;
      await supabaseFetch(`/rest/v1/ranked_games`, {
        method: 'POST',
        body: JSON.stringify([
          buildRankedGameInsertPayload({
            playerId: params.userId,
            opponentId: fritzId,
            playerScore: Math.round(params.finalScore),
            opponentScore: Math.round(params.opponentScore),
            gameType: 'fritz',
            playedAt: now,
            ratingBefore: rankingProfile.glicko_rating,
            rdBefore: rankingProfile.glicko_rd,
            ratingAfter: null,
            source: params.matchId
              ? { sourceType: 'verified_single_player', sourceMatchId: params.matchId }
              : null,
          }),
        ]),
      });

      const ratingResult = await processRatingPeriod(params.userId);
      glickoRating = ratingResult.newRating;
      glickoDelta = ratingResult.delta;
    } else {
      glickoRating = rankingProfile.glicko_rating;
      glickoDelta = 0;
    }

    void persistFritzGhostTrainingProfile({
      userId: params.userId,
      profile,
      finalScore: params.finalScore,
      opponentScore: params.opponentScore,
      trainingMoveLog,
      matchId: params.matchId,
      applyGlicko: params.applyGlicko !== false,
    }).catch((error) => {
      log.warn({
        userId: params.userId,
        error: error instanceof Error ? error.message : String(error),
      }, 'deferred Fritz training persistence failed');
    });

    return {
      newRating: Number(profile.ghost_rating ?? 800),
      ratingDelta: 0,
      glickoRating,
      glickoDelta,
      playerScore: Math.round(params.finalScore),
      ghostScore: Math.round(params.opponentScore),
      playerWon: params.finalScore > params.opponentScore,
      // Same cap as the profile fetch: the client writes this straight into the
      // ghostProfile the bot reads, so an uncapped value here would leave that
      // object flipping between capped and uncapped after every match.
      compositeLog: capCompositeLogStates(profile.composite_log) ?? {
        generatedAt: new Date().toISOString(),
        sourceGameIds: [],
        states: [],
        recentGameStyles: [],
      },
      styleProfile: profile.style_profile,
    };
  }

  const profile = await ensureGhostProfile(params.userId);
  const opponentProfile =
    params.opponentUserId && params.opponentUserId !== params.userId
      ? await fetchGhostProfile(params.opponentUserId)
      : null;

  const { isNewGame } = await insertGhostGameRow({
    userId: params.userId,
    finalScore: params.finalScore,
    opponentScore: params.opponentScore,
    trainingMoveLog,
    matchId: params.matchId,
  });

  const styleGames = await fetchRecentGhostGames(params.userId, 30);
  const recentGames = styleGames.slice(0, 20);
  const compositeLog = buildCompositeLog(recentGames, styleGames, profile.composite_log);
  const styleProfile = buildStyleProfileFromSnapshots(compositeLog.recentGameStyles);

  // Same fail-closed contract as the Fritz branch above: applyGlicko === false
  // (no server-verified deal-snapshot replay behind this completion) means no
  // rating change and no games_played increment — not a smaller/softer one.
  const ratingEligibleAndVerified = isRatingEligible && params.applyGlicko !== false;
  const rating = ratingEligibleAndVerified
    ? params.opponentUserId
      ? computeRatingChange(
          Number(profile.ghost_rating ?? 800),
          Number(opponentProfile?.ghost_rating ?? 1000),
          params.finalScore,
          params.opponentScore,
          Number(profile.games_played ?? 0),
        )
      : { newRating: Number(profile.ghost_rating ?? 800), delta: 0 }
    : { newRating: Number(profile.ghost_rating ?? 800), delta: 0 };

  await upsertGhostProfile({
    user_id: params.userId,
    ghost_rating: rating.newRating,
    last_updated: new Date().toISOString(),
    composite_log: compositeLog,
    style_profile: styleProfile,
    games_played:
      isNewGame && ratingEligibleAndVerified
        ? Number(profile.games_played ?? 0) + 1
        : Number(profile.games_played ?? 0),
  });

  return {
    newRating: rating.newRating,
    ratingDelta: rating.delta,
    glickoRating: null,
    glickoDelta: null,
    playerScore: Math.round(params.finalScore),
    ghostScore: Math.round(params.opponentScore),
    playerWon: params.finalScore > params.opponentScore,
    compositeLog,
    styleProfile,
  };
}
