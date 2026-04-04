import type { BoardState, Move, PlacementPosition, Tile } from '../types';
import type { BotMatchState, BotPlayerId } from '../bot/botEngine';
import { getMatchableOpenEnds, previewPlayMove } from '../bot/botEngine';
import type { GhostCompositeState, GhostProfileSummary, GhostResolvedMove } from './api';
import { chooseBotMove } from '../bot/botHeuristics';

const STYLE_PRIORS = {
  drawPriority: 0.72,
  pointSuppression: 0.65,
  attackSetup: 0.7,
  scoringBias: 0.35,
  spinnerControl: 0.8,
} as const;

function normalizeTileKey(value: string): string {
  const [aRaw, bRaw] = value.split('|');
  const a = Number(aRaw);
  const b = Number(bRaw);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return value;
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  return `${low}|${high}`;
}

export function toTileKey(tile: Tile): string {
  return normalizeTileKey(`${tile.low}|${tile.high}`);
}

export function parseTileKey(value: string): Tile | null {
  const normalized = normalizeTileKey(value);
  const [lowRaw, highRaw] = normalized.split('|');
  const low = Number(lowRaw);
  const high = Number(highRaw);
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  return { low, high };
}

export function serializeGhostBoardState(board: BoardState | null): string {
  if (!board) return 'board:empty';
  return JSON.stringify({
    mainLine: board.mainLine.map((placed) => ({
      tile: [placed.tile.low, placed.tile.high],
      orientation: placed.orientation,
    })),
    leftEnd: board.leftEnd,
    rightEnd: board.rightEnd,
    leftEndIsDouble: board.leftEndIsDouble,
    rightEndIsDouble: board.rightEndIsDouble,
    hubs: board.hubDoubles.map((hub, hubIndex) => ({
      hubId: hub.hubId ?? hub.tileIndex ?? hubIndex,
      laneType: hub.laneType ?? null,
      laneRef: hub.laneRef ?? null,
      branchDepth: hub.branchDepth ?? null,
      tileIndex: hub.tileIndex,
      mainlineIndex: hub.mainlineIndex ?? null,
      hubValue: hub.hubValue,
      leftSideFilled: Boolean(hub.leftSideFilled),
      rightSideFilled: Boolean(hub.rightSideFilled),
      isCrossed: Boolean(hub.isCrossed),
      branches: hub.branches.map((branch) =>
        branch
          ? {
              openEnd: branch.openEnd,
              openEndIsDouble: branch.openEndIsDouble,
              tiles: branch.tiles.map((placed) => ({
                tile: [placed.tile.low, placed.tile.high],
                orientation: placed.orientation,
              })),
            }
          : null,
      ),
    })),
  });
}

function parseGhostBoardState(value: string): BoardState | null {
  if (!value || value === 'board:empty') return null;
  try {
    return JSON.parse(value) as BoardState;
  } catch {
    return null;
  }
}

function sameMove(move: Move, tile: Tile, position: PlacementPosition): boolean {
  return Boolean(
    move.type === 'play' &&
      move.tile &&
      move.position === position &&
      toTileKey(move.tile) === toTileKey(tile),
  );
}

function sortMoves(a: Move, b: Move): number {
  const aTile = a.tile ? toTileKey(a.tile) : '';
  const bTile = b.tile ? toTileKey(b.tile) : '';
  if (aTile !== bTile) return aTile.localeCompare(bTile);
  return String(a.position ?? '').localeCompare(String(b.position ?? ''));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function blendWithPrior(computed: number | undefined, prior: number, confidence: number): number {
  const safeComputed = typeof computed === 'number' ? computed : prior;
  return confidence * safeComputed + (1 - confidence) * prior;
}

function influenceAbove(value: number | undefined, threshold: number): number {
  if (typeof value !== 'number' || value <= threshold) return 0;
  const normalized = (value - threshold) / Math.max(0.0001, 1 - threshold);
  return normalized * normalized;
}

function countTilesMatchingValue(hand: Tile[], pipValue: number): number {
  return hand.reduce(
    (count, tile) => count + (tile.low === pipValue || tile.high === pipValue ? 1 : 0),
    0,
  );
}

function getBlendedStyleProfile(profile: GhostProfileSummary | null) {
  const style = profile?.styleProfile;
  const rawConfidence = clamp(style?.confidence ?? 0, 0, 1);
  const blendConfidence = style ? rawConfidence : 0;

  return {
    ...style,
    drawPriority: blendWithPrior(style?.drawPriority, STYLE_PRIORS.drawPriority, blendConfidence),
    pointSuppression: blendWithPrior(
      style?.pointSuppression,
      STYLE_PRIORS.pointSuppression,
      blendConfidence,
    ),
    attackSetup: blendWithPrior(style?.attackSetup, STYLE_PRIORS.attackSetup, blendConfidence),
    scoringBias: blendWithPrior(style?.scoringBias, STYLE_PRIORS.scoringBias, blendConfidence),
    spinnerControl: blendWithPrior(
      style?.spinnerControl,
      STYLE_PRIORS.spinnerControl,
      blendConfidence,
    ),
    confidence: rawConfidence,
  };
}

function getSpinnerBranchOpeningValue(
  board: BoardState | null,
  position: PlacementPosition,
  nextBoard: BoardState,
): number | null {
  if (!board || !position.startsWith('branch-')) return null;
  const match = position.match(/^branch-(\d+)-(\d+)$/);
  if (!match) return null;
  const hubId = Number(match[1]);
  const armIndex = Number(match[2]);
  if (!Number.isFinite(hubId) || !Number.isFinite(armIndex)) return null;

  const beforeHub = board.hubDoubles.find((hub, index) => (hub.hubId ?? index) === hubId);
  const afterHub = nextBoard.hubDoubles.find((hub, index) => (hub.hubId ?? index) === hubId);
  const branchExistedBefore = Boolean(beforeHub?.branches?.[armIndex]);
  const branchExistsAfter = Boolean(afterHub?.branches?.[armIndex]);

  if (!beforeHub || !afterHub || branchExistedBefore || !branchExistsAfter) return null;
  return beforeHub.hubValue;
}

function countMatchingTiles(hand: Tile[], board: BoardState | null): number {
  const ends = getMatchableOpenEnds(board);
  if (ends.length === 0) return hand.length;
  return hand.reduce((count, tile) => {
    const playable = ends.some((end) => tile.low === end.matchValue || tile.high === end.matchValue);
    return count + (playable ? 1 : 0);
  }, 0);
}

function forcedDrawAfterPlay(
  state: BotMatchState,
  preview: NonNullable<ReturnType<typeof previewPlayMove>>,
): boolean {
  return (
    preview.nextHand.length === 0 &&
    (preview.isDouble || preview.immediateScore > 0) &&
    state.boneyard.length > state.deadTiles.length
  );
}

function boardFingerprint(board: BoardState | null, hand: Tile[]): string {
  if (!board) return 'empty';
  const openEnds = [
    board.leftEnd,
    board.rightEnd,
    ...board.hubDoubles.flatMap((hub) =>
      hub.branches.filter(Boolean).map((branch) => branch!.openEnd),
    ),
  ]
    .sort((a, b) => a - b)
    .join(',');
  const tileCount =
    board.mainLine.length +
    board.hubDoubles.reduce(
      (sum, hub) =>
        sum +
        hub.branches.filter(Boolean).reduce((branchSum, branch) => branchSum + (branch?.tiles.length ?? 0), 0),
      0,
    );
  const hubCount = board.hubDoubles.filter((hub) => hub.isCrossed).length;
  const handPips = hand
    .map((tile) => `${tile.low}|${tile.high}`)
    .sort()
    .join(',');
  return `${openEnds}__${tileCount}__${hubCount}__${handPips}`;
}

function buildCompositeFingerprintMap(
  states: GhostCompositeState[] | null | undefined,
  currentHand: Tile[],
): Map<string, GhostCompositeState[]> {
  const byFingerprint = new Map<string, GhostCompositeState[]>();
  for (const state of states ?? []) {
    const fingerprint = boardFingerprint(parseGhostBoardState(state.boardState), currentHand);
    const bucket = byFingerprint.get(fingerprint) ?? [];
    bucket.push(state);
    byFingerprint.set(fingerprint, bucket);
  }
  return byFingerprint;
}

function estimateFritzThreat(state: BotMatchState): number {
  const openEnds = state.board ? [state.board.leftEnd, state.board.rightEnd] : [];
  const openSum = state.board ? openEnds.reduce((sum, end) => sum + end, 0) : 0;
  const dangerous = state.boneyard.filter((tile) =>
    openEnds.some((end) => tile.low === end || tile.high === end) &&
    openEnds.reduce((sum, end) => {
      const pip = tile.low === end ? tile.high : tile.low;
      const newSum = openSum - end + pip;
      return sum + (newSum > 0 && newSum % 5 === 0 ? newSum / 5 : 0);
    }, 0) > 0,
  ).length;
  return dangerous / Math.max(1, state.boneyard.length);
}

function pickCompositeMove(
  state: BotMatchState,
  playMoves: Array<Move & { type: 'play'; tile: Tile; position: PlacementPosition }>,
  profile: GhostProfileSummary | null,
): GhostResolvedMove | null {
  const currentHand = state.players.you.hand;
  const fingerprint = boardFingerprint(state.board, currentHand);
  const byFingerprint = buildCompositeFingerprintMap(profile?.compositeLog?.states, currentHand);
  const candidates = byFingerprint.get(fingerprint) ?? [];
  if (candidates.length === 0) return null;

  const currentHandKeys = new Set(currentHand.map(toTileKey));
  const scoredCandidates = candidates
    .flatMap((composite) =>
      composite.candidates.map((candidate) => ({
        candidate,
        score:
          candidate.count * 3 +
          candidate.bestScoreDelta * 0.5 +
          (currentHandKeys.has(candidate.tilePlayed) ? 10 : -100),
      })),
    )
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.candidate.count !== b.candidate.count) return b.candidate.count - a.candidate.count;
      return a.candidate.tilePlayed.localeCompare(b.candidate.tilePlayed);
    });

  for (const entry of scoredCandidates) {
    if (!currentHandKeys.has(entry.candidate.tilePlayed)) continue;
    const tile = parseTileKey(entry.candidate.tilePlayed);
    if (!tile) continue;
    const position = (entry.candidate.branch ?? 'left') as PlacementPosition;
    const legal = playMoves.find((move) => sameMove(move, tile, position));
    if (legal?.tile && legal.position) {
      return {
        tile: legal.tile,
        position: legal.position,
        source: 'composite',
      };
    }
  }

  return null;
}

function pickStyleWeightedMove(
  state: BotMatchState,
  player: BotPlayerId,
  playMoves: Array<Move & { type: 'play'; tile: Tile; position: PlacementPosition }>,
  profile: GhostProfileSummary | null,
): GhostResolvedMove | null {
  const style = getBlendedStyleProfile(profile);
  const beforeOpenEnds = getMatchableOpenEnds(state.board).length;
  const drawInfluence = influenceAbove(style.drawPriority, 0.6);
  const suppressionInfluence = influenceAbove(style.pointSuppression, 0.5);
  const attackInfluence = influenceAbove(style.attackSetup, 0.6);
  const spinnerControlInfluence = influenceAbove(style.spinnerControl, 0.6);
  const fritzThreatScore = estimateFritzThreat(state);

  const botChoice = chooseBotMove(state, 'hard');
  const scored = playMoves
    .map((move) => {
      const preview = previewPlayMove(state, player, move);
      if (!preview) {
        return { move, total: Number.NEGATIVE_INFINITY, setupPotential: Number.NEGATIVE_INFINITY };
      }

      const baseScore = preview.immediateScore * 10;
      const setupDelta = preview.openEnds.length - beforeOpenEnds;
      const futureMobility = countMatchingTiles(preview.nextHand, preview.nextBoard);
      const drawBonus = forcedDrawAfterPlay(state, preview) ? 1 : 0;
      const attackScore = setupDelta * 6 + futureMobility * 1.5;
      const positionalScore = attackScore + (preview.turnContinues ? 2 : 0);
      const spinnerBranchValue = getSpinnerBranchOpeningValue(state.board, move.position, preview.nextBoard);
      const totalHandPips = preview.nextHand.reduce((sum, tile) => sum + tile.low + tile.high, 0);
      const isLateGame = state.boneyard.length <= 6 || preview.nextHand.length <= 3;
      const pipBurden = isLateGame ? totalHandPips * 0.8 : totalHandPips * 0.05;
      const turnContinueBonus =
        (style.avgTurnPoints ?? 0) > 1.5 && preview.turnContinues
          ? (style.avgTurnPoints ?? 0) * 2.5
          : 0;
      const fritzMissingBonus =
        ((state.opponentPassedOnEnds ?? []).filter((pip) => preview.openEnds.includes(pip)).length * 4) *
        (style.attackSetup ?? 0.5);
      const defensiveBonus =
        fritzThreatScore > 0.3 && (style.pointSuppression ?? 0) > 0.5 && preview.openEnds.length < beforeOpenEnds
          ? (style.pointSuppression ?? 0.5) * 10
          : 0;

      let total = baseScore + positionalScore;
      total += drawBonus * (2 + drawInfluence * 18);
      total += attackScore * (attackInfluence * 2.2);
      total -= pipBurden;
      total += turnContinueBonus;
      total += fritzMissingBonus;
      total += defensiveBonus;

      if (suppressionInfluence > 0 && preview.immediateScore >= 5) {
        const easyPointsPenalty = preview.immediateScore * (1.2 + suppressionInfluence * 2.8);
        total -= easyPointsPenalty;
        total += positionalScore * (suppressionInfluence * 2.4);
      }

      if (spinnerBranchValue != null && spinnerControlInfluence > 0) {
        const matchingTiles = countTilesMatchingValue(state.players[player].hand, spinnerBranchValue);
        if (matchingTiles <= 1) {
          const penalty = spinnerControlInfluence * (2 - matchingTiles) * 8;
          total -= penalty;
        }
      }

      if (
        botChoice?.move?.tile &&
        botChoice.move.position &&
        sameMove(move, botChoice.move.tile, botChoice.move.position as PlacementPosition)
      ) {
        total += 1.5;
      }

      total += clamp(style.drawPriority, 0, 1) * drawBonus;
      total += clamp(style.attackSetup, 0, 1) * setupDelta;

      return { move, total, setupPotential: positionalScore };
    })
    .sort((a, b) => {
      if (a.total !== b.total) return b.total - a.total;
      if (a.setupPotential !== b.setupPotential) return b.setupPotential - a.setupPotential;
      return sortMoves(a.move, b.move);
    });

  const best = scored[0]?.move;
  if (!best?.tile || !best.position) return null;
  return {
    tile: best.tile,
    position: best.position,
    source: 'style-weighted' as GhostResolvedMove['source'],
  };
}

export function resolveGhostMove(params: {
  state: BotMatchState;
  player: BotPlayerId;
  legalMoves: Move[];
  profile: GhostProfileSummary | null;
}): GhostResolvedMove | null {
  const playMoves = params.legalMoves.filter(
    (move): move is Move & { type: 'play'; tile: Tile; position: PlacementPosition } =>
      move.type === 'play' && Boolean(move.tile) && Boolean(move.position),
  );
  if (playMoves.length === 0) return null;

  const compositeMatch = pickCompositeMove(params.state, playMoves, params.profile);
  if (compositeMatch) return compositeMatch;

  if ((params.profile?.gamesPlayed ?? 0) === 0) {
    const randomMove = playMoves[Math.floor(Math.random() * playMoves.length)];
    return randomMove?.tile && randomMove.position
      ? {
          tile: randomMove.tile,
          position: randomMove.position,
          source: 'random-padding',
        }
      : null;
  }

  return pickStyleWeightedMove(params.state, params.player, playMoves, params.profile);
}

export function isSameResolvedMove(
  actual: { tile: Tile; position: PlacementPosition } | null,
  expected: GhostResolvedMove | null,
): boolean {
  if (!actual || !expected) return false;
  return toTileKey(actual.tile) === toTileKey(expected.tile) && actual.position === expected.position;
}
