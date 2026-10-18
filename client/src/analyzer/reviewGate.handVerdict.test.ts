/**
 * Integration gate: the hand verdict must be the ENGINE's hand score (play points + the end-of-hand award), not the sum of
 * move-log play points. Hands end by going out (sum of opponent penalties), by block (lowestPips / noScore) and under
 * endHandBonus: none; expected values come from the authoritative scoreboard at the hand boundaries, read independently of the
 * code under test. Failure output names `<namespace>:<n>` and the hand.
 */
import { describe, expect, it } from 'vitest';
import type { Config } from '@racehorse/game-core';
import { makeGame, type GeneratedGame } from '../../../packages/review-engine/src/__tests__/support/reviewIntegrityHarness';
import { snapshotBoardState, toTileTuple, type MoveEntry } from '../game/moveLogger';
import { analyzeMoveLog } from './moveAnalyzer';
import { buildHandVerdict, segmentMoveLogByHand } from './handSegmentation';

const NS = 'gate-hand-verdict-c41';
const GAMES = 40;
const RULESETS: Array<[string, Partial<Config>]> = [
  ['default', {}],
  ['blocked-noScore', { blockedHandRule: 'noScore' }],
  ['no-end-bonus', { endHandBonus: 'none' }],
];

/** Production-shaped rows: one per play/pass, one per draw run, `pointsScored` = the play's own points. */
function logOf(game: GeneratedGame): MoveEntry[] {
  const entries: MoveEntry[] = [];
  const acts = game.actions;
  acts.forEach((a, i) => {
    const hand = a.preState.players[a.actor]!.hand.map((t) => toTileTuple(t));
    const base = {
      handNumber: a.handNumber, player: a.actor === 'you' ? ('you' as const) : ('opponent' as const),
      boardEnds: [-1, -1] as [number, number], handBefore: hand, pipDelta: 0, pointsScored: a.snapshot.outcome.immediatePoints,
      boardState: snapshotBoardState(a.preState.board), boardRenderState: a.preState.board, handSnapshot: hand, engineBestMove: null,
    };
    if (a.action.kind === 'draw') {
      const prev = acts[i - 1];
      if (prev && prev.actor === a.actor && prev.action.kind === 'draw' && prev.handNumber === a.handNumber) return;
      entries.push({ ...base, moveNumber: entries.length + 1, action: 'draw', validMoves: [], pointsScored: 0 });
    } else if (a.action.kind === 'play') {
      const plays = a.snapshot.legalActions.flatMap((x) => (x.kind === 'play' ? [toTileTuple(x.tile)] : []));
      entries.push({ ...base, moveNumber: entries.length + 1, action: 'place', tile: toTileTuple(a.action.tile), position: a.action.position, validMoves: plays });
    } else {
      entries.push({ ...base, moveNumber: entries.length + 1, action: 'pass', validMoves: [], pointsScored: 0 });
    }
  });
  return entries;
}

/** Independent truth: the engine's scores at the start and end of each hand. */
function engineHandDeltas(game: GeneratedGame): Map<number, { you: number; bot: number; endedBy: string }> {
  const byHand = new Map<number, GeneratedGame['actions'][number][]>();
  for (const a of game.actions) byHand.set(a.handNumber, [...(byHand.get(a.handNumber) ?? []), a]);
  const nums = [...byHand.keys()];
  const out = new Map<number, { you: number; bot: number; endedBy: string }>();
  nums.forEach((h, i) => {
    const acts = byHand.get(h)!;
    const start = acts[0]!.preState.players;
    const end = i + 1 < nums.length ? byHand.get(nums[i + 1]!)![0]!.preState.players : game.finalState.players;
    out.set(h, { you: end.you!.score - start.you!.score, bot: end.bot!.score - start.bot!.score, endedBy: acts[acts.length - 1]!.action.kind });
  });
  return out;
}

describe('hand verdict = engine hand score (end-of-hand award included)', () => {
  for (const [name, config] of RULESETS) {
    it(`${name}: every hand's winner, margin and both totals equal the engine scoreboard`, () => {
      let hands = 0;
      let oldWrongWinner = 0;
      let oldWrongTotals = 0;
      let blockedHands = 0;
      let goOutHands = 0;
      for (let n = 0; n < GAMES; n += 1) {
        const game = makeGame(NS, n, { config });
        const entries = logOf(game);
        const truth = engineHandDeltas(game);
        const analysis = analyzeMoveLog(entries, false, {
          reviewSnapshots: game.actions.map((a) => a.snapshot),
          finalScores: { you: game.finalState.players.you!.score, opponent: game.finalState.players.bot!.score },
          winningScore: game.finalState.config.winningScore,
        });
        expect(analysis.hands.length, `${game.id}: hand count`).toBe(truth.size);
        // The OLD derivation (kept to show the defect this gate closes).
        const oldVerdicts = new Map(segmentMoveLogByHand(entries).map((s) => [s.handNumber, buildHandVerdict(s)]));
        for (const hand of analysis.hands) {
          const t = truth.get(hand.handNumber)!;
          const where = `${game.id} hand ${hand.handNumber} (${name}, ended by ${t.endedBy})`;
          expect(hand.verdict.pointsYou, `${where}: you`).toBe(t.you);
          expect(hand.verdict.pointsOpponent, `${where}: opponent`).toBe(t.bot);
          expect(hand.verdict.margin, `${where}: margin`).toBe(Math.abs(t.you - t.bot));
          expect(hand.verdict.winner, `${where}: winner`).toBe(t.you > t.bot ? 'you' : t.you < t.bot ? 'opponent' : 'tie');
          const startYou = hand.startingScores.you;
          expect(hand.endingScores.you - startYou, `${where}: ending - starting`).toBe(t.you);
          const old = oldVerdicts.get(hand.handNumber)!;
          if (old.pointsYou !== t.you || old.pointsOpponent !== t.bot) oldWrongTotals += 1;
          if (old.winner !== hand.verdict.winner) oldWrongWinner += 1;
          hands += 1;
          if (t.endedBy === 'pass') blockedHands += 1;
          if (t.endedBy === 'play') goOutHands += 1;
        }
      }
      expect(hands).toBeGreaterThan(100);
      expect(blockedHands, 'blocked hands are exercised').toBeGreaterThan(0);
      expect(goOutHands, 'go-out hands are exercised').toBeGreaterThan(0);
      if (name === 'default') {
        // the defect is real: the log-point derivation is wrong on many hands and flips the winner on some
        expect(oldWrongTotals).toBeGreaterThan(0);
        expect(oldWrongWinner).toBeGreaterThan(0);
      }
    });
  }

  it('multiplayer shape: scoreboardSnapshots fix the verdict WITHOUT switching the grading mode', () => {
    const game = makeGame(NS, 5);
    const entries = logOf(game);
    const truth = engineHandDeltas(game);
    const finalScores = { you: game.finalState.players.you!.score, opponent: game.finalState.players.bot!.score };
    const plain = analyzeMoveLog(entries, false, { winningScore: 60 });
    const withBoard = analyzeMoveLog(entries, false, { winningScore: 60, scoreboardSnapshots: game.actions.map((a) => a.snapshot), youActorId: 'you', finalScores });
    expect(withBoard.analyzedMoves.map((m) => [m.moveNumber, m.rating, m.score])).toEqual(plain.analyzedMoves.map((m) => [m.moveNumber, m.rating, m.score]));
    for (const hand of withBoard.hands) {
      const t = truth.get(hand.handNumber)!;
      expect([hand.verdict.pointsYou, hand.verdict.pointsOpponent, hand.verdict.source], `hand ${hand.handNumber}`).toEqual([t.you, t.bot, 'engine-scoreboard']);
    }
  });

  it('without snapshots the verdict falls back to the log (explicitly unmarked), never to a wrong "authoritative" one', () => {
    const game = makeGame(NS, 3);
    const analysis = analyzeMoveLog(logOf(game), false, { winningScore: 60 });
    for (const hand of analysis.hands) expect(hand.verdict.source).toBeUndefined();
  });
});
