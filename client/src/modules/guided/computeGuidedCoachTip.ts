import { chooseBotMove, toBotVisibleState } from '../fritz/botHeuristics.ts';
import {
  isDouble,
  previewPlayMove,
  type BotMatchState,
} from '../match/runtime/botEngine.ts';
import type { GuidedCoachTip } from '../match/types.ts';
import { tileEquals } from '../../game/tileUtils.ts';
import type { Move, Tile } from '../../types.ts';

export function computeGuidedCoachTip(
  match: BotMatchState,
  userPlayMoves: Move[],
  isGuidedMode: boolean,
): GuidedCoachTip | null {
  if (!isGuidedMode || match.currentPlayer !== 'you' || match.handOver || match.gameOver) return null;
  if (userPlayMoves.length === 0) return null;

  const allEvaluated = userPlayMoves
    .filter((m) => m.tile)
    .map((move) => {
      const preview = previewPlayMove(match, 'you', move);
      return {
        move,
        tile: move.tile as Tile,
        pts: preview?.immediateScore ?? 0,
        openSum: preview?.openSum ?? 0,
      };
    });

  if (allEvaluated.length === 0) return null;

  const isOpeningMove = (match.board?.mainLine.length ?? 0) === 0;

  if (isOpeningMove) {
    const scoring = allEvaluated.filter((e) => e.pts > 0);
    scoring.sort((a, b) => b.pts !== a.pts ? b.pts - a.pts : a.openSum - b.openSum);
    if (scoring.length > 0) {
      const best = scoring[0]!;
      return {
        tile: best.tile,
        bestMove: best.move,
        pts: best.pts,
        openSum: best.openSum,
        isOnlyPlay: allEvaluated.length === 1,
        isControlChoice: false,
        placementCount: scoring.length,
        isOpeningMove: true,
        isOpeningDouble: false,
      };
    }
    const doubles = allEvaluated.filter((e) => isDouble(e.tile));
    doubles.sort((a, b) => b.tile.high - a.tile.high);
    if (doubles.length > 0) {
      const best = doubles[0]!;
      return {
        tile: best.tile,
        bestMove: best.move,
        pts: 0,
        openSum: best.openSum,
        isOnlyPlay: allEvaluated.length === 1,
        isControlChoice: false,
        placementCount: doubles.length,
        isOpeningMove: true,
        isOpeningDouble: true,
      };
    }
    return null;
  }

  if (allEvaluated.length === 1) {
    const e = allEvaluated[0]!;
    return {
      tile: e.tile,
      bestMove: e.move,
      pts: e.pts,
      openSum: e.openSum,
      isOnlyPlay: true,
      isControlChoice: false,
      placementCount: 1,
      isOpeningMove: false,
      isOpeningDouble: false,
    };
  }

  const mirroredState: BotMatchState = {
    ...match,
    currentPlayer: 'bot',
    opponentPassedOnEnds: [],
    opponentDrawCount: 0,
    opponentKnownMissing: [],
    players: {
      you: match.players.bot,
      bot: match.players.you,
    },
  };
  const botChoice = chooseBotMove(toBotVisibleState(mirroredState), 'master');
  if (!botChoice?.move.tile) return null;

  const recommendedTile = botChoice.move.tile as Tile;
  const tileEvals = allEvaluated.filter((e) => tileEquals(e.tile, recommendedTile));
  if (tileEvals.length === 0) return null;

  tileEvals.sort((a, b) => b.pts !== a.pts ? b.pts - a.pts : a.openSum - b.openSum);
  const best = tileEvals[0]!;

  if (best.pts === 0) {
    const scoringEvals = allEvaluated.filter((e) => e.pts > 0);
    if (scoringEvals.length > 0) {
      scoringEvals.sort((a, b) => b.pts !== a.pts ? b.pts - a.pts : a.openSum - b.openSum);
      const override = scoringEvals[0]!;
      const overridePlacements = allEvaluated.filter((e) => tileEquals(e.tile, override.tile));
      overridePlacements.sort((a, b) => b.pts !== a.pts ? b.pts - a.pts : a.openSum - b.openSum);
      const bestOverride = overridePlacements[0]!;
      return {
        tile: bestOverride.tile,
        bestMove: bestOverride.move,
        pts: bestOverride.pts,
        openSum: bestOverride.openSum,
        isOnlyPlay: false,
        isControlChoice: false,
        placementCount: overridePlacements.length,
        isOpeningMove: false,
        isOpeningDouble: false,
      };
    }
  }

  const isControlChoice =
    tileEvals.length > 1 &&
    best.pts === 0 &&
    tileEvals.some((e) => e.openSum !== best.openSum);

  return {
    tile: recommendedTile,
    bestMove: best.move,
    pts: best.pts,
    openSum: best.openSum,
    isOnlyPlay: false,
    isControlChoice,
    placementCount: tileEvals.length,
    isOpeningMove: false,
    isOpeningDouble: false,
  };
}

export function computeGuidedScoringTiles(
  match: BotMatchState,
  userPlayMoves: Move[],
  isGuidedMode: boolean,
): Map<string, number> {
  if (!isGuidedMode || match.currentPlayer !== 'you') return new Map();
  const map = new Map<string, number>();
  for (const move of userPlayMoves) {
    if (!move.tile) continue;
    const preview = previewPlayMove(match, 'you', move);
    const pts = preview?.immediateScore ?? 0;
    if (pts > 0) {
      const key = `${move.tile.low}-${move.tile.high}`;
      map.set(key, Math.max(map.get(key) ?? 0, pts));
    }
  }
  return map;
}