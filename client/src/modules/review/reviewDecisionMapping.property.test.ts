/**
 * Client review pipeline, end to end on generated games:
 *   authoritative engine actions -> move log rows (as production logs them) + V2 snapshots
 *   -> correlateSnapshotsToMoveLog -> analyzeMoveLog (hand segmentation) -> player-decision ledger
 *   -> evaluation -> presentation record.
 *
 * The independent reference is the harness's own flat action log. The properties proven here:
 *   - every human decision the player took appears as exactly one analyzed row, once, in order, in the right hand;
 *   - every row is bound to the snapshot/evaluation of THAT decision (same hand, same action, same pre-action board);
 *   - the ledger identity (total = scored + estimate + forced + unavailable) holds and nothing is left pending;
 *   - the label shown for a row is the independent band of that row's loss; the recommended move is that row's evaluation;
 *   - a collapsed multi-draw turn maps to its FIRST draw and the later draws are evaluated but never claim a row.
 *
 * Reproducible: ids are `review-mapping-v1:<n>`; a failure names the game and the move number.
 *   REVIEW_MAPPING_GAMES (default 40)   REVIEW_MAPPING_NS (default review-mapping-v1)
 */
import { describe, expect, it } from 'vitest';
import type { ReviewEvaluationV1, ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { evaluateReviewPosition } from '@racehorse/review-engine';
import { makeGame, type GeneratedGame, type LoggedAction } from '../../../../packages/review-engine/src/__tests__/support/reviewIntegrityHarness';
import { snapshotBoardState, toTileTuple, type MoveEntry } from '../../game/moveLogger';
import { analyzeMoveLog } from '../../analyzer/moveAnalyzer';
import { assertPresentationConsistency, buildReviewPresentationRecord, presentationLabel } from '../../analyzer/reviewPresentationRecord';
import { buildReviewCoachingFacts } from '../../analyzer/reviewCoachingFacts';
import { buildReviewCoachingProse } from '../../analyzer/reviewCoachingProse';
import { buildDecisionIdByMoveNumber, correlateSnapshotsToMoveLog } from './correlateSnapshotsToMoveLog';
import { buildPlayerDecisionLedger } from './reviewDecisionAccounting';

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };

const GAMES = Number(process.env.REVIEW_MAPPING_GAMES ?? 40);
const NS = process.env.REVIEW_MAPPING_NS ?? 'review-mapping-v1';
const BUDGET = { maxNodes: 20_000, maxHiddenStateSamples: 6, maxPlyDepth: 2, seed: 'review-mapping', maxWallClockMs: 60_000 } as const;
const ZERO_CLOCK = () => 0;

// Independent band table (literals, not imported): inclusive on the better side.
const BANDS = { best: 0.12999999999999995, inaccuracy: 0.79, mistake: 5.98 } as const;
const expectedBand = (loss: number): 'Best' | 'Inaccuracy' | 'Mistake' | 'Blunder' =>
  loss <= BANDS.best ? 'Best' : loss <= BANDS.inaccuracy ? 'Inaccuracy' : loss <= BANDS.mistake ? 'Mistake' : 'Blunder';

type Built = {
  game: GeneratedGame;
  entries: MoveEntry[];
  /** the human's (seat "you") decisions, in order, as the independent log sees them */
  humanDecisions: LoggedAction[];
  /** the human decisions that own a log row (first draw of a run, every play and pass) */
  rowOwners: LoggedAction[];
  snapshots: ReviewPositionSnapshotV2[];
};

/** Rows exactly as the production no-move / placement handlers log them (non-Daily mode: one collapsed row per draw run). */
function buildLog(game: GeneratedGame): Built {
  const entries: MoveEntry[] = [];
  const rowOwners: LoggedAction[] = [];
  let moveNumber = 0;
  const acts = game.actions;
  for (let i = 0; i < acts.length; i += 1) {
    const a = acts[i]!;
    const pre = a.preState;
    const actor = a.actor;
    const hand = pre.players[actor]!.hand.map((t) => toTileTuple(t));
    const plays = a.snapshot.legalActions.flatMap((x) => (x.kind === 'play' ? [toTileTuple(x.tile)] : []));
    const base = {
      handNumber: a.handNumber,
      player: actor === 'you' ? ('you' as const) : ('opponent' as const),
      boardEnds: [-1, -1] as [number, number],
      handBefore: hand,
      pipDelta: 0,
      pointsScored: a.snapshot.outcome.immediatePoints,
      boardState: snapshotBoardState(pre.board),
      boardRenderState: pre.board,
      handSnapshot: hand,
      engineBestMove: null,
    };
    if (a.action.kind === 'draw') {
      const previous = acts[i - 1];
      const continuesRun = previous && previous.actor === actor && previous.action.kind === 'draw' && previous.handNumber === a.handNumber;
      if (continuesRun) continue; // collapsed: the run is represented by its first draw
      moveNumber += 1;
      entries.push({ ...base, moveNumber, action: 'draw', validMoves: [], pointsScored: 0 });
      if (actor === 'you') rowOwners.push(a);
      continue;
    }
    moveNumber += 1;
    if (a.action.kind === 'play') {
      entries.push({ ...base, moveNumber, action: 'place', tile: toTileTuple(a.action.tile), position: a.action.position, validMoves: plays });
    } else {
      entries.push({ ...base, moveNumber, action: 'pass', validMoves: [], pointsScored: 0 });
    }
    if (actor === 'you') rowOwners.push(a);
  }
  return {
    game, entries,
    humanDecisions: acts.filter((a) => a.actor === 'you'),
    rowOwners,
    snapshots: acts.map((a) => a.snapshot),
  };
}

let memo: Built[] | null = null;
const corpus = (): Built[] => (memo ??= Array.from({ length: GAMES }, (_, n) => buildLog(makeGame(NS, n))));

const evaluations = new Map<string, ReviewEvaluationV1>();
function evaluate(snapshot: ReviewPositionSnapshotV2): ReviewEvaluationV1 {
  const key = snapshot.identifiers.decisionId;
  let ev = evaluations.get(key);
  if (!ev) { ev = evaluateReviewPosition(snapshot, BUDGET, 0.02, ZERO_CLOCK); evaluations.set(key, ev); }
  return ev;
}

const sameAction = (entry: MoveEntry, a: LoggedAction): boolean => {
  if (a.action.kind === 'play') {
    return entry.action === 'place' && entry.position === a.action.position
      && [entry.tile![0], entry.tile![1]].sort().join() === [a.action.tile.low, a.action.tile.high].sort().join();
  }
  return entry.action === a.action.kind;
};

describe(`review mapping: engine actions -> review rows (${NS}, ${GAMES} games)`, () => {
  it('every human decision is exactly one analyzed row: none lost, none doubled, ordered, in the right hand', () => {
    let rows = 0;
    let humanDecisions = 0;
    let collapsedDraws = 0;
    for (const b of corpus()) {
      const analysis = analyzeMoveLog(b.entries, false, { reviewSnapshots: b.snapshots, winningScore: 60 });
      const analyzed = analysis.analyzedMoves;
      const ctx = b.game.id;
      expect(analyzed.length, `${ctx}: analyzed rows = human rows in the log`).toBe(b.rowOwners.length);
      // order and uniqueness
      const numbers = analyzed.map((m) => m.moveNumber);
      expect(new Set(numbers).size, `${ctx}: a move number appears once`).toBe(numbers.length);
      expect(numbers, `${ctx}: rows in log order`).toEqual([...numbers].sort((x, y) => x - y));
      // each row is the right human action, in order
      analyzed.forEach((row, i) => {
        const owner = b.rowOwners[i]!;
        const entry = b.entries.find((e) => e.moveNumber === row.moveNumber)!;
        expect(sameAction(entry, owner), `${ctx} row ${i + 1} (move #${row.moveNumber}) is not the ${JSON.stringify(owner.action)} decision`).toBe(true);
      });
      // hand attribution
      for (const hand of analysis.hands) {
        for (const move of hand.analyzedMoves) {
          const entry = b.entries.find((e) => e.moveNumber === move.moveNumber)!;
          expect(entry.handNumber, `${ctx} move #${move.moveNumber} in hand ${hand.handNumber}`).toBe(hand.handNumber);
        }
      }
      const handTotal = analysis.hands.reduce((s, h) => s + h.analyzedMoves.length, 0);
      expect(handTotal, `${ctx}: hands partition the rows (hand boundaries shift nothing)`).toBe(analyzed.length);
      rows += analyzed.length;
      humanDecisions += b.humanDecisions.length;
      collapsedDraws += b.humanDecisions.length - b.rowOwners.length;
    }
    process.stdout.write(`[review-mapping] ${GAMES} games: ${humanDecisions} human decisions -> ${rows} rows (${collapsedDraws} extra forced draws are folded into their first draw's row)\n`);
    expect(rows).toBeGreaterThan(GAMES * 8);
  });

  it('correlation binds each row to the snapshot of that very decision (same hand, seat, action and pre-action board), one-to-one', () => {
    let bound = 0;
    let unbound = 0;
    for (const b of corpus()) {
      const mine = b.snapshots.filter((s) => s.identifiers.actorId === 'you');
      const byDecision = correlateSnapshotsToMoveLog(mine, b.entries);
      const seenMoves = new Set<number>();
      for (const [decisionId, entry] of byDecision) {
        const owner = b.humanDecisions.find((a) => a.snapshot.identifiers.decisionId === decisionId)!;
        expect(owner, `${b.game.id}: decision ${decisionId} exists`).toBeDefined();
        expect(entry.handNumber, `${b.game.id} ${decisionId} hand`).toBe(owner.handNumber);
        expect(sameAction(entry, owner), `${b.game.id} ${decisionId} action`).toBe(true);
        expect(JSON.stringify(entry.boardState), `${b.game.id} ${decisionId} pre-action board`).toBe(JSON.stringify(snapshotBoardState(owner.snapshot.preAction.board)));
        expect(seenMoves.has(entry.moveNumber), `${b.game.id}: row #${entry.moveNumber} claimed twice`).toBe(false);
        seenMoves.add(entry.moveNumber);
        bound += 1;
      }
      // every row owner must be bound; the ONLY unbound human decisions are the later draws of a collapsed run
      const boundIds = new Set(byDecision.keys());
      for (const owner of b.rowOwners) {
        expect(boundIds.has(owner.snapshot.identifiers.decisionId), `${b.game.id}: row owner ${owner.snapshot.identifiers.decisionId} (${JSON.stringify(owner.action)}) has no decision bound`).toBe(true);
      }
      for (const a of b.humanDecisions) {
        if (boundIds.has(a.snapshot.identifiers.decisionId)) continue;
        unbound += 1;
        expect(a.action.kind, `${b.game.id}: unbound decision ${a.snapshot.identifiers.decisionId} must be a draw`).toBe('draw');
        const previous = b.game.actions[a.index - 2]!;
        expect(previous.actor === 'you' && previous.action.kind === 'draw', `${b.game.id}: unbound draw must continue a draw run`).toBe(true);
      }
    }
    process.stdout.write(`[review-mapping] correlation: ${bound} decisions bound one-to-one, ${unbound} later-draws intentionally unbound\n`);
    expect(bound).toBeGreaterThan(GAMES * 8);
  });

  it('the ledger identity holds, nothing is pending, and every row\'s evaluation is the evaluation of its own decision', () => {
    let rows = 0;
    const statuses = new Map<string, number>();
    for (const b of corpus()) {
      const mine = b.snapshots.filter((s) => s.identifiers.actorId === 'you');
      const analysis = analyzeMoveLog(b.entries, false, { reviewSnapshots: b.snapshots, winningScore: 60 });
      const decisionIdByMoveNumber = buildDecisionIdByMoveNumber(mine, b.entries);
      const results = new Map<string, ReviewEvaluationV1>();
      for (const s of mine) results.set(s.identifiers.decisionId, evaluate(s));
      const ledger = buildPlayerDecisionLedger({
        analyzedMoves: analysis.analyzedMoves, decisionIdByMoveNumber, resultsByDecisionId: results,
        errorsByDecisionId: new Map(), pendingDecisionIds: new Set(), batchDone: true,
      });
      const ctx = b.game.id;
      expect(ledger.totalDecisions, `${ctx} total = rows`).toBe(analysis.analyzedMoves.length);
      expect(ledger.scoredCount + ledger.estimateCount + ledger.forcedCount + ledger.unavailableCount + ledger.pendingCount, `${ctx} identity`).toBe(ledger.totalDecisions);
      expect(ledger.pendingCount, `${ctx}: every row resolved`).toBe(0);
      expect(ledger.unavailableCount, `${ctx}: nothing unavailable`).toBe(0);
      const ids = analysis.analyzedMoves.map((m) => decisionIdByMoveNumber.get(m.moveNumber));
      expect(ids.every((id) => typeof id === 'string'), `${ctx}: every row has a decision`).toBe(true);
      expect(new Set(ids).size, `${ctx}: no two rows share a decision`).toBe(ids.length);
      analysis.analyzedMoves.forEach((row, i) => {
        const decisionId = ids[i]!;
        const ev = results.get(decisionId)!;
        const owner = b.rowOwners[i]!;
        expect(owner.snapshot.identifiers.decisionId, `${ctx} row ${i + 1} decision`).toBe(decisionId);
        expect(ev.snapshotId, `${ctx} row ${i + 1} evaluation belongs to the row's decision`).toBe(decisionId);
        expect(JSON.stringify(ev.played.action), `${ctx} row ${i + 1} evaluated action = the action the row shows`).toBe(JSON.stringify(owner.snapshot.actualAction));
        expect(sameAction(b.entries.find((e) => e.moveNumber === row.moveNumber)!, owner), `${ctx} row ${i + 1}`).toBe(true);
      });
      for (const e of ledger.entries) statuses.set(e.status, (statuses.get(e.status) ?? 0) + 1);
      rows += ledger.totalDecisions;
    }
    process.stdout.write(`[review-mapping] ledger over ${rows} rows: ${JSON.stringify([...statuses])}\n`);
    expect(rows).toBeGreaterThan(GAMES * 8);
  }, 900_000);

  it('the label and the recommended move shown for a row come from that row\'s own evaluation, with the independent loss band', () => {
    let labelled = 0;
    let forced = 0;
    let tiedButDifferentBest = 0;
    for (const b of corpus()) {
      for (const owner of b.rowOwners) {
        const ev = evaluate(owner.snapshot);
        const record = buildReviewPresentationRecord(ev, null);
        const ctx = `${b.game.id}:${owner.snapshot.identifiers.decisionId}`;
        const legalCount = new Set(owner.snapshot.legalActions.map((x) => JSON.stringify(x))).size;
        expect(JSON.stringify(record.primaryReferenceAction), `${ctx}: recommendation = this evaluation's best`).toBe(JSON.stringify(ev.best.action));
        expect(record.playedMatchesPrimary, `${ctx} playedMatchesPrimary`).toBe(JSON.stringify(ev.played.action) === JSON.stringify(ev.best.action));
        if (ev.evidence.source === 'heuristic') {
          expect(record.classification?.kind === 'forced' || record.classification?.kind === 'estimate' || record.classification?.kind === 'unclear', `${ctx} heuristic is never a calibrated severity`).toBe(true);
          continue;
        }
        if (legalCount <= 1) {
          expect(record.classification, `${ctx}`).toEqual({ kind: 'forced' });
          expect(record.lossVsPrimary, `${ctx} forced has no loss claim`).toBeNull();
          forced += 1;
          continue;
        }
        expect(record.classification, `${ctx} band of loss ${ev.loss.expectedPointDifferential}`).toEqual({ kind: 'calibrated', label: expectedBand(ev.loss.expectedPointDifferential) });
        expect(record.lossVsPrimary, `${ctx} loss shown`).toBe(ev.loss.expectedPointDifferential);
        expect(ev.loss.expectedPointDifferential, `${ctx} loss = best - played`).toBeCloseTo(ev.best.value.expectedPointDifferential - ev.played.value.expectedPointDifferential, 12);
        if (!record.playedMatchesPrimary && ev.loss.expectedPointDifferential === 0) tiedButDifferentBest += 1;
        labelled += 1;
      }
    }
    process.stdout.write(`[review-mapping] presentation: ${labelled} calibrated rows, ${forced} forced, ${tiedButDifferentBest} rows played an equally-valued move that is not the shown best (all labelled Best)\n`);
    expect(labelled).toBeGreaterThan(10);
    expect(forced).toBeGreaterThan(10);
  }, 900_000);

  it('a player who chose an equally optimal move is labelled Best and never told they missed (real coaching prose)', () => {
    let tied = 0;
    for (const b of corpus()) {
      for (const owner of b.rowOwners) {
        const ev = evaluate(owner.snapshot);
        if (ev.evidence.source === 'heuristic') continue;
        if (new Set(owner.snapshot.legalActions.map((x) => JSON.stringify(x))).size <= 1) continue;
        if (ev.loss.expectedPointDifferential !== 0 || JSON.stringify(ev.played.action) === JSON.stringify(ev.best.action)) continue;
        const ctx = `${b.game.id}:${owner.snapshot.identifiers.decisionId}`;
        const record = buildReviewPresentationRecord(ev, null);
        const prose = buildReviewCoachingProse(buildReviewCoachingFacts(ev), false);
        expect(record.classification, `${ctx}: equally optimal move is Best`).toEqual({ kind: 'calibrated', label: 'Best' });
        expect(presentationLabel(record), ctx).toBe('Best');
        expect(prose.headline, `${ctx}: no miss language for an equally optimal move`).not.toMatch(/\b(weakest|significant miss|meaningful miss|costliest|noticeably weaker|major miss|mistake|blunder|inaccura)/i);
        expect(assertPresentationConsistency(record, prose.headline), `${ctx}: ${prose.headline}`).toEqual([]);
        tied += 1;
      }
    }
    process.stdout.write(`[review-mapping] tied-optimal rows checked against the real prose: ${tied}\n`);
    expect(tied, 'the corpus must contain equally optimal alternatives').toBeGreaterThan(0);
  }, 900_000);
});
