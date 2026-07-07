import type { ConsequenceChain } from './analysisTypes';
import type { EngineBestMove } from '../game/moveLogger';
import type { AnalyzedMove, MoveRating } from './moveAnalyzer';

export type ReviewSidebarCopy = {
  shouldHavePlayed: string;
  whyBetter: string;
  whatHappenedInstead: string | null;
  takeaway: string;
};

type Breakdown = NonNullable<EngineBestMove['breakdown']>;

type BreakdownGaps = {
  immediate: number;
  mobility: number;
  replyRisk: number;
  unload: number;
  denial: number;
};

function tileText(tile?: [number, number]): string {
  if (!tile) return '—';
  return `${tile[0]}-${tile[1]}`;
}

function positionPhrase(position?: string): string {
  if (!position) return '';
  return ` at ${position}`;
}

function openCountSum(boardEnds: [number, number]): number {
  return boardEnds[0] + boardEnds[1];
}

function resolveBreakdowns(move: AnalyzedMove): {
  best: Breakdown | null;
  played: Breakdown | null;
} {
  return {
    best: move.bestBreakdown ?? move.engineBestMove?.breakdown ?? null,
    played: move.playedBreakdown ?? null,
  };
}

function computeGaps(best: Breakdown | null, played: Breakdown | null): BreakdownGaps {
  return {
    immediate: (best?.immediate ?? 0) - (played?.immediate ?? 0),
    mobility: (best?.mobility ?? 0) - (played?.mobility ?? 0),
    replyRisk: (played?.replyRisk ?? 0) - (best?.replyRisk ?? 0),
    unload: (best?.unload ?? 0) - (played?.unload ?? 0),
    denial: (best?.denial ?? 0) - (played?.denial ?? 0),
  };
}

function bestTileAndPosition(move: AnalyzedMove): { tile: string; position: string } {
  const best = move.bestTile ?? move.engineBestMove?.tile;
  return {
    tile: tileText(best),
    position: positionPhrase(move.bestPosition ?? move.engineBestMove?.position),
  };
}

function describeShouldHavePlayed(move: AnalyzedMove): string {
  const { tile, position } = bestTileAndPosition(move);
  if (tile === '—') return 'A stronger line was available from your hand.';

  const { best: bestBreakdown } = resolveBreakdowns(move);
  const immediate = bestBreakdown?.immediate ?? 0;
  const openCount = openCountSum(move.boardEnds);

  if (immediate > 0) {
    return `Playing ${tile}${position} scores ${immediate} point${immediate !== 1 ? 's' : ''}. The open count is ${openCount}.`;
  }

  const gaps = computeGaps(bestBreakdown, move.playedBreakdown ?? null);
  if (gaps.unload >= 4 || gaps.mobility >= 2) {
    const unload = bestBreakdown?.unload ?? 0;
    const mobility = bestBreakdown?.mobility ?? 0;
    return `Playing ${tile}${position} scores nothing immediately but removes ${unload} high pips and opens ${mobility} more play${mobility !== 1 ? 's' : ''} next turn.`;
  }

  return `Playing ${tile}${position} scores nothing immediately but keeps a stronger line on the open count of ${openCount}.`;
}

function describeWhyBetter(
  move: AnalyzedMove,
  consequence: ConsequenceChain | null | undefined,
): string {
  const { best, played } = resolveBreakdowns(move);
  const gaps = computeGaps(best, played);
  const pointsScored = consequence?.playedMove.pointsScored ?? 0;
  const bestImmediate = best?.immediate ?? 0;
  const openCount = openCountSum(move.boardEnds);
  const playedTile = tileText(move.playedTile);
  const { tile, position } = bestTileAndPosition(move);

  if (gaps.immediate > 0) {
    return `You played ${playedTile} and scored ${pointsScored} point${pointsScored !== 1 ? 's' : ''}. Playing ${tile}${position} would have scored ${bestImmediate} — ${gaps.immediate} more point${gaps.immediate !== 1 ? 's' : ''} on the open count of ${openCount}.`;
  }

  if (gaps.mobility >= 2) {
    const bestMobility = best?.mobility ?? 0;
    const playedMobility = played?.mobility ?? 0;
    return `Your move left ${playedMobility} playable line${playedMobility !== 1 ? 's' : ''} next turn. The best move kept ${bestMobility} — ${gaps.mobility} more than you.`;
  }

  if (gaps.replyRisk >= 3) {
    return `Your move left a reply risk of ${played?.replyRisk ?? 0} on the open count of ${openCount}. The best move dropped that to ${best?.replyRisk ?? 0}.`;
  }

  if (gaps.unload >= 4) {
    return `You shed ${played?.unload ?? 0} pips. The best line sheds ${best?.unload ?? 0} — ${gaps.unload} more from your hand.`;
  }

  if ((consequence?.pointsLeftOnTable ?? 0) > 0) {
    return `You left ${consequence!.pointsLeftOnTable} point${consequence!.pointsLeftOnTable !== 1 ? 's' : ''} on the open count of ${openCount}.`;
  }

  return `You played ${playedTile} on the open count of ${openCount}. The engine rated ${tile}${position} clearly stronger.`;
}

function describeConsequence(
  chain: ConsequenceChain | null | undefined,
  opponentLabel: string,
): string | null {
  if (!chain) return null;

  if (chain.opponentExploited && chain.opponentScore > 0) {
    return `${opponentLabel} scored ${chain.opponentScore} point${chain.opponentScore !== 1 ? 's' : ''} on the very next move.`;
  }

  if (chain.pointsLeftOnTable > 0) {
    return `${opponentLabel} didn't score immediately — but you gave up ${chain.pointsLeftOnTable} point${chain.pointsLeftOnTable !== 1 ? 's' : ''} by not playing the best line.`;
  }

  if (chain.initiativeShift === 'lost') {
    return `${opponentLabel} didn't score immediately, but you lost hand initiative on the next turns.`;
  }

  return `${opponentLabel} didn't score immediately on the next turn.`;
}

function describeTakeaway(
  move: AnalyzedMove,
  consequence: ConsequenceChain | null | undefined,
  opponentLabel: string,
): string {
  const { best, played } = resolveBreakdowns(move);
  const gaps = computeGaps(best, played);
  const openCount = openCountSum(move.boardEnds);
  const { tile, position } = bestTileAndPosition(move);
  const bestImmediate = best?.immediate ?? 0;

  if (consequence?.opponentExploited && consequence.opponentScore > 0) {
    return `On count ${openCount}, play ${tile}${position} first — ${opponentLabel} punished your line for ${consequence.opponentScore} points next turn.`;
  }

  if (bestImmediate > 0 && gaps.immediate > 0) {
    return `When the open count is ${openCount}, scan for ${tile}${position} before you commit — it scores ${bestImmediate} points.`;
  }

  if ((consequence?.pointsLeftOnTable ?? 0) > 0) {
    return `On count ${openCount}, you left ${consequence!.pointsLeftOnTable} points on the table — check ${tile}${position} before you play.`;
  }

  if (gaps.replyRisk >= 3) {
    return `On count ${openCount}, your play opened a ${played?.replyRisk ?? 0}-risk reply — prefer ${tile}${position} to keep Fritz's answer smaller.`;
  }

  if (gaps.mobility >= 2) {
    return `On count ${openCount}, don't lock yourself into one line — ${tile}${position} keeps ${best?.mobility ?? 0} plays alive next turn.`;
  }

  return `On count ${openCount}, compare ${tile}${position} to what you played before you lock in your tile.`;
}

const STRUCTURED_RATINGS: MoveRating[] = ['Blunder', 'Mistake', 'Inaccuracy'];

export function buildReviewSidebarCopy(input: {
  move: AnalyzedMove;
  consequence?: ConsequenceChain | null;
  opponentLabel?: string;
}): ReviewSidebarCopy | null {
  const { move, consequence, opponentLabel = 'Fritz' } = input;

  if (move.action !== 'place') {
    return {
      shouldHavePlayed: move.explanation,
      whyBetter: '',
      whatHappenedInstead: describeConsequence(consequence, opponentLabel),
      takeaway: `When you have legal plays on the board, compare your pass or draw against ${bestTileAndPosition(move).tile}${bestTileAndPosition(move).position}.`,
    };
  }

  if (!STRUCTURED_RATINGS.includes(move.rating)) {
    return null;
  }

  return {
    shouldHavePlayed: describeShouldHavePlayed(move),
    whyBetter: describeWhyBetter(move, consequence),
    whatHappenedInstead: describeConsequence(consequence, opponentLabel),
    takeaway: describeTakeaway(move, consequence, opponentLabel),
  };
}
