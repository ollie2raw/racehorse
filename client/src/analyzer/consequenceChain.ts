import type { AnalyzedMove, MoveRating } from './moveAnalyzer';
import type {
  ConsequenceChain,
  HandOutcomeContribution,
  InitiativeShift,
} from './analysisTypes';
import type { MoveEntry, TileTuple } from '../game/moveLogger';

const CONSEQUENCE_WINDOW = 3;

function nextEndsForTile(tile: TileTuple, boardEnds: [number, number]): Array<[number, number]> {
  const [left, right] = boardEnds;
  if (left < 0 || right < 0) return [[tile[0], tile[1]]];
  const out: Array<[number, number]> = [];
  if (tile[0] === left) out.push([tile[1], right]);
  if (tile[1] === left) out.push([tile[0], right]);
  if (tile[0] === right) out.push([left, tile[1]]);
  if (tile[1] === right) out.push([left, tile[0]]);
  return out;
}

function immediateOpenCountScore(tile: TileTuple | undefined, boardEnds: [number, number]): number {
  if (!tile) return 0;
  const possibilities = nextEndsForTile(tile, boardEnds);
  if (!possibilities.length) return 0;
  return Math.max(
    ...possibilities.map((ends) => {
      const sum = ends[0] + ends[1];
      return sum > 0 && sum % 5 === 0 ? sum : 0;
    }),
  );
}

function scoreStateAtMove(
  entries: MoveEntry[],
  upToMoveNumber: number,
): { you: number; opponent: number } {
  let you = 0;
  let opponent = 0;
  for (const entry of entries) {
    if (entry.moveNumber > upToMoveNumber) break;
    const pts = entry.pointsScored ?? 0;
    if (entry.player === 'you') you += pts;
    else opponent += pts;
  }
  return { you, opponent };
}

function initiativeShift(
  before: { you: number; opponent: number },
  after: { you: number; opponent: number },
): InitiativeShift {
  const beforeDiff = before.you - before.opponent;
  const afterDiff = after.you - after.opponent;
  if (afterDiff > beforeDiff + 4) return 'gained';
  if (afterDiff < beforeDiff - 4) return 'lost';
  return 'maintained';
}

function outcomeContribution(
  rating: MoveRating,
  opponentExploited: boolean,
  opponentScore: number,
  pointsLeft: number,
): HandOutcomeContribution {
  if (
    (rating === 'Blunder' || rating === 'Mistake') &&
    opponentExploited &&
    opponentScore >= 10
  ) {
    return 'critical';
  }
  if (
    (rating === 'Blunder' || rating === 'Mistake' || rating === 'Inaccuracy') &&
    (opponentExploited || pointsLeft >= 10)
  ) {
    return 'significant';
  }
  return 'minor';
}

function buildRippleSummary(input: {
  opponentExploited: boolean;
  opponentScore: number;
  initiativeShift: InitiativeShift;
  pointsLeft: number;
  opponentLabel: string;
}): string {
  const parts: string[] = [];
  if (input.pointsLeft > 0) {
    parts.push(`You left about ${input.pointsLeft} points on the table`);
  }
  if (input.opponentExploited && input.opponentScore > 0) {
    parts.push(`${input.opponentLabel} scored ${input.opponentScore} on the next move`);
  }
  if (input.initiativeShift === 'lost') {
    parts.push('you lost hand initiative');
  } else if (input.initiativeShift === 'gained') {
    parts.push('you kept initiative in the hand');
  }
  if (parts.length === 0) {
    return 'The board kept developing — no immediate punishment, but the line was still weaker.';
  }
  return `${parts.join('. ')}.`;
}

export function buildConsequenceChain(
  playedEntry: MoveEntry,
  analyzedMove: AnalyzedMove,
  handEntries: MoveEntry[],
  opponentLabel = 'Fritz',
): ConsequenceChain | null {
  if (playedEntry.player !== 'you') return null;

  const startIndex = handEntries.findIndex((entry) => entry.moveNumber === playedEntry.moveNumber);
  if (startIndex < 0) return null;

  const playedTile = playedEntry.tile;
  const bestTile = analyzedMove.bestTile ?? analyzedMove.engineBestMove?.tile;
  const pointsLeftOnTable = Math.max(
    0,
    immediateOpenCountScore(bestTile, playedEntry.boardEnds) -
      immediateOpenCountScore(playedTile, playedEntry.boardEnds),
  );

  const before = scoreStateAtMove(handEntries, playedEntry.moveNumber - 1);
  let opponentScore = 0;
  let opponentExploited = false;
  const window = handEntries.slice(startIndex + 1, startIndex + 1 + CONSEQUENCE_WINDOW);

  for (const entry of window) {
    if (entry.player !== 'opponent') continue;
    const pts = entry.pointsScored ?? 0;
    if (pts > 0) {
      opponentExploited = true;
      opponentScore = pts;
      break;
    }
  }

  const lastWindowMove = window[window.length - 1];
  const after = lastWindowMove
    ? scoreStateAtMove(handEntries, lastWindowMove.moveNumber)
    : scoreStateAtMove(handEntries, playedEntry.moveNumber);

  const shift = initiativeShift(before, after);
  const contribution = outcomeContribution(
    analyzedMove.rating,
    opponentExploited,
    opponentScore,
    pointsLeftOnTable,
  );

  return {
    moveNumber: playedEntry.moveNumber,
    playedMove: playedEntry,
    pointsLeftOnTable,
    opponentExploited,
    opponentScore,
    initiativeShift: shift,
    handOutcomeContribution: contribution,
    rippleSummary: buildRippleSummary({
      opponentExploited,
      opponentScore,
      initiativeShift: shift,
      pointsLeft: pointsLeftOnTable,
      opponentLabel,
    }),
  };
}

export function buildConsequenceChainsForHand(
  handEntries: MoveEntry[],
  analyzedMoves: AnalyzedMove[],
  opponentLabel = 'Fritz',
): ConsequenceChain[] {
  const byMoveNumber = new Map(analyzedMoves.map((move) => [move.moveNumber, move]));
  const chains: ConsequenceChain[] = [];

  for (const entry of handEntries) {
    if (entry.player !== 'you') continue;
    const analyzed = byMoveNumber.get(entry.moveNumber);
    if (!analyzed) continue;
    if (analyzed.rating === 'Brilliant' || analyzed.rating === 'Great') continue;
    const chain = buildConsequenceChain(entry, analyzed, handEntries, opponentLabel);
    if (chain) chains.push(chain);
  }

  return chains.sort((a, b) => {
    const weight = (c: ConsequenceChain) =>
      (c.handOutcomeContribution === 'critical' ? 3 : c.handOutcomeContribution === 'significant' ? 2 : 1) *
        100 +
      c.pointsLeftOnTable +
      c.opponentScore;
    return weight(b) - weight(a);
  });
}
