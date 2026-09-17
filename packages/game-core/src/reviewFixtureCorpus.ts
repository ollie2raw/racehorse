import { applyGameCommand, type GameCommand } from './commands';
import { canDraw, getLegalMoves } from './engine';
import { compareCodeUnits } from './fritzPolicy';
import { collectGameStateViolations } from './invariants';
import { createDeterministicDoubleSixDeal } from './random';
import { computePlayScore, getOpenEnds } from './scoring';
import {
  createReviewPositionSnapshotV2,
  type ReviewAction,
  type ReviewKnownMissingPipEvidence,
  type ReviewReplayFixture,
} from './reviewContracts';
import { DEFAULT_CONFIG, type GameState, type PlayMove } from './types';

export type ReviewFixtureCategory =
  | 'opening'
  | 'scoring_chain'
  | 'forced_move'
  | 'block'
  | 'nested_branches'
  | 'near_win_defense'
  | 'hidden_information_ambiguity'
  | 'exact_endgame'
  | 'deliberately_poor';

type FixtureStrategy = 'first_legal' | 'branch_builder' | 'worst_legal';

type ReviewFixtureSpec = {
  readonly id: string;
  readonly category: ReviewFixtureCategory;
  readonly description: string;
  readonly seed: string;
  readonly strategy: FixtureStrategy;
  readonly actionIndex: number;
  readonly expected: {
    readonly preDigest: string;
    readonly postDigest: string;
    readonly action: ReviewAction;
    readonly immediatePoints: number;
  };
};

export type ReviewCorpusFixture = ReviewReplayFixture & {
  readonly id: string;
  readonly category: ReviewFixtureCategory;
  readonly description: string;
  readonly provenance: {
    readonly kind: 'deterministic-game-log';
    readonly seed: string;
    readonly strategy: FixtureStrategy;
    readonly selectedActionIndex: number;
    readonly startingHandNumber: 4;
    readonly startingScores: { readonly player: 48; readonly opponent: 52 };
  };
};

/**
 * These checkpoints were selected from complete deterministic double-six games
 * driven only through applyGameCommand. They are not hand-authored board states.
 */
const FIXTURE_SPECS: readonly ReviewFixtureSpec[] = [
  {
    id: 'opening-double-from-live-deal',
    category: 'opening',
    description: 'Opening decision from a full deterministic deal with the boneyard still deep.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 0,
    expected: {
      preDigest: 'review-state-v1:c30d678c',
      postDigest: 'review-state-v1:4d4f0a3e',
      action: { kind: 'play', tile: { low: 0, high: 0 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'near-win-multi-choice-defense',
    category: 'near_win_defense',
    description: 'Player at 48 faces an opponent at 52 with four legal replies and a 60-point target.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 1,
    expected: {
      preDigest: 'review-state-v1:4d4f0a3e',
      postDigest: 'review-state-v1:f3a11745',
      action: { kind: 'play', tile: { low: 0, high: 3 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'hidden-allocation-ambiguous-midgame',
    category: 'hidden_information_ambiguity',
    description: 'Opponent decision with three legal plays, a large unknown hand, and twelve drawable tiles.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 2,
    expected: {
      preDigest: 'review-state-v1:f3a11745',
      postDigest: 'review-state-v1:84cd277a',
      action: { kind: 'play', tile: { low: 3, high: 6 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'forced-single-play-midgame',
    category: 'forced_move',
    description: 'Non-opening midgame position with exactly one legal placement.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 6,
    expected: {
      preDigest: 'review-state-v1:9cea7927',
      postDigest: 'review-state-v1:245b6a81',
      action: { kind: 'play', tile: { low: 0, high: 4 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'scoring-branch-chain',
    category: 'scoring_chain',
    description: 'A branch play scores two Racehorse points and retains the turn.',
    seed: 'review-corpus:0',
    strategy: 'first_legal',
    actionIndex: 13,
    expected: {
      preDigest: 'review-state-v1:2358c46c',
      postDigest: 'review-state-v1:54629f60',
      action: { kind: 'play', tile: { low: 4, high: 6 }, position: 'branch-0-0' },
      immediatePoints: 2,
    },
  },
  {
    id: 'nested-branch-decision',
    category: 'nested_branches',
    description: 'A live-game position with three hubs, including doubles created on branch lanes.',
    seed: 'review-corpus:1',
    strategy: 'branch_builder',
    actionIndex: 12,
    expected: {
      preDigest: 'review-state-v1:aa88f0cd',
      postDigest: 'review-state-v1:9030c47a',
      action: { kind: 'play', tile: { low: 0, high: 3 }, position: 'branch-0-0' },
      immediatePoints: 0,
    },
  },
  // Infeasible under strict evidence exclusion, by design — kept as-is, not a
  // bug. knownMissingPipEvidence excludes pips {4, 5}; the 6-tile hidden pool
  // is {(0,0),(1,1),(3,3),(1,5),(5,5),(4,6)}; removing tiles that carry pip 4
  // or 5 leaves only {(0,0),(1,1),(3,3)} (3 tiles) eligible for the
  // opponent's 4-tile hand -- C(3,4) = 0. This is Phase B's exact_endgame
  // infeasibility fixture (game-review-oracle-upgrade-2026-09-13.md, B2):
  // Review Engine B2's solveExactEndgame must return null here, not a
  // fabricated ranking over zero real allocations.
  {
    id: 'locked-yard-five-tile-endgame',
    category: 'exact_endgame',
    description: 'Five total hand tiles remain, the drawable yard is locked, and three plays are legal.',
    seed: 'review-corpus:2',
    strategy: 'first_legal',
    actionIndex: 26,
    expected: {
      preDigest: 'review-state-v1:2e7cd3e8',
      postDigest: 'review-state-v1:82f6a9eb',
      action: { kind: 'play', tile: { low: 2, high: 6 }, position: 'branch-1-0' },
      immediatePoints: 0,
    },
  },
  // Feasible companion to the fixture above -- Review Engine B2 needs
  // exact_endgame coverage of its main job (producing a real ranked
  // candidate list), not only the infeasibility path. knownMissingPipEvidence
  // excludes pips {2, 3, 5}; the 5-tile hidden pool is
  // {(0,0),(1,1),(3,6),(4,6),(6,6)}; removing tiles carrying pip 2, 3, or 5
  // removes only (3,6) (pip 3), leaving {(0,0),(1,1),(4,6),(6,6)} (4 tiles)
  // eligible for the opponent's 3-tile hand -- C(4,3) = 4, feasible.
  {
    id: 'locked-yard-feasible-endgame',
    category: 'exact_endgame',
    description: 'Two actor tiles and a three-tile opponent hand remain, the drawable yard is locked, evidence excludes three pips, and four evidence-consistent opponent-hand allocations remain feasible.',
    seed: 'review-corpus:26',
    strategy: 'first_legal',
    actionIndex: 28,
    expected: {
      preDigest: 'review-state-v1:42fdea2a',
      postDigest: 'review-state-v1:93e22d47',
      action: { kind: 'play', tile: { low: 3, high: 4 }, position: 'branch-0-0' },
      immediatePoints: 0,
    },
  },
  {
    id: 'second-pass-blocks-hand',
    category: 'block',
    description: 'The locked-yard second consecutive pass resolves a physically valid blocked hand.',
    seed: 'review-corpus:26',
    strategy: 'first_legal',
    actionIndex: 33,
    expected: {
      preDigest: 'review-state-v1:b6055141',
      postDigest: 'review-state-v1:5b13d910',
      action: { kind: 'pass' },
      immediatePoints: 0,
    },
  },
  // C2a-1 (docs/scoping/phase-c-accuracy-model-spec.md, section 5 gap check):
  // deliberately_poor was one of three fixture-corpus categories the spec
  // found had zero representation. These two fixtures use a new
  // FixtureStrategy, 'worst_legal' (see chooseFixtureCommand below), which
  // mirrors branch_builder's own strategic-value weighting (branch play,
  // doubles, new branch hubs, immediate score) but inverted -- it always
  // picks the LEAST valuable legal play instead of the most valuable one.
  // Both checkpoints below were confirmed, by actually running the real
  // evaluateReviewPosition dispatcher against them (not eyeballed), to
  // produce a non-heuristic, materially nonzero moveLoss -- see
  // reviewFixtureCorpus.deliberatelyPoor.test.ts.
  //
  // C2a-1 follow-up (2026-09-17, corpus expansion): two fixtures were not
  // enough to anchor a calibration constant (calibrateAccuracyModel.ts's
  // worst_legal loss histogram had n=2). The 42 fixtures below were
  // generated by a one-off script (not committed) that drove the SAME
  // worst_legal strategy already proven correct above, over 100 different
  // deterministic seeds (review-corpus:0..99, the same seed family every
  // other category in this file already uses), then kept every checkpoint
  // that the real evaluateReviewPosition dispatcher confirmed was scorable
  // (isScorable) with moveLoss > 5. Deduplicated to at most one checkpoint
  // per (seed, phase) pair and two exact duplicates of the pre-existing
  // fixtures above were dropped. Phase is classified by drawable boneyard
  // count at the decision point (opening: >=10 drawable, i.e. before or
  // just after the first draw; midgame: 1-9 drawable; endgame: 0 drawable,
  // locked yard) -- not by hand number or action index, since a slow-drawing
  // hand and a fast one reach the same "phase" at different action indices.
  // 15 opening + 20 midgame + 7 endgame = 42 new fixtures, spread across 39
  // distinct seeds (several seeds contribute one opening AND one midgame
  // checkpoint from the same underlying deal, which are still genuinely
  // different board states, not near-duplicates -- confirmed no two
  // fixtures in this whole category share a (preDigest, postDigest) pair).
  {
    id: 'deliberately-poor-avoided-branch-and-score',
    category: 'deliberately_poor',
    description: 'Three legal replies were available, including a branch/scoring continuation; the actual play deliberately picks the least strategically valuable of the three instead.',
    seed: 'review-corpus:11',
    strategy: 'worst_legal',
    actionIndex: 19,
    expected: {
      preDigest: 'review-state-v1:fb1f9006',
      postDigest: 'review-state-v1:9fc90d40',
      action: { kind: 'play', tile: { low: 2, high: 3 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-flat-continuation-over-branch',
    category: 'deliberately_poor',
    description: 'Three legal replies were available, including a branch continuation; the actual play deliberately extends the plain main line instead.',
    seed: 'review-corpus:4',
    strategy: 'worst_legal',
    actionIndex: 18,
    expected: {
      preDigest: 'review-state-v1:bc1d977b',
      postDigest: 'review-state-v1:8bf4f8d9',
      action: { kind: 'play', tile: { low: 0, high: 5 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s21-a10',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:21, hand 4, loss ~9.66.',
    seed: 'review-corpus:21',
    strategy: 'worst_legal',
    actionIndex: 10,
    expected: {
      preDigest: 'review-state-v1:b36d3dbc',
      postDigest: 'review-state-v1:70832d01',
      action: { kind: 'play', tile: { low: 5, high: 6 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s95-a11',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:95, hand 4, loss ~8.57.',
    seed: 'review-corpus:95',
    strategy: 'worst_legal',
    actionIndex: 11,
    expected: {
      preDigest: 'review-state-v1:855ea688',
      postDigest: 'review-state-v1:5c553439',
      action: { kind: 'play', tile: { low: 0, high: 2 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s15-a13',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:15, hand 4, loss ~7.76.',
    seed: 'review-corpus:15',
    strategy: 'worst_legal',
    actionIndex: 13,
    expected: {
      preDigest: 'review-state-v1:35526e2f',
      postDigest: 'review-state-v1:eb766019',
      action: { kind: 'play', tile: { low: 2, high: 6 }, position: 'branch-0-0' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s24-a9',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:24, hand 4, loss ~7.72.',
    seed: 'review-corpus:24',
    strategy: 'worst_legal',
    actionIndex: 9,
    expected: {
      preDigest: 'review-state-v1:c24b0e12',
      postDigest: 'review-state-v1:43478223',
      action: { kind: 'play', tile: { low: 4, high: 6 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s94-a11',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:94, hand 4, loss ~7.33.',
    seed: 'review-corpus:94',
    strategy: 'worst_legal',
    actionIndex: 11,
    expected: {
      preDigest: 'review-state-v1:87fac2f9',
      postDigest: 'review-state-v1:ef9d81ac',
      action: { kind: 'play', tile: { low: 3, high: 4 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s58-a9',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:58, hand 4, loss ~7.27.',
    seed: 'review-corpus:58',
    strategy: 'worst_legal',
    actionIndex: 9,
    expected: {
      preDigest: 'review-state-v1:21a0a205',
      postDigest: 'review-state-v1:3abe4f3b',
      action: { kind: 'play', tile: { low: 1, high: 5 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s30-a9',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:30, hand 4, loss ~6.70.',
    seed: 'review-corpus:30',
    strategy: 'worst_legal',
    actionIndex: 9,
    expected: {
      preDigest: 'review-state-v1:1c6af470',
      postDigest: 'review-state-v1:2bc4c2cf',
      action: { kind: 'play', tile: { low: 2, high: 5 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s14-a8',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:14, hand 4, loss ~6.61.',
    seed: 'review-corpus:14',
    strategy: 'worst_legal',
    actionIndex: 8,
    expected: {
      preDigest: 'review-state-v1:a44d9fa9',
      postDigest: 'review-state-v1:7ff2ffeb',
      action: { kind: 'play', tile: { low: 1, high: 4 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s93-a4',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:93, hand 4, loss ~6.57.',
    seed: 'review-corpus:93',
    strategy: 'worst_legal',
    actionIndex: 4,
    expected: {
      preDigest: 'review-state-v1:5136b117',
      postDigest: 'review-state-v1:5fc3164e',
      action: { kind: 'play', tile: { low: 0, high: 3 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s10-a10',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:10, hand 4, loss ~6.10.',
    seed: 'review-corpus:10',
    strategy: 'worst_legal',
    actionIndex: 10,
    expected: {
      preDigest: 'review-state-v1:d0188e35',
      postDigest: 'review-state-v1:ce15ed23',
      action: { kind: 'play', tile: { low: 3, high: 4 }, position: 'right' },
      immediatePoints: 2,
    },
  },
  {
    id: 'deliberately-poor-opening-s1-a7',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:1, hand 4, loss ~5.88.',
    seed: 'review-corpus:1',
    strategy: 'worst_legal',
    actionIndex: 7,
    expected: {
      preDigest: 'review-state-v1:08a1b3e4',
      postDigest: 'review-state-v1:3fde5e6e',
      action: { kind: 'play', tile: { low: 1, high: 2 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s72-a4',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:72, hand 4, loss ~5.80.',
    seed: 'review-corpus:72',
    strategy: 'worst_legal',
    actionIndex: 4,
    expected: {
      preDigest: 'review-state-v1:5da63a77',
      postDigest: 'review-state-v1:35ab1af1',
      action: { kind: 'play', tile: { low: 5, high: 6 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s79-a9',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:79, hand 4, loss ~5.75.',
    seed: 'review-corpus:79',
    strategy: 'worst_legal',
    actionIndex: 9,
    expected: {
      preDigest: 'review-state-v1:b1bbea20',
      postDigest: 'review-state-v1:55906bba',
      action: { kind: 'play', tile: { low: 3, high: 5 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s13-a4',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:13, hand 4, loss ~5.59.',
    seed: 'review-corpus:13',
    strategy: 'worst_legal',
    actionIndex: 4,
    expected: {
      preDigest: 'review-state-v1:1a4afa8a',
      postDigest: 'review-state-v1:4c4ef586',
      action: { kind: 'play', tile: { low: 3, high: 6 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-opening-s76-a10',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal opening-phase checkpoint, seed review-corpus:76, hand 4, loss ~5.56.',
    seed: 'review-corpus:76',
    strategy: 'worst_legal',
    actionIndex: 10,
    expected: {
      preDigest: 'review-state-v1:fc12f6cc',
      postDigest: 'review-state-v1:23576e27',
      action: { kind: 'play', tile: { low: 1, high: 6 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s37-a13',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:37, hand 4, loss ~16.29.',
    seed: 'review-corpus:37',
    strategy: 'worst_legal',
    actionIndex: 13,
    expected: {
      preDigest: 'review-state-v1:b94e9be1',
      postDigest: 'review-state-v1:5549b275',
      action: { kind: 'play', tile: { low: 0, high: 6 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s38-a23',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:38, hand 4, loss ~15.80.',
    seed: 'review-corpus:38',
    strategy: 'worst_legal',
    actionIndex: 23,
    expected: {
      preDigest: 'review-state-v1:6af51ba0',
      postDigest: 'review-state-v1:0b4b5d94',
      action: { kind: 'play', tile: { low: 0, high: 6 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s31-a18',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:31, hand 4, loss ~14.00.',
    seed: 'review-corpus:31',
    strategy: 'worst_legal',
    actionIndex: 18,
    expected: {
      preDigest: 'review-state-v1:0530fab7',
      postDigest: 'review-state-v1:032621d1',
      action: { kind: 'play', tile: { low: 2, high: 5 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s27-a15',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:27, hand 4, loss ~11.91.',
    seed: 'review-corpus:27',
    strategy: 'worst_legal',
    actionIndex: 15,
    expected: {
      preDigest: 'review-state-v1:d64db6b5',
      postDigest: 'review-state-v1:d6829a70',
      action: { kind: 'play', tile: { low: 0, high: 5 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s63-a14',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:63, hand 4, loss ~11.70.',
    seed: 'review-corpus:63',
    strategy: 'worst_legal',
    actionIndex: 14,
    expected: {
      preDigest: 'review-state-v1:c48f4135',
      postDigest: 'review-state-v1:091a97d4',
      action: { kind: 'play', tile: { low: 0, high: 2 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s39-a13',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:39, hand 4, loss ~11.47.',
    seed: 'review-corpus:39',
    strategy: 'worst_legal',
    actionIndex: 13,
    expected: {
      preDigest: 'review-state-v1:a7665d28',
      postDigest: 'review-state-v1:66786511',
      action: { kind: 'play', tile: { low: 2, high: 5 }, position: 'branch-1-0' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s60-a15',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:60, hand 4, loss ~10.63.',
    seed: 'review-corpus:60',
    strategy: 'worst_legal',
    actionIndex: 15,
    expected: {
      preDigest: 'review-state-v1:609df99d',
      postDigest: 'review-state-v1:33f58a81',
      action: { kind: 'play', tile: { low: 5, high: 6 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s90-a18',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:90, hand 4, loss ~10.38.',
    seed: 'review-corpus:90',
    strategy: 'worst_legal',
    actionIndex: 18,
    expected: {
      preDigest: 'review-state-v1:f44cf49d',
      postDigest: 'review-state-v1:0dc44e54',
      action: { kind: 'play', tile: { low: 3, high: 6 }, position: 'branch-1-0' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s47-a15',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:47, hand 4, loss ~10.00.',
    seed: 'review-corpus:47',
    strategy: 'worst_legal',
    actionIndex: 15,
    expected: {
      preDigest: 'review-state-v1:61356ae1',
      postDigest: 'review-state-v1:79edf444',
      action: { kind: 'play', tile: { low: 0, high: 5 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s45-a14',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:45, hand 4, loss ~9.81.',
    seed: 'review-corpus:45',
    strategy: 'worst_legal',
    actionIndex: 14,
    expected: {
      preDigest: 'review-state-v1:6cbb3c5b',
      postDigest: 'review-state-v1:65ed0341',
      action: { kind: 'play', tile: { low: 4, high: 5 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s25-a16',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:25, hand 4, loss ~9.62.',
    seed: 'review-corpus:25',
    strategy: 'worst_legal',
    actionIndex: 16,
    expected: {
      preDigest: 'review-state-v1:c2a59422',
      postDigest: 'review-state-v1:682bfbfc',
      action: { kind: 'play', tile: { low: 0, high: 6 }, position: 'branch-0-0' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s93-a17',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:93, hand 4, loss ~8.88.',
    seed: 'review-corpus:93',
    strategy: 'worst_legal',
    actionIndex: 17,
    expected: {
      preDigest: 'review-state-v1:cfe846ed',
      postDigest: 'review-state-v1:72c630ad',
      action: { kind: 'play', tile: { low: 4, high: 6 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s44-a17',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:44, hand 4, loss ~8.08.',
    seed: 'review-corpus:44',
    strategy: 'worst_legal',
    actionIndex: 17,
    expected: {
      preDigest: 'review-state-v1:619afa76',
      postDigest: 'review-state-v1:d322cdc7',
      action: { kind: 'play', tile: { low: 2, high: 6 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s14-a21',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:14, hand 4, loss ~7.79.',
    seed: 'review-corpus:14',
    strategy: 'worst_legal',
    actionIndex: 21,
    expected: {
      preDigest: 'review-state-v1:450f4166',
      postDigest: 'review-state-v1:db46f336',
      action: { kind: 'play', tile: { low: 0, high: 1 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s42-a14',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:42, hand 4, loss ~7.69.',
    seed: 'review-corpus:42',
    strategy: 'worst_legal',
    actionIndex: 14,
    expected: {
      preDigest: 'review-state-v1:bdaac125',
      postDigest: 'review-state-v1:e8ed3c2f',
      action: { kind: 'play', tile: { low: 3, high: 5 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s20-a14',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:20, hand 4, loss ~7.67.',
    seed: 'review-corpus:20',
    strategy: 'worst_legal',
    actionIndex: 14,
    expected: {
      preDigest: 'review-state-v1:5cdf8913',
      postDigest: 'review-state-v1:0092888e',
      action: { kind: 'play', tile: { low: 1, high: 6 }, position: 'branch-0-0' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s64-a15',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:64, hand 4, loss ~7.56.',
    seed: 'review-corpus:64',
    strategy: 'worst_legal',
    actionIndex: 15,
    expected: {
      preDigest: 'review-state-v1:4bb0d590',
      postDigest: 'review-state-v1:3bab2fb9',
      action: { kind: 'play', tile: { low: 2, high: 6 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s76-a14',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:76, hand 4, loss ~7.49.',
    seed: 'review-corpus:76',
    strategy: 'worst_legal',
    actionIndex: 14,
    expected: {
      preDigest: 'review-state-v1:884eddb0',
      postDigest: 'review-state-v1:8372e204',
      action: { kind: 'play', tile: { low: 4, high: 5 }, position: 'branch-1-0' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s74-a13',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:74, hand 4, loss ~7.44.',
    seed: 'review-corpus:74',
    strategy: 'worst_legal',
    actionIndex: 13,
    expected: {
      preDigest: 'review-state-v1:b6cfa15f',
      postDigest: 'review-state-v1:8d912ee2',
      action: { kind: 'play', tile: { low: 3, high: 4 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-midgame-s80-a23',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal midgame-phase checkpoint, seed review-corpus:80, hand 4, loss ~7.28.',
    seed: 'review-corpus:80',
    strategy: 'worst_legal',
    actionIndex: 23,
    expected: {
      preDigest: 'review-state-v1:e41172f2',
      postDigest: 'review-state-v1:84b9aa78',
      action: { kind: 'play', tile: { low: 1, high: 5 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-endgame-s54-a31',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal endgame-phase checkpoint, seed review-corpus:54, hand 4, loss ~23.00.',
    seed: 'review-corpus:54',
    strategy: 'worst_legal',
    actionIndex: 31,
    expected: {
      preDigest: 'review-state-v1:f933f83f',
      postDigest: 'review-state-v1:c2cd15f4',
      action: { kind: 'play', tile: { low: 3, high: 4 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-endgame-s78-a27',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal endgame-phase checkpoint, seed review-corpus:78, hand 4, loss ~13.00.',
    seed: 'review-corpus:78',
    strategy: 'worst_legal',
    actionIndex: 27,
    expected: {
      preDigest: 'review-state-v1:eb378b86',
      postDigest: 'review-state-v1:a12cde18',
      action: { kind: 'play', tile: { low: 0, high: 6 }, position: 'branch-1-1' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-endgame-s22-a12',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal endgame-phase checkpoint, seed review-corpus:22, hand 4, loss ~12.00.',
    seed: 'review-corpus:22',
    strategy: 'worst_legal',
    actionIndex: 12,
    expected: {
      preDigest: 'review-state-v1:ffe5c621',
      postDigest: 'review-state-v1:86acf579',
      action: { kind: 'play', tile: { low: 2, high: 5 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-endgame-s77-a27',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal endgame-phase checkpoint, seed review-corpus:77, hand 4, loss ~11.21.',
    seed: 'review-corpus:77',
    strategy: 'worst_legal',
    actionIndex: 27,
    expected: {
      preDigest: 'review-state-v1:3945d409',
      postDigest: 'review-state-v1:1a94a73b',
      action: { kind: 'play', tile: { low: 4, high: 6 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-endgame-s11-a24',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal endgame-phase checkpoint, seed review-corpus:11, hand 4, loss ~9.00.',
    seed: 'review-corpus:11',
    strategy: 'worst_legal',
    actionIndex: 24,
    expected: {
      preDigest: 'review-state-v1:03565ce2',
      postDigest: 'review-state-v1:f2d116fc',
      action: { kind: 'play', tile: { low: 3, high: 5 }, position: 'right' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-endgame-s10-a24',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal endgame-phase checkpoint, seed review-corpus:10, hand 4, loss ~7.00.',
    seed: 'review-corpus:10',
    strategy: 'worst_legal',
    actionIndex: 24,
    expected: {
      preDigest: 'review-state-v1:876f99f3',
      postDigest: 'review-state-v1:d779068d',
      action: { kind: 'play', tile: { low: 2, high: 4 }, position: 'left' },
      immediatePoints: 0,
    },
  },
  {
    id: 'deliberately-poor-endgame-s69-a24',
    category: 'deliberately_poor',
    description: 'C2a-1 follow-up: worst_legal endgame-phase checkpoint, seed review-corpus:69, hand 4, loss ~7.00.',
    seed: 'review-corpus:69',
    strategy: 'worst_legal',
    actionIndex: 24,
    expected: {
      preDigest: 'review-state-v1:df9b2c14',
      postDigest: 'review-state-v1:c677c441',
      action: { kind: 'play', tile: { low: 5, high: 6 }, position: 'left' },
      immediatePoints: 0,
    },
  },
] as const;

function createFixtureInitialState(seed: string): GameState {
  const deal = createDeterministicDoubleSixDeal({ seed, tilesPerPlayer: 7 });
  return {
    config: { ...DEFAULT_CONFIG },
    playerIds: ['player', 'opponent'],
    players: {
      player: { id: 'player', hand: deal.playerTiles, score: 48 },
      opponent: { id: 'opponent', hand: deal.opponentTiles, score: 52 },
    },
    board: null,
    boneyard: deal.boneyard,
    deadTiles: deal.deadTiles,
    currentPlayerIndex: 0,
    handNumber: 4,
    handOpen: false,
    handOver: false,
    gameOver: false,
    winnerId: null,
    consecutivePasses: 0,
    sequence: 40,
    handStarters: ['opponent', 'player', 'opponent', 'player'],
  };
}

function chooseFixtureCommand(state: GameState, strategy: FixtureStrategy): GameCommand {
  const actorId = state.playerIds[state.currentPlayerIndex];
  const legal = getLegalMoves(state, actorId);
  const plays = legal.filter((move): move is PlayMove => move.type === 'play');

  if (plays.length > 0) {
    const ranked = plays
      .map((move) => {
        const preview = applyGameCommand(state, {
          version: 1,
          commandId: `fixture-preview:${state.sequence}`,
          sequence: state.sequence,
          actorId,
          kind: 'play',
          tile: move.tile,
          position: move.position,
        }).state;
        const strategicWeight = (move.position.startsWith('branch-') ? 1_000 : 0)
          + (move.tile.low === move.tile.high ? 500 : 0)
          + (preview.board?.hubDoubles.filter((hub) => hub.laneType === 'branch').length ?? 0) * 300
          + (preview.board ? computePlayScore(preview.board, state.config) * 50 : 0);
        const strategyScore = strategy === 'branch_builder'
          ? strategicWeight
          // Mirrors branch_builder's own weighting (branch play, doubles, new
          // branch hubs, immediate score) but inverted -- ranked[0] (the
          // highest strategyScore, per the shared sort below) becomes the
          // move with the LEAST strategic/scoring value among the legal
          // options, i.e. deliberately poor play rather than deliberately
          // strong play. Used only for the deliberately_poor fixture
          // category (C2a-1).
          : strategy === 'worst_legal'
          ? -strategicWeight
          : 0;
        return { move, strategyScore };
      })
      .sort((a, b) =>
        b.strategyScore - a.strategyScore
        || compareCodeUnits(a.move.position, b.move.position)
        || a.move.tile.low - b.move.tile.low
        || a.move.tile.high - b.move.tile.high,
      );
    const move = ranked[0].move;
    return {
      version: 1,
      commandId: `fixture:${state.sequence}`,
      sequence: state.sequence,
      actorId,
      kind: 'play',
      tile: move.tile,
      position: move.position,
    };
  }

  if (legal.some((move) => move.type === 'pass')) {
    return {
      version: 1,
      commandId: `fixture:${state.sequence}`,
      sequence: state.sequence,
      actorId,
      kind: 'pass',
    };
  }

  if (!canDraw(state, actorId)) throw new Error(`Fixture log has no legal action at sequence ${state.sequence}.`);
  return {
    version: 1,
    commandId: `fixture:${state.sequence}`,
    sequence: state.sequence,
    actorId,
    kind: 'draw',
  };
}

function recordMissingPipEvidence(
  state: GameState,
  command: GameCommand,
  evidence: ReviewKnownMissingPipEvidence[],
): void {
  if (command.kind !== 'draw' && command.kind !== 'pass') return;
  const openEnds = getOpenEnds(state.board).map((end) => end.matchValue);
  for (const pip of new Set(openEnds)) {
    evidence.push({
      opponentId: command.actorId,
      pip,
      reason: command.kind === 'pass' ? 'passed_on_open_end' : 'drew_past_open_end',
      observedHandNumber: state.handNumber,
      observedSequence: state.sequence,
      openEnds,
    });
  }
}

function buildFixture(spec: ReviewFixtureSpec): ReviewCorpusFixture {
  let state = createFixtureInitialState(spec.seed);
  const evidence: ReviewKnownMissingPipEvidence[] = [];

  for (let actionIndex = 0; actionIndex <= spec.actionIndex; actionIndex += 1) {
    if (state.handOver || state.gameOver) {
      throw new Error(`${spec.id} terminated before selected action ${spec.actionIndex}.`);
    }
    const command = chooseFixtureCommand(state, spec.strategy);
    if (actionIndex === spec.actionIndex) {
      const opponentId = state.playerIds.find((id) => id !== command.actorId)!;
      const snapshot = createReviewPositionSnapshotV2({
        authorityPreState: state,
        command,
        identifiers: {
          sessionId: `fixture-session:${spec.seed}`,
          gameId: `fixture-game:${spec.seed}`,
          handId: `fixture-game:${spec.seed}:hand-${state.handNumber}`,
          decisionId: spec.id,
          mode: 'fixture',
          gameNumber: 1,
          actionNumber: actionIndex + 1,
        },
        knownMissingPipEvidence: evidence.filter((item) => item.opponentId === opponentId),
      });
      if (
        snapshot.integrity.authorityPreStateDigest !== spec.expected.preDigest
        || snapshot.integrity.authorityPostStateDigest !== spec.expected.postDigest
        || JSON.stringify(snapshot.actualAction) !== JSON.stringify(spec.expected.action)
        || snapshot.outcome.immediatePoints !== spec.expected.immediatePoints
      ) {
        throw new Error(`${spec.id} drifted from its checked-in game-log checkpoint.`);
      }
      return {
        id: spec.id,
        category: spec.category,
        description: spec.description,
        snapshot,
        authorityPreState: state,
        provenance: {
          kind: 'deterministic-game-log',
          seed: spec.seed,
          strategy: spec.strategy,
          selectedActionIndex: spec.actionIndex,
          startingHandNumber: 4,
          startingScores: { player: 48, opponent: 52 },
        },
      };
    }
    recordMissingPipEvidence(state, command, evidence);
    state = applyGameCommand(state, command).state;
    const violations = collectGameStateViolations(state);
    if (violations.length > 0) throw new Error(`${spec.id} generated invalid state: ${violations.join('; ')}`);
  }
  throw new Error(`Fixture ${spec.id} did not reach its selected action.`);
}

export const REVIEW_FIXTURE_CORPUS: readonly ReviewCorpusFixture[] = FIXTURE_SPECS.map(buildFixture);
