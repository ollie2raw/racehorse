import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  getLegalMoves,
  simulatePlacement,
  type GameState,
  type Tile,
} from '@racehorse/game-core';
import {
  GAME_COMMAND_VERSION,
  GAME_RULES_VERSION,
  REVIEW_ENGINE_CONTRACT_VERSION,
  REVIEW_POSITION_SNAPSHOT_VERSION,
  REVIEW_STATE_DIGEST_VERSION,
  type ReviewAction,
  type ReviewKnownMissingPipEvidence,
  type ReviewPositionSnapshotV2,
} from '@racehorse/game-core/review';
import type { BoardState } from '@racehorse/game-core/types';
import { solveExactEndgame } from '../solveExactEndgame';

// Shared scenario for most tests below: a single uncrossed double (2,2) on
// the board (leftEnd === rightEnd === 2, per engine.ts's real semantics for
// an unplayed double sitting in mainLine), and the actor holding exactly one
// tile, (2,6), that matches both open ends. This deliberately gives the
// actor two legal actions -- play (2,6)@left and play (2,6)@right -- whose
// resulting open-end *sets* are identical ({6,2} either way) and whose hub
// side-fill state is identical (exactly one side filled either way), so the
// two branches are exact mirrors of each other. That symmetry is used below
// to prove tie-break determinism (test 6) without needing to hand-verify an
// arbitrary numeric search outcome.
const BOARD: BoardState = simulatePlacement(null, { low: 2, high: 2 }, 'left');
const ACTOR_HAND: readonly Tile[] = [{ low: 2, high: 6 }];

function evidenceExcludingPip(pip: number): ReviewKnownMissingPipEvidence {
  return {
    opponentId: 'bot',
    pip,
    reason: 'passed_on_open_end',
    observedHandNumber: 1,
    observedSequence: 0,
    openEnds: [pip],
  };
}

function legalActionsFor(board: BoardState, actorHand: readonly Tile[]): ReviewAction[] {
  const probeState: GameState = {
    config: { ...DEFAULT_CONFIG, winningScore: 1_000_000 },
    playerIds: ['you', 'bot'],
    players: {
      you: { id: 'you', hand: actorHand, score: 0 },
      bot: { id: 'bot', hand: [], score: 0 },
    },
    board,
    boneyard: [],
    deadTiles: [],
    currentPlayerIndex: 0,
    handNumber: 1,
    handOpen: true,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 0,
  };
  return getLegalMoves(probeState, 'you').map((move) =>
    move.type === 'play' ? { kind: 'play', tile: move.tile, position: move.position } : { kind: 'pass' },
  );
}

function makeSnapshot(args: {
  board: BoardState | null;
  actorHand: readonly Tile[];
  opponentTileCount: number;
  boneyardDrawableCount: number;
  boneyardDeadCount: number;
  knownMissingPipEvidence?: readonly ReviewKnownMissingPipEvidence[];
}): ReviewPositionSnapshotV2 {
  const legalActions = legalActionsFor(args.board!, args.actorHand);
  return {
    snapshotVersion: REVIEW_POSITION_SNAPSHOT_VERSION,
    rulesVersion: GAME_RULES_VERSION,
    commandVersion: GAME_COMMAND_VERSION,
    reviewEngineVersion: REVIEW_ENGINE_CONTRACT_VERSION,
    stateDigestVersion: REVIEW_STATE_DIGEST_VERSION,
    identifiers: {
      sessionId: 'session-1',
      gameId: 'game-1',
      handId: 'hand-1',
      decisionId: 'session-1:you:1',
      mode: 'play-vs-fritz',
      gameNumber: 1,
      handNumber: 1,
      actionNumber: 1,
      turnSequence: 0,
      actorId: 'you',
      opponentId: 'bot',
    },
    preAction: {
      board: args.board,
      actorHand: args.actorHand,
      opponentTileCount: args.opponentTileCount,
      boneyard: {
        physicalCount: args.boneyardDrawableCount + args.boneyardDeadCount,
        drawableCount: args.boneyardDrawableCount,
        deadCount: args.boneyardDeadCount,
      },
      scores: { actor: 0, opponent: 0 },
      winningTarget: 1_000_000,
      consecutivePasses: 0,
      handOpen: true,
      knownMissingPipEvidence: args.knownMissingPipEvidence ?? [],
    },
    legalActions,
    actualAction: legalActions[0],
    outcome: { immediatePoints: 0, postActionBoard: null, postActionActorScore: 0 },
    integrity: {
      authorityPreStateDigest: 'review-state-v1:00000000',
      authorityPostStateDigest: 'review-state-v1:11111111',
    },
  };
}

// Feasible scenario: hidden pool (28 - 1 board tile - 1 actor tile = 26
// tiles) restricted by evidence to only pips {0,4}, leaving exactly 3
// eligible tiles -- (0,0),(0,4),(4,4) -- for a 1-tile opponent hand:
// C(3,1) = 3 feasible allocations.
function feasibleSnapshot(): ReviewPositionSnapshotV2 {
  return makeSnapshot({
    board: BOARD,
    actorHand: ACTOR_HAND,
    opponentTileCount: 1,
    boneyardDrawableCount: 0,
    boneyardDeadCount: 26 - 1, // hidden pool minus the opponent's 1 tile
    knownMissingPipEvidence: [1, 2, 3, 5, 6].map(evidenceExcludingPip),
  });
}

// Infeasible scenario: evidence excludes every pip 0-6, so no hidden tile
// (every domino uses two pips in 0-6) is ever eligible for the opponent's
// hand -- C(0, opponentTileCount) = 0 for any opponentTileCount > 0.
function infeasibleSnapshot(): ReviewPositionSnapshotV2 {
  return makeSnapshot({
    board: BOARD,
    actorHand: ACTOR_HAND,
    opponentTileCount: 1,
    boneyardDrawableCount: 0,
    boneyardDeadCount: 25,
    knownMissingPipEvidence: [0, 1, 2, 3, 4, 5, 6].map(evidenceExcludingPip),
  });
}

const GENEROUS_BUDGET = { maxNodes: 10_000 };

describe('solveExactEndgame (B2)', () => {
  it('returns a non-null result with one candidate per legal action, best at the top, complete at a generous budget', () => {
    const snapshot = feasibleSnapshot();
    const result = solveExactEndgame(snapshot, GENEROUS_BUDGET);
    expect(result).not.toBeNull();
    expect(result!.candidates).toHaveLength(snapshot.legalActions.length);
    expect(result!.best).toEqual(result!.candidates[0]);
    expect(result!.complete).toBe(true);
  });

  it('returns null, deterministically, for an infeasible allocation', () => {
    const snapshot = infeasibleSnapshot();
    expect(solveExactEndgame(snapshot, GENEROUS_BUDGET)).toBeNull();
    expect(solveExactEndgame(snapshot, GENEROUS_BUDGET)).toBeNull();
  });

  it('throws when the boneyard is not locked (drawableCount > 0) -- out of B2 scope', () => {
    const snapshot = makeSnapshot({
      board: BOARD,
      actorHand: ACTOR_HAND,
      opponentTileCount: 1,
      boneyardDrawableCount: 2,
      boneyardDeadCount: 24,
      knownMissingPipEvidence: [1, 2, 3, 5, 6].map(evidenceExcludingPip),
    });
    expect(() => solveExactEndgame(snapshot, GENEROUS_BUDGET)).toThrow();
  });

  it('is byte-stable: repeated calls on independently-constructed, deep-cloned snapshots deep-equal, including candidate order', () => {
    // Each call gets its own deep clone of a fresh snapshot -- no shared
    // object reference between calls -- so this can't be passing merely
    // because the implementation happens not to mutate a shared input; it
    // rules out real cross-call nondeterminism, not just in-memory mutation.
    const first = solveExactEndgame(structuredClone(feasibleSnapshot()), GENEROUS_BUDGET);
    const second = solveExactEndgame(structuredClone(feasibleSnapshot()), GENEROUS_BUDGET);
    const third = solveExactEndgame(structuredClone(feasibleSnapshot()), GENEROUS_BUDGET);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('respects a tiny node budget: marks complete false, does real bounded search work, and never exceeds maxNodes', () => {
    const snapshot = feasibleSnapshot();
    const tinyBudget = { maxNodes: 1 };
    const result = solveExactEndgame(snapshot, tinyBudget);
    expect(result).not.toBeNull();
    expect(result!.complete).toBe(false);
    // Boundary definition: `nodes` counts positions actually visited during
    // the recursive search, hard-capped so a visit that would exceed
    // maxNodes is never counted -- nodes can equal but never exceed maxNodes.
    expect(result!.nodes).toBeLessThanOrEqual(tinyBudget.maxNodes);
    // A stub that gave up immediately without visiting any real position
    // would also satisfy complete:false and nodes<=maxNodes -- require that
    // the budget was actually spent doing search work, not just declared.
    expect(result!.nodes).toBeGreaterThan(0);
  });

  it('breaks ties deterministically by canonical action key, not insertion order', () => {
    // The two legal actions here -- play (2,6)@left and play (2,6)@right --
    // are exact mirrors of each other (see the BOARD/ACTOR_HAND comment
    // above): same resulting open-end set, same hub side-fill state, same
    // hands and boneyard either way. Every downstream search line is
    // therefore isomorphic between the two branches, so their aggregated
    // values must be exactly equal -- a genuine, provable tie, not a
    // contrived one.
    const snapshot = feasibleSnapshot();
    expect(snapshot.legalActions).toHaveLength(2);
    const result = solveExactEndgame(snapshot, GENEROUS_BUDGET);
    expect(result).not.toBeNull();
    expect(result!.candidates[0].value.expectedPointDifferential).toBeCloseTo(
      result!.candidates[1].value.expectedPointDifferential,
    );
    const keys = result!.candidates.map((c) =>
      c.action.kind === 'play' ? `${c.action.tile.low}-${c.action.tile.high}@${c.action.position}` : c.action.kind,
    );
    // 'left' sorts before 'right' as the canonical tie-break key.
    expect(keys).toEqual(['2-6@left', '2-6@right']);
  });

  it('F4b: wall-clock ceiling marks complete false on a forced-slow run without fabricating full coverage', () => {
    const snapshot = feasibleSnapshot();
    let calls = 0;
    const fakeNow = () => {
      calls += 1;
      return calls === 1 ? 0 : 1_000_000;
    };
    const tinyCeilingBudget = { maxNodes: 10_000, maxWallClockMs: 1 };
    const result = solveExactEndgame(snapshot, tinyCeilingBudget, 6, fakeNow);

    expect(result).not.toBeNull();
    expect(result!.complete).toBe(false);
    expect(result!.hiddenStateSamples).toBe(0);
    expect(result!.coverage).toBe(0);
    expect(result!.candidates).toHaveLength(snapshot.legalActions.length);
  });

  it('F4b: does not fire the wall-clock ceiling for a normal-speed run at the default ceiling', () => {
    const snapshot = feasibleSnapshot();
    const result = solveExactEndgame(snapshot, GENEROUS_BUDGET);
    expect(result!.complete).toBe(true);
    expect(result!.hiddenStateSamples).toBe(3);
  });

  it('enumerates exactly C(n,k) allocations -- verified independently against the true combinatorial count', () => {
    const snapshot = feasibleSnapshot();
    const result = solveExactEndgame(snapshot, GENEROUS_BUDGET);
    expect(result).not.toBeNull();
    // 3 eligible tiles choose 1 = 3, independently computed here (not via
    // the implementation's own enumerator) so an off-by-one in the
    // implementation can't hide.
    const trueCount = 3;
    expect(result!.hiddenStateSamples).toBe(trueCount);
    expect(result!.coverage).toBe(1);
  });
});
