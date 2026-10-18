/**
 * Legacy (heuristic, no V2 snapshot) analyzer: the grade must belong to the placement the player actually used.
 *
 * `MoveEntry.position` records where a tile was played, but `getMoveScores` looked the played move up by tile only and graded
 * `exactMatch` by tile only. Playing the reference TILE on the wrong end of the board therefore earned the reference
 * placement's score and a `Brilliant`, and a tile on two ends was always scored as its best placement.
 *
 * Graded against the Standard tier on purpose: its choices are seeded from the position, so the reference is the same on every
 * call and machine (the Master tier stops its endgame search at a wall-clock deadline, which would make "the reference move"
 * load-dependent; that is a documented limit of the legacy path, see docs/game-review-analyzer-audit.md 1.4).
 *
 * The scenarios are found, not hand-built: every generated position where the reference tile can go on more than one end,
 * replayed with the player using a different end. Reproducible ids: `review-legacy-position-v1:<n>`.
 */
import { describe, expect, it } from 'vitest';
import { makeGame } from '../../../packages/review-engine/src/__tests__/support/reviewIntegrityHarness';
import { chooseBotMove, toBotVisibleState } from '../modules/fritz/botHeuristics.ts';
import { getLegalMoves } from '../modules/match/runtime/botEngine.ts';
import { snapshotBoardState, toTileTuple, type MoveEntry } from '../game/moveLogger';
import { analyzeMoveLog, evalStateBuilders } from './moveAnalyzer';

declare const process: { stdout: { write(s: string): void } };

const NS = 'review-legacy-position-v1';
const GAMES = 14;
const SAMPLE = 10;
const OPTIONS = { oracleMode: 'tier', tierPlayed: 'standard' } as const;

type Scenario = { id: string; entry: MoveEntry; bestPosition: string; playedPosition: string };

function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (let n = 0; n < GAMES; n += 1) {
    const game = makeGame(NS, n);
    for (const a of game.actions) {
      if (a.actor !== 'you' || a.action.kind !== 'play' || !a.preState.board) continue;
      const hand = a.preState.players.you!.hand.map((t) => toTileTuple(t));
      const base: MoveEntry = {
        moveNumber: 1, handNumber: a.handNumber, player: 'you', action: 'place',
        tile: toTileTuple(a.action.tile), position: a.action.position,
        boardEnds: [-1, -1], handBefore: hand,
        validMoves: a.snapshot.legalActions.flatMap((x) => (x.kind === 'play' ? [toTileTuple(x.tile)] : [])),
        pipDelta: 0, pointsScored: a.snapshot.outcome.immediatePoints,
        boardState: snapshotBoardState(a.preState.board), boardRenderState: a.preState.board,
        handSnapshot: hand, engineBestMove: null,
      };
      const evalState = evalStateBuilders.buildPlaceholderEvalState(base);
      if (!evalState) continue;
      const distinctTiles = new Set(base.validMoves.map((t) => `${Math.min(...t)}|${Math.max(...t)}`));
      if (distinctTiles.size < 2) continue; // the legacy "only legal move" shortcut would hide the placement question
      const choice = chooseBotMove(toBotVisibleState(evalState), 'standard');
      if (!choice?.move.tile) continue;
      const placements = getLegalMoves(evalState, 'bot')
        .filter((m) => m.type === 'play' && m.tile && m.tile.low === choice.move.tile!.low && m.tile.high === choice.move.tile!.high)
        .map((m) => String(m.position));
      const other = [...new Set(placements)].find((p) => p !== String(choice.move.position));
      if (!other) continue;
      out.push({
        id: `${game.id}@${a.index}`, bestPosition: String(choice.move.position), playedPosition: other,
        entry: { ...base, tile: toTileTuple(choice.move.tile), position: other as MoveEntry['position'] },
      });
    }
  }
  return out;
}

const all = scenarios();
const step = Math.max(1, Math.floor(all.length / SAMPLE));
const found = all.filter((_, i) => i % step === 0).slice(0, SAMPLE);
const analyze = (entry: MoveEntry) => analyzeMoveLog([entry], true, OPTIONS).analyzedMoves[0]!;

describe('legacy analyzer is placement-aware', () => {
  it('finds real positions where the reference tile can go on a second end', () => {
    process.stdout.write(`[review-legacy] ${all.length} scenarios found, sampling ${found.length}\n`);
    expect(all.length).toBeGreaterThan(10);
    expect(found.length).toBeGreaterThan(5);
  });

  it('playing the reference TILE on a different end is not "Brilliant" (an exact match needs the same placement)', () => {
    const brilliant = found.filter((s) => analyze(s.entry).rating === 'Brilliant').map((s) => `${s.id}: played ${s.playedPosition}, reference ${s.bestPosition}`);
    expect(brilliant, `graded Brilliant for a different placement than the reference:\n${brilliant.join('\n')}`).toEqual([]);
  }, 600_000);

  it('playing the reference tile AND placement is an exact match (control)', () => {
    for (const s of found) {
      const exact: MoveEntry = { ...s.entry, position: s.bestPosition as MoveEntry['position'] };
      expect(analyze(exact).rating, s.id).toBe('Brilliant');
    }
  }, 600_000);

  it('the played breakdown comes from the placement that was played, not the best placement of that tile', () => {
    let differ = 0;
    for (const s of found) {
      const atBest = analyze({ ...s.entry, position: s.bestPosition as MoveEntry['position'] });
      const atOther = analyze(s.entry);
      if (JSON.stringify(atBest.playedBreakdown) !== JSON.stringify(atOther.playedBreakdown)) differ += 1;
    }
    expect(differ, 'two placements of one tile can not all share one played breakdown').toBeGreaterThan(0);
  }, 600_000);
});
