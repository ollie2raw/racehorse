/**
 * Decision accounting and candidate generation, against an independent model.
 *
 *  - ACCOUNTING: the harness keeps its own flat log of every command (both seats). The snapshots production would capture must be
 *    exactly that list: one per command, none missing, none twice, in order, attributed to the right hand and seat, ending at the
 *    terminal state.
 *  - CANDIDATES: legal actions are re-derived from the independent rules oracle's own board (OBoard replays the hand's plays and
 *    exposes its ports), never from the engine's move generator, so a bug in how the logical board is read cannot hide.
 *  - INFORMATION SET: a decision never sees tiles the player had not drawn yet, nor the opponent's hand.
 *  - OUTCOME: immediatePoints / post-action score agree with the oracle's scoring rule.
 *
 *   REVIEW_COVERAGE_GAMES (default 120)   REVIEW_COVERAGE_NS (default review-integrity-v1)
 */
import { describe, expect, it } from 'vitest';
import { replayReviewFixture } from '@racehorse/game-core/review';
import { OBoard, canon, okey, type OTile } from '../../../game-core/src/__tests__/support/engineOracle';
import { actionKey, makeGame, type GeneratedGame, type LoggedAction } from './support/reviewIntegrityHarness';

const GAMES = Number(process.env.REVIEW_COVERAGE_GAMES ?? 120);
const NS = process.env.REVIEW_COVERAGE_NS ?? 'review-integrity-v1';

let corpus: GeneratedGame[] | null = null;
const games = (): GeneratedGame[] => (corpus ??= Array.from({ length: GAMES }, (_, n) => makeGame(NS, n)));

const tileKey = (t: OTile): string => okey(t);

/** Plays of one hand up to (not including) `upTo`, replayed into the independent oracle board. */
function oracleBoardBefore(actions: readonly LoggedAction[], upTo: number): OBoard {
  const board = OBoard.empty();
  const target = actions[upTo]!;
  for (const a of actions) {
    if (a.index >= target.index) break;
    if (a.handNumber !== target.handNumber) continue;
    if (a.action.kind === 'play') board.place(canon(a.action.tile), a.action.position);
  }
  return board;
}

describe(`review decision coverage: every command is exactly one snapshot (${NS}, ${GAMES} games)`, () => {
  it('snapshots are 1:1 with the command log: none dropped, none duplicated, ordered, attributed to the right seat and hand', () => {
    let commands = 0;
    for (const game of games()) {
      const ids = new Set<string>();
      let lastHand = 0;
      game.actions.forEach((a, i) => {
        const ctx = `${game.id}@${a.index}`;
        expect(a.index, `${ctx} index`).toBe(i + 1);
        expect(a.snapshot.identifiers.actionNumber, `${ctx} actionNumber`).toBe(a.index);
        expect(a.snapshot.identifiers.actorId, `${ctx} actor`).toBe(a.actor);
        expect(a.snapshot.identifiers.handNumber, `${ctx} hand`).toBe(a.handNumber);
        expect(a.snapshot.identifiers.handId, `${ctx} handId`).toBe(`hand-${a.handNumber}`);
        expect(actionKey(a.snapshot.actualAction), `${ctx} actualAction`).toBe(actionKey(a.action));
        expect(ids.has(a.snapshot.identifiers.decisionId), `${ctx} duplicate decisionId`).toBe(false);
        ids.add(a.snapshot.identifiers.decisionId);
        expect(a.handNumber, `${ctx} hand number never goes backwards`).toBeGreaterThanOrEqual(lastHand);
        lastHand = a.handNumber;
        commands += 1;
      });
      expect(ids.size, `${game.id}: one decision id per command`).toBe(game.actions.length);
      // review stops at the terminal state: the game over flag is only ever set by the final command
      expect(game.finalState.gameOver || game.finalState.handOver, `${game.id} terminal`).toBe(true);
      const last = game.actions[game.actions.length - 1]!;
      expect(last.handNumber, `${game.id}: the last snapshot belongs to the last hand`).toBe(game.finalState.handNumber);
    }
    process.stdout.write(`[review-coverage] ${commands} commands = ${commands} snapshots over ${games().length} games, ${games().reduce((s, g) => s + g.hands, 0)} hands\n`);
    expect(commands).toBeGreaterThan(GAMES * 20);
  });

  it('each hand starts on an empty board with a fresh hand, and no snapshot leaks across a hand boundary', () => {
    for (const game of games()) {
      let hand = 0;
      for (const a of game.actions) {
        if (a.handNumber !== hand) {
          hand = a.handNumber;
          expect(a.snapshot.preAction.board, `${game.id}@${a.index}: first decision of hand ${hand} must see an empty board`).toBeNull();
          expect(a.snapshot.preAction.consecutivePasses, `${game.id}@${a.index} passes reset`).toBe(0);
        }
        const placed = (a.snapshot.preAction.board?.mainLine.length ?? 0);
        const sameHandPlays = game.actions.filter((x) => x.handNumber === a.handNumber && x.index < a.index && x.action.kind === 'play').length;
        const onBoard = (a.snapshot.preAction.board ? a.snapshot.preAction.board.mainLine.length + a.snapshot.preAction.board.hubDoubles.reduce((s, h) => s + h.branches.reduce((t, arm) => t + (arm?.tiles.length ?? 0), 0), 0) : 0);
        expect(onBoard, `${game.id}@${a.index}: tiles on board = plays so far in THIS hand`).toBe(sameHandPlays);
        void placed;
      }
    }
  });
});

describe('review candidates: legal actions re-derived from the independent rules oracle', () => {
  it('the snapshot\'s plays equal every (tile in hand x oracle port it matches), and draw / pass appear exactly when the rules say', () => {
    let positions = 0;
    let branchPositions = 0;
    let doubleHubs = 0;
    let multiPlacementTiles = 0;
    for (const game of games()) {
      for (const a of game.actions) {
        const ctx = `${game.id}@${a.index}`;
        const pre = a.snapshot.preAction;
        const board = oracleBoardBefore(game.actions, a.index - 1);
        const plays = new Set(a.snapshot.legalActions.flatMap((x) => (x.kind === 'play' ? [`${tileKey(x.tile)}@${x.position}`] : [])));
        let expected: Set<string>;
        if (board.main.length === 0) {
          // A closed hand opens with a double OR a play that scores on its own (documented rule); judged with the oracle's scoring.
          const rule = a.snapshot.rulesetConfig!.scoringMultiple;
          expected = new Set(
            pre.actorHand
              .filter((t) => {
                const solo = OBoard.empty();
                solo.place(canon(t), 'left');
                return t.low === t.high || solo.score(rule) > 0;
              })
              .map((t) => `${tileKey(t)}`),
          );
          expect(new Set([...plays].map((p) => p.split('@')[0])), `${ctx} opening tiles`).toEqual(expected);
          for (const p of plays) expect(p.endsWith('@left'), `${ctx} opening position`).toBe(true);
        } else {
          expected = new Set(
            pre.actorHand.flatMap((t) => board.ports().filter((p) => t.low === p.pip || t.high === p.pip).map((p) => `${tileKey(t)}@${p.position}`)),
          );
          expect(plays, `${ctx}: plays vs independent legal set`).toEqual(expected);
          if ([...expected].some((e) => e.includes('@branch-'))) branchPositions += 1;
          if (board.hubs.length > 0) doubleHubs += 1;
          const perTile = new Map<string, number>();
          for (const e of expected) perTile.set(e.split('@')[0]!, (perTile.get(e.split('@')[0]!) ?? 0) + 1);
          if ([...perTile.values()].some((c) => c > 1)) multiPlacementTiles += 1;
        }
        const hasPlay = plays.size > 0;
        const drawable = pre.boneyard.drawableCount > 0;
        const kinds = a.snapshot.legalActions.map((x) => x.kind);
        expect(kinds.includes('draw'), `${ctx}: draw legal iff no play and a drawable tile remains`).toBe(!hasPlay && drawable);
        expect(kinds.includes('pass'), `${ctx}: pass legal iff no play and nothing to draw`).toBe(!hasPlay && !drawable);
        expect(new Set(a.snapshot.legalActions.map(actionKey)).size, `${ctx}: no duplicate legal action`).toBe(a.snapshot.legalActions.length);
        expect(a.snapshot.legalActions.map(actionKey), `${ctx}: the played action is one of the legal actions`).toContain(actionKey(a.snapshot.actualAction));
        positions += 1;
      }
    }
    process.stdout.write(`[review-coverage] legal sets verified on ${positions} positions (${branchPositions} with branch placements, ${doubleHubs} with hubs, ${multiPlacementTiles} with one tile on several ends)\n`);
    expect(branchPositions).toBeGreaterThan(20);
    expect(doubleHubs).toBeGreaterThan(20);
    expect(multiPlacementTiles).toBeGreaterThan(20);
  }, 600_000);

  it('the independent scoring rule reproduces every snapshot\'s immediate points and post-action score', () => {
    let scoring = 0;
    for (const game of games()) {
      for (const a of game.actions) {
        if (a.action.kind !== 'play') { expect(a.snapshot.outcome.immediatePoints).toBe(0); continue; }
        const board = oracleBoardBefore(game.actions, a.index - 1);
        board.place(canon(a.action.tile), a.action.position);
        const rule = a.snapshot.rulesetConfig!.scoringMultiple;
        expect(a.snapshot.outcome.immediatePoints, `${game.id}@${a.index} immediate points`).toBe(board.score(rule));
        if (board.score(rule) > 0) scoring += 1;
      }
    }
    expect(scoring).toBeGreaterThan(50);
  }, 600_000);

  it('every snapshot replays cleanly against its authority state (digests, legal set, post-state)', () => {
    for (const game of games()) {
      for (const a of game.actions) {
        expect(() => replayReviewFixture({ snapshot: a.snapshot, authorityPreState: a.preState }), `${game.id}@${a.index}`).not.toThrow();
      }
    }
  }, 600_000);
});

describe('review information set: the position the player actually saw', () => {
  it('draw turns: each draw is its own decision seeing exactly the tiles drawn so far; the following play/pass sees all of them', () => {
    let drawThenPlay = 0;
    let manyDrawsThenPlay = 0;
    let drawsThenPass = 0;
    let longest = 0;
    for (const game of games()) {
      const acts = game.actions;
      for (let i = 0; i < acts.length; i += 1) {
        if (acts[i]!.action.kind !== 'draw') continue;
        const actor = acts[i]!.actor;
        // a maximal run of this actor's consecutive draws
        let j = i;
        while (j < acts.length && acts[j]!.actor === actor && acts[j]!.action.kind === 'draw') j += 1;
        const run = acts.slice(i, j);
        const startHand = run[0]!.snapshot.preAction.actorHand.length;
        const startBoneyard = run[0]!.snapshot.preAction.boneyard.physicalCount;
        run.forEach((d, n) => {
          const ctx = `${game.id}@${d.index} (draw ${n + 1}/${run.length})`;
          expect(d.snapshot.preAction.actorHand.length, `${ctx}: hand before this draw`).toBe(startHand + n);
          expect(d.snapshot.preAction.boneyard.physicalCount, `${ctx}: boneyard before this draw`).toBe(startBoneyard - n);
          expect(d.snapshot.legalActions.map(actionKey), `${ctx}: a draw decision offers only the draw`).toEqual([actionKey({ kind: 'draw' })]);
          expect(d.snapshot.preAction.actorHand.length, `${ctx}`).toBeLessThan(startHand + run.length + 1);
        });
        const after = acts[j];
        if (after && after.actor === actor) {
          expect(after.snapshot.preAction.actorHand.length, `${game.id}@${after.index}: the decision after ${run.length} draw(s) sees all drawn tiles`).toBe(startHand + run.length);
          // never a tile the player had not drawn yet: every legal tile is in the hand the snapshot carries
          const held = new Set(after.snapshot.preAction.actorHand.map(tileKey));
          for (const x of after.snapshot.legalActions) if (x.kind === 'play') expect(held.has(tileKey(x.tile)), `${game.id}@${after.index} legal tile ${tileKey(x.tile)} not in hand`).toBe(true);
          if (after.action.kind === 'play') { run.length === 1 ? (drawThenPlay += 1) : (manyDrawsThenPlay += 1); }
          if (after.action.kind === 'pass') drawsThenPass += 1;
        }
        longest = Math.max(longest, run.length);
        i = j - 1;
      }
    }
    process.stdout.write(`[review-coverage] draw turns: ${drawThenPlay} draw-then-play, ${manyDrawsThenPlay} many-draws-then-play, ${drawsThenPass} draws-then-pass, longest run ${longest}\n`);
    expect(drawThenPlay).toBeGreaterThan(5);
    expect(manyDrawsThenPlay).toBeGreaterThan(5);
    expect(drawsThenPass).toBeGreaterThan(0);
  }, 600_000);

  it('a snapshot carries no hidden tile identities: only the actor\'s own hand and counts', () => {
    for (const game of games().slice(0, 20)) {
      for (const a of game.actions) {
        const json = JSON.stringify(a.snapshot);
        const opponent = a.preState.players[a.snapshot.identifiers.opponentId]!.hand;
        expect(Object.keys(a.snapshot.preAction).sort(), `${game.id}@${a.index}`).toEqual(
          ['actorHand', 'board', 'boneyard', 'consecutivePasses', 'handOpen', 'knownMissingPipEvidence', 'opponentTileCount', 'scores', 'winningTarget'],
        );
        expect(a.snapshot.preAction.opponentTileCount).toBe(opponent.length);
        expect(json.includes('opponentHand'), `${game.id}@${a.index}`).toBe(false);
      }
    }
  });
});
