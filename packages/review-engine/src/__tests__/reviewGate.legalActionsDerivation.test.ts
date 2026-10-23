/**
 * Integration gate: the server-side legal-action derivation must equal the engine-captured `legalActions` on EVERY recorded
 * position (so adopting it at the trust boundary changes nothing for honest clients), on a fresh namespace the original audit
 * never used, across both seats, branches, doubles, multi-draw runs, blocked hands, non-default rulesets and a JSON round trip.
 * A failure prints the replayable `<namespace>:<n>` and action index.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ReviewPositionSnapshotV2 } from '@racehorse/game-core/review';
import { REVIEW_FIXTURE_CORPUS } from '../../../game-core/src/reviewFixtureCorpus';
import { deriveLegalActionsFromSnapshot, sanitizeSnapshotForReview } from '../deriveReviewLegalActions';
import { actionKey, makeGame } from './support/reviewIntegrityHarness';

// These replay many generated games per test; locally they run in ~1s, but on the shared CI runner they approach the 5s default
// (observed 5.3s). Explicit, generous timeout: no assertion is changed.
vi.setConfig({ testTimeout: 60_000 });

const NS = 'gate-legal-ns-7f3';
const GAMES = 60;
const RULESETS = [
  { name: 'default', config: {} },
  { name: 'noScore-blocked', config: { blockedHandRule: 'noScore' as const } },
  { name: 'no-end-bonus', config: { endHandBonus: 'none' as const } },
  { name: 'multiple-10', config: { scoringMultiple: 10 } },
];

const keys = (actions: readonly { kind: string }[]) => actions.map((a) => actionKey(a as never));

describe('deriveLegalActionsFromSnapshot equals the engine-captured legal set', () => {
  for (const ruleset of RULESETS) {
    it(`${ruleset.name}: ${GAMES} games, both seats, live and JSON round-tripped`, () => {
      let positions = 0;
      let draws = 0;
      let passes = 0;
      let multiEnd = 0;
      for (let n = 0; n < GAMES; n += 1) {
        const game = makeGame(NS, n, { config: ruleset.config });
        for (const row of game.actions) {
          const where = `${game.id} action ${row.index} (${ruleset.name})`;
          const live = row.snapshot;
          const reloaded = JSON.parse(JSON.stringify(live)) as ReviewPositionSnapshotV2;
          for (const snap of [live, reloaded]) {
            expect(keys(deriveLegalActionsFromSnapshot(snap)), where).toEqual(keys(live.legalActions));
            const s = sanitizeSnapshotForReview(snap);
            expect(s.ok, where).toBe(true);
            if (s.ok) expect(s.replacedLegalActions, where).toBe(false);
          }
          positions += 1;
          if (row.action.kind === 'draw') draws += 1;
          if (row.action.kind === 'pass') passes += 1;
          const tiles = new Map<string, number>();
          for (const a of live.legalActions) if (a.kind === 'play') tiles.set(`${a.tile.low}-${a.tile.high}`, (tiles.get(`${a.tile.low}-${a.tile.high}`) ?? 0) + 1);
          if ([...tiles.values()].some((c) => c > 1)) multiEnd += 1;
        }
      }
      expect(positions).toBeGreaterThan(1000);
      expect(draws).toBeGreaterThan(0);
      expect(passes).toBeGreaterThan(0);
      expect(multiEnd).toBeGreaterThan(0);
    });
  }

  it('every fixture-corpus snapshot is accepted unchanged', () => {
    for (const fixture of REVIEW_FIXTURE_CORPUS) {
      const s = sanitizeSnapshotForReview(fixture.snapshot);
      expect(s.ok, fixture.id).toBe(true);
      if (s.ok) expect(s.replacedLegalActions, fixture.id).toBe(false);
    }
  });
});

describe('sanitizeSnapshotForReview rejects or repairs hostile snapshots', () => {
  const base = REVIEW_FIXTURE_CORPUS.find((f) => f.id === 'deliberately-poor-endgame-s78-a27')!.snapshot;

  it('restores an omitted legal action', () => {
    const forged = { ...base, legalActions: [base.actualAction] };
    const s = sanitizeSnapshotForReview(forged);
    expect(s.ok && keys(s.snapshot.legalActions)).toEqual(keys(base.legalActions));
  });

  it('drops an added illegal action', () => {
    const forged = { ...base, legalActions: [...base.legalActions, { kind: 'pass' } as const] };
    const s = sanitizeSnapshotForReview(forged);
    expect(s.ok && keys(s.snapshot.legalActions)).toEqual(keys(base.legalActions));
  });

  it('rejects an actual action that is not legal in the recorded position', () => {
    expect(sanitizeSnapshotForReview({ ...base, actualAction: { kind: 'pass' } })).toEqual({ ok: false, reason: 'corrupt-snapshot:actual-action-not-legal' });
  });

  it('rejects a hand that does not hold the played tile', () => {
    const s = sanitizeSnapshotForReview({ ...base, preAction: { ...base.preAction, actorHand: [] } });
    expect(s.ok).toBe(false);
  });

  it('rejects inconsistent boneyard counts and malformed shapes without throwing', () => {
    expect(sanitizeSnapshotForReview({ ...base, preAction: { ...base.preAction, boneyard: { physicalCount: 3, drawableCount: 9, deadCount: 0 } } }).ok).toBe(false);
    expect(sanitizeSnapshotForReview({ ...base, preAction: { ...base.preAction, opponentTileCount: -1 } }).ok).toBe(false);
    expect(sanitizeSnapshotForReview({} as never).ok).toBe(false);
    expect(sanitizeSnapshotForReview({ ...base, preAction: null } as never).ok).toBe(false);
  });
});
