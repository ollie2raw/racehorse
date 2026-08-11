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
];

describe('ReviewPositionSnapshotV2 fixture corpus', () => {
  it('contains one distinct deterministic game-log checkpoint for every Batch 0 scenario class', () => {
    expect(REVIEW_FIXTURE_CORPUS).toHaveLength(REQUIRED_CATEGORIES.length);
    expect(new Set(REVIEW_FIXTURE_CORPUS.map((fixture) => fixture.id)).size).toBe(REVIEW_FIXTURE_CORPUS.length);
    expect(new Set(REVIEW_FIXTURE_CORPUS.map((fixture) => fixture.category))).toEqual(new Set(REQUIRED_CATEGORIES));
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

    const endgame = byCategory.get('exact_endgame')!;
    const totalHandTiles = endgame.authorityPreState.playerIds.reduce(
      (sum, id) => sum + endgame.authorityPreState.players[id].hand.length,
      0,
    );
    expect(totalHandTiles).toBeLessThanOrEqual(5);
    expect(endgame.snapshot.preAction.boneyard.drawableCount).toBe(0);

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
