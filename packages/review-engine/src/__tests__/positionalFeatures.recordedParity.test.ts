import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { boardTileCount, getOpenEnds, simulatePlacement, type Tile } from '@racehorse/game-core';
import type { ReviewAction, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { computePositionalFeatures } from '../computePositionalFeatures';
import { computeEndControlScore, computeEndDangerPenalty, computePressureScore, computeTrapPenalty, type HandPhase } from '../solveHeuristicOpening';
import { resolveHiddenPoolEligibility } from '../hiddenPoolEligibility';
import { replayRecordedSelfPlay } from '../devtools/replayRecordedSelfPlay';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const records = replayRecordedSelfPlay(resolve(root, 'packages/review-engine/fixtures/recorded-self-play'));
const tolerance = 1e-9;
const key = (tile: Tile) => `${Math.min(tile.low, tile.high)}|${Math.max(tile.low, tile.high)}`;

// Test-only extraction executes the actual protected originals, without
// editing their exports or keeping a second hand-copied expected formula.
const originalSource = ts.createSourceFile('botHeuristics.ts', readFileSync(resolve(root, 'client/src/modules/fritz/botHeuristics.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['branchPenalty', 'earlyDoubleExposurePenalty', 'estimateOpponentCanPlayProbability'];
const functions = originalSource.statements.filter(statement => ts.isFunctionDeclaration(statement) && statement.name && names.includes(statement.name.text));
if (functions.length !== names.length) throw new Error('Original feature functions moved; update parity mapping explicitly.');
const js = ts.transpileModule(functions.map(statement => statement.getText(originalSource)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
type OriginalFunctions = {
  branchPenalty: (move: { tile: Tile }, state: unknown, weights: Map<string, number>) => number;
  earlyDoubleExposurePenalty: (move: { tile: Tile }, state: unknown, weights: Map<string, number>, immediate: number) => number;
  estimateOpponentCanPlayProbability: (ends: number[], unseen: Tile[], count: number) => number;
};
const originals = runInNewContext(`${js}\n({${names.join(',')}})`, { boardTileCount, isDoubleTile: (tile: Tile) => tile.low === tile.high }) as OriginalFunctions;

function context(snapshot: ReviewPositionSnapshotV2, action: ReviewAction) {
  const hand = [...snapshot.preAction.actorHand];
  if (action.kind === 'play') {
    const index = hand.findIndex(tile => key(tile) === key(action.tile));
    if (index < 0) throw new Error('Recorded action is absent from hand.');
    hand.splice(index, 1);
  }
  const board = action.kind === 'play' ? simulatePlacement(snapshot.preAction.board, action.tile, action.position) : snapshot.preAction.board;
  const ends = getOpenEnds(board).map(end => end.matchValue);
  const before = getOpenEnds(snapshot.preAction.board).map(end => end.matchValue);
  const frequency = Array.from({ length: 7 }, (_, pip) => hand.filter(tile => tile.low === pip || tile.high === pip).length);
  const total = hand.length + snapshot.preAction.opponentTileCount;
  const phase: HandPhase = hand.length <= 3 || total <= 8 ? 'late' : hand.length <= 7 || total <= 16 ? 'mid' : 'early';
  const pool = resolveHiddenPoolEligibility(snapshot);
  const unseen = [...pool.eligibleForOpponent, ...pool.excludedTiles];
  const missing = new Map<number, number>();
  for (const item of snapshot.preAction.knownMissingPipEvidence) missing.set(item.pip, Math.max(missing.get(item.pip) ?? 0, item.reason === 'authority_observation' ? 5 : 4));
  const weights = new Map(unseen.map(tile => [key(tile), missing.has(tile.low) || missing.has(tile.high) ? 0.05 : 1]));
  return { hand, ends, before, frequency, phase, unseen, missing, weights };
}

describe('seven feature groups: recorded-self-play numeric parity and invariants', () => {
  it('replays nonempty committed games and preserves value equality across serialization', () => {
    expect(records.length).toBeGreaterThan(0);
    for (const { snapshot } of records) for (const action of snapshot.legalActions) {
      expect(computePositionalFeatures(structuredClone(snapshot), structuredClone(action))).toEqual(computePositionalFeatures(snapshot, action));
    }
  });

  it.each(['denial', 'end-control', 'hand-shape', 'missing-pressure', 'score-urgency', 'yard-pressure', 'double-risk'] as const)('%s: feature values, never composite ranking', group => {
    let checked = 0;
    for (const { snapshot } of records) for (const action of snapshot.legalActions) {
      const value = computePositionalFeatures(snapshot, action);
      const c = context(snapshot, action);
      const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
      if (group === 'denial') {
        // At hand count 1, the original probability's numerator is exactly
        // its raw unseen matching-tile count (the feature's stated unit).
        close(value.opponentOutsLeft, originals.estimateOpponentCanPlayProbability(c.ends, c.unseen, 1) * c.unseen.length);
        close(value.endDangerPenalty, action.kind === 'play' ? computeEndDangerPenalty(c.ends, c.frequency, c.unseen) : 0);
      } else if (group === 'end-control') {
        close(value.endControlScore, action.kind === 'play' ? computeEndControlScore(c.frequency, c.ends, c.phase) : 0);
      } else if (group === 'hand-shape') {
        const original = computeTrapPenalty(c.hand, c.ends, c.phase);
        expect(value.handShapeOrphanCount).toBe(original.orphanTiles);
        expect(value.handShapePlayableNext).toBe(original.playableNext);
        expect(value.handShapeMobilityScore).toBe(original.playableNext - original.orphanTiles);
      } else if (group === 'missing-pressure') {
        close(value.knownMissingPipExploitationScore, action.kind === 'play' ? computePressureScore(c.before, c.ends, c.missing) : 0);
      } else if (group === 'score-urgency') {
        expect(value.scoreMarginUrgency).toBeGreaterThanOrEqual(-100);
        expect(value.scoreMarginUrgency).toBeLessThanOrEqual(100);
        const swapped = { ...snapshot, preAction: { ...snapshot.preAction,
          scores: { actor: snapshot.preAction.scores.opponent, opponent: snapshot.preAction.scores.actor } } };
        close(value.scoreMarginUrgency, -computePositionalFeatures(swapped, action).scoreMarginUrgency);
      } else if (group === 'yard-pressure') {
        expect(value.tileCountBoneyardPressure).toBeGreaterThanOrEqual(0);
        expect(value.tileCountBoneyardPressure).toBeLessThanOrEqual(100);
        const moreYard = { ...snapshot, preAction: { ...snapshot.preAction, boneyard: { ...snapshot.preAction.boneyard, drawableCount: snapshot.preAction.boneyard.drawableCount + 1 } } };
        expect(computePositionalFeatures(moreYard, action).tileCountBoneyardPressure).toBeLessThanOrEqual(value.tileCountBoneyardPressure);
      } else {
        const state = { board: snapshot.preAction.board, players: { bot: { hand: c.hand } } };
        close(value.doubleHubOpeningRisk, action.kind === 'play' ? originals.branchPenalty(action, state, c.weights) + originals.earlyDoubleExposurePenalty(action, state, c.weights, value.immediatePoints) : 0);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(records.length);
  });
});
