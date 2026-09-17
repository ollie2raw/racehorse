import { describe, expect, it } from 'vitest';
import { collectGameStateViolations } from '../invariants';
import {
  LEGACY_REVIEW_EVALUATION_DISCLOSURE,
  REVIEW_ENGINE_CONTRACT_VERSION,
  REVIEW_EVALUATION_VERSION,
  REVIEW_POSITION_SNAPSHOT_VERSION,
  replayReviewFixture,
} from '../reviewContracts';
import {
  REVIEW_FIXTURE_CORPUS,
  type ReviewFixtureCategory,
} from '../reviewFixtureCorpus';

const REQUIRED_CATEGORIES: readonly ReviewFixtureCategory[] = [
  'opening',
  'scoring_chain',
  'forced_move',
  'block',
  'nested_branches',
  'near_win_defense',
  'hidden_information_ambiguity',
  'exact_endgame',
  'deliberately_poor',
];

// Per-category minimum counts. Every category except exact_endgame and
// deliberately_poor carries exactly one checkpoint -- asserted via the
// "at least" + total-sum check below, not a second hardcoded literal per
// category, so this doesn't drift out of sync with itself.
const MIN_COUNT_BY_CATEGORY: Record<ReviewFixtureCategory, number> = {
  opening: 1,
  scoring_chain: 1,
  forced_move: 1,
  block: 1,
  nested_branches: 1,
  near_win_defense: 1,
  hidden_information_ambiguity: 1,
  // A feasible and an infeasible checkpoint, game-review-oracle-upgrade-2026-09-13.md B2.
  exact_endgame: 2,
  // C2a-1 (two initial checkpoints) + its 2026-09-17 corpus-expansion
  // follow-up (42 more, spread across opening/midgame/endgame phases and
  // ~40 distinct seeds -- see reviewFixtureCorpus.ts's own comment). A
  // lower bound, not an exact count: this category is expected to keep
  // growing as calibration needs more data, unlike every other category
  // here, which is a fixed, curated set of exactly one scenario each.
  deliberately_poor: 44,
};

describe('ReviewPositionSnapshotV2 fixture corpus', () => {
  it('contains at least one distinct deterministic game-log checkpoint for every Batch 0 scenario class', () => {
    expect(new Set(REVIEW_FIXTURE_CORPUS.map((fixture) => fixture.id)).size).toBe(REVIEW_FIXTURE_CORPUS.length);
    expect(new Set(REVIEW_FIXTURE_CORPUS.map((fixture) => fixture.category))).toEqual(new Set(REQUIRED_CATEGORIES));
    for (const category of REQUIRED_CATEGORIES) {
      const count = REVIEW_FIXTURE_CORPUS.filter((fixture) => fixture.category === category).length;
      expect(count, category).toBeGreaterThanOrEqual(MIN_COUNT_BY_CATEGORY[category]);
    }
    for (const fixture of REVIEW_FIXTURE_CORPUS) {
      expect(fixture.provenance.kind).toBe('deterministic-game-log');
      expect(collectGameStateViolations(fixture.authorityPreState), fixture.id).toEqual([]);
    }
  });

  it.each(REVIEW_FIXTURE_CORPUS)('$id replays its logged action and post-action board through game-core', (fixture) => {
    const replayed = replayReviewFixture(fixture);
    expect(replayed.board).toEqual(fixture.snapshot.outcome.postActionBoard);
    expect(replayed.players[fixture.snapshot.identifiers.actorId].score).toBe(
      fixture.snapshot.outcome.postActionActorScore,
    );
  });

  it('captures complete public facts without embedding hidden authority tiles or placeholders', () => {
    for (const fixture of REVIEW_FIXTURE_CORPUS) {
      const { snapshot, authorityPreState } = fixture;
      expect(snapshot.snapshotVersion).toBe(REVIEW_POSITION_SNAPSHOT_VERSION);
      expect(snapshot.reviewEngineVersion).toBe(REVIEW_ENGINE_CONTRACT_VERSION);
      expect(snapshot.preAction.actorHand).toEqual(
        authorityPreState.players[snapshot.identifiers.actorId].hand,
      );
      expect(snapshot.preAction.opponentTileCount).toBe(
        authorityPreState.players[snapshot.identifiers.opponentId].hand.length,
      );
      expect(snapshot.preAction.boneyard.physicalCount).toBe(authorityPreState.boneyard.length);
      expect(snapshot.preAction.boneyard.deadCount).toBe(authorityPreState.deadTiles.length);
      expect(snapshot.preAction.scores).toEqual({
        actor: authorityPreState.players[snapshot.identifiers.actorId].score,
        opponent: authorityPreState.players[snapshot.identifiers.opponentId].score,
      });

      const publicPayload = snapshot as unknown as Record<string, unknown>;
      expect(publicPayload).not.toHaveProperty('authorityPreState');
      expect(snapshot.preAction).not.toHaveProperty('opponentHand');
      expect(snapshot.preAction.boneyard).not.toHaveProperty('tiles');
      expect(JSON.stringify(snapshot)).not.toContain('placeholder');
    }
    expect(
      REVIEW_FIXTURE_CORPUS.some(
        (fixture) => fixture.snapshot.preAction.knownMissingPipEvidence.length > 0,
      ),
    ).toBe(true);
  });

  it('proves the corpus-specific strategic and terminal coverage predicates', () => {
    const byCategory = new Map(REVIEW_FIXTURE_CORPUS.map((fixture) => [fixture.category, fixture]));
    expect(byCategory.get('opening')?.snapshot.preAction.board).toBeNull();
    expect(byCategory.get('forced_move')?.snapshot.preAction.board).not.toBeNull();
    expect(byCategory.get('forced_move')?.snapshot.legalActions).toHaveLength(1);
    expect(byCategory.get('scoring_chain')?.snapshot.outcome.immediatePoints).toBeGreaterThan(0);

    const nested = byCategory.get('nested_branches')!;
    expect(nested.snapshot.preAction.board?.hubDoubles.some((hub) => hub.laneType === 'branch')).toBe(true);

    const nearWin = byCategory.get('near_win_defense')!;
    expect(nearWin.snapshot.preAction.scores.opponent / nearWin.snapshot.preAction.winningTarget).toBeGreaterThanOrEqual(0.85);
    expect(nearWin.snapshot.legalActions.length).toBeGreaterThan(1);

    const ambiguous = byCategory.get('hidden_information_ambiguity')!;
    expect(ambiguous.snapshot.preAction.opponentTileCount).toBeGreaterThanOrEqual(4);
    expect(ambiguous.snapshot.preAction.boneyard.drawableCount).toBeGreaterThanOrEqual(3);
    expect(ambiguous.snapshot.legalActions.length).toBeGreaterThanOrEqual(3);

    // exact_endgame has two fixtures (an infeasible and a feasible checkpoint,
    // B2) -- looked up by explicit id rather than the byCategory Map (which
    // would silently resolve to whichever is last in array order) so both are
    // checked unambiguously regardless of future insertion order.
    const byId = new Map(REVIEW_FIXTURE_CORPUS.map((fixture) => [fixture.id, fixture]));
    const infeasibleEndgame = byId.get('locked-yard-five-tile-endgame')!;
    const feasibleEndgame = byId.get('locked-yard-feasible-endgame')!;
    for (const endgame of [infeasibleEndgame, feasibleEndgame]) {
      const totalHandTiles = endgame.authorityPreState.playerIds.reduce(
        (sum, id) => sum + endgame.authorityPreState.players[id].hand.length,
        0,
      );
      expect(totalHandTiles).toBeLessThanOrEqual(5);
      expect(endgame.snapshot.preAction.boneyard.drawableCount).toBe(0);
    }

    const blocked = byCategory.get('block')!;
    expect(blocked.snapshot.actualAction.kind).toBe('pass');
    expect(replayReviewFixture(blocked).handOver).toBe(true);
  });

  it('rejects authority drift instead of reconstructing missing state with synthetic values', () => {
    const fixture = REVIEW_FIXTURE_CORPUS[0];
    const tampered = {
      ...fixture,
      authorityPreState: {
        ...fixture.authorityPreState,
        boneyard: fixture.authorityPreState.boneyard.slice(1),
      },
    };
    expect(() => replayReviewFixture(tampered)).toThrow(/digest mismatch/i);
  });

  it('locks legacy analysis to a visible heuristic and low-confidence disclosure', () => {
    expect(LEGACY_REVIEW_EVALUATION_DISCLOSURE).toEqual({
      source: 'heuristic',
      confidence: 'low',
      displayLabel: 'Legacy heuristic estimate',
      reason: 'incomplete-v1-position-snapshot',
    });
    expect(REVIEW_EVALUATION_VERSION).toBe(1);
  });
});
