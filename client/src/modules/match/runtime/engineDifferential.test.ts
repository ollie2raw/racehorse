/**
 * The client match engine against @racehorse/game-core, step by step, on thousands of seeded games (roadmap 4.x; REFACTOR_OPPORTUNITIES D3).
 *
 * The client delegates plays, draws, passes and scoring to game-core through gameCoreAdapter, but keeps its own open-end
 * matching, move previews and hand-end report. engineDifferential.ts plays whole matches through the client wrappers while an
 * independent game-core state machine runs beside it on the same deals and moves, and compares legal moves, placement targets,
 * previews against what really happens, the full state after every transition, and the hand-end report against the real score
 * movement. Six rule variants are covered: standard, a short game, a 14-tile deal, no-score blocked hands, no end bonus, and a scoring multiple of 10.
 *
 * This file does not change either engine. Anything the two disagree on is either listed in KNOWN below, with the reason and a
 * seed that reproduces it, or the run fails and names the seed, step and both values.
 *
 * Default is quick (a few hundred games, a few seconds; CI is about 4x slower). For a deeper run:
 *   ENGINE_DIFF_GAMES=1000 npx vitest run src/modules/match/runtime/engineDifferential.test.ts
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DIFFERENTIAL_VARIANTS,
  playDifferentialGame,
  runDifferential,
  type Divergence,
  type DifferentialSummary,
} from './engineDifferential.ts';
import { createFixedBotMatch, getLegalMoves, getPlacementTargetsForTile } from './botEngine.ts';

declare const process: { env: Record<string, string | undefined> };

const GAMES_PER_VARIANT = Math.max(1, Number(process.env.ENGINE_DIFF_GAMES ?? 50));

interface KnownDivergence {
  readonly kind: string;
  readonly reason: string;
  /** A game that reproduces it. When the divergence is fixed this stops reproducing: delete the entry and the fixed test below. */
  readonly variant: string;
  readonly seed: number;
}

/**
 * What the two sides are known to disagree on. None of these changes who wins a match or any score: the first three are in the
 * hand-end report the client builds for display, the fourth is a preview flag that the engine overrides inside the same move.
 */
const KNOWN: readonly KnownDivergence[] = [
  {
    kind: 'handEndedWinnerInferredFromScoreMovement',
    reason:
      'gameCoreAdapter.handEndDetails names the hand winner as whoever gained more score across the move. When a player goes out (or wins a ' +
      'blocked hand on pips) and no score moves at all, the report says there is no winner. That happens when the final play scores 0 and ' +
      'the bonus rounds to 0 (the loser holds 1 or 2 pips, round(x/5) = 0) under the default rules, and on every non-scoring go-out under ' +
      "endHandBonus 'none'. The report is read by lessonV2 and the guided-match capture.",
    variant: 'standard-7',
    seed: 1,
  },
  {
    kind: 'handEndedLoserPipsFromNullWinner',
    reason:
      "A consequence of the one above: with no winner named, handEndDetails measures the loser's pips on the wrong hand ('you' by default), " +
      'so loserPips and the calcText are for the wrong player.',
    variant: 'standard-7',
    seed: 1,
  },
  {
    kind: 'handEndedPointsIgnoresEndHandBonusNone',
    reason:
      "Under endHandBonus 'none' game-core awards no go-out bonus, but handEndDetails still computes pointsAwarded from the loser's hand " +
      '(computeGoOutBonusPoints ignores the setting), so the report claims points that were never awarded. Only reachable through a rule override (Journey).',
    variant: 'bonus-none',
    seed: 3,
  },
  {
    kind: 'previewTurnContinuesButEngineAutoPassed',
    reason:
      'previewPlayMove.turnContinues is the rule ("a scoring play or a double keeps your turn"). After such a play with nothing playable, game-core runs ' +
      'the forced-draw chain and, if no draw finds a play, passes the turn inside the same move. The bot search models the no-move case itself ' +
      '(minimaxFull draws or passes at the next node), so it lands in the same place; recorded so nobody reads the flag as the engine\'s outcome.',
    variant: 'standard-7',
    seed: 2,
  },
];

const knownKinds = new Set(KNOWN.map((entry) => entry.kind));
const describeDivergence = (d: Divergence) =>
  `${d.variant} seed ${d.seed} hand ${d.handNumber} step ${d.step} [${d.kind}] ${d.detail}: client=${JSON.stringify(d.client)} core=${JSON.stringify(d.core)}`;

describe('client engine vs game-core: seeded differential', () => {
  // Played once for the whole describe, inside beforeAll so the explicit timeout covers it (CI runs this about 4x slower than a laptop).
  let summary: DifferentialSummary;
  beforeAll(() => {
    summary = runDifferential(GAMES_PER_VARIANT, 1);
  }, 300_000);

  it(
    'plays every game to the end, on every rule variant',
    () => {
      expect(summary.games).toBe(GAMES_PER_VARIANT * DIFFERENTIAL_VARIANTS.length);
      expect(summary.unfinished).toBe(0);
      expect(summary.steps).toBeGreaterThan(summary.games * 20);
    },
    120_000,
  );

  it(
    'agrees with game-core on legal moves, placement targets, previews, state after every step, and hand ends, except for the known differences',
    () => {
      const unexpected = summary.divergences.filter((d) => !knownKinds.has(d.kind));
      expect(unexpected.slice(0, 5).map(describeDivergence)).toEqual([]);
    },
    120_000,
  );

  it('reached the positions that matter (a green run that never drew, passed, branched or blocked proves nothing)', () => {
    const { coverage } = summary;
    expect(coverage.plays).toBeGreaterThan(0);
    expect(coverage.scoringPlays).toBeGreaterThan(0);
    expect(coverage.doublePlays).toBeGreaterThan(0);
    expect(coverage.branchPlays).toBeGreaterThan(0);
    expect(coverage.drawSequences).toBeGreaterThan(0);
    expect(coverage.passes).toBeGreaterThan(0);
    expect(coverage.handsWentOut).toBeGreaterThan(0);
    expect(coverage.handsBlocked).toBeGreaterThan(0);
    // Every legal play at every step is previewed, not only the one taken.
    expect(coverage.previewsChecked).toBeGreaterThan(coverage.plays);
  });

  it('is deterministic: the same seed plays the same game and reports the same thing', () => {
    const a = playDifferentialGame(7, DIFFERENTIAL_VARIANTS[0]);
    const b = playDifferentialGame(7, DIFFERENTIAL_VARIANTS[0]);
    expect(b).toEqual(a);
  });
});

describe('known differences (each reproduces from a seed; fix it, then delete its entry)', () => {
  it.each(KNOWN)('$kind', ({ kind, variant, seed, reason }) => {
    const definition = DIFFERENTIAL_VARIANTS.find((v) => v.name === variant)!;
    expect(definition).toBeDefined();
    expect(reason.length).toBeGreaterThan(40);
    const reproduced = playDifferentialGame(seed, definition).divergences.filter((d) => d.kind === kind);
    expect(reproduced.length).toBeGreaterThan(0);
  });

  it('the default-rules case is a hand won by a player who held 1 or 2 pips, not only a rule override', () => {
    const report = playDifferentialGame(1, DIFFERENTIAL_VARIANTS[0]);
    const loserPips = report.divergences.find((d) => d.kind === 'handEndedLoserPipsFromNullWinner');
    expect(loserPips).toBeDefined();
    // The loser held 2 pips, so the go-out bonus round(2/5) is 0, and the going-out play scored nothing.
    expect(loserPips!.core).toBeLessThan(3);
  });

  it('opening placement targets are geometry, not legality: any tile "fits" an empty board, while game-core lists only doubles and scoring openers', () => {
    // So callers must take opening legality from getLegalMoves; the differential compares targets only once the hand is open.
    const state = createFixedBotMatch(
      {
        player_tiles: [
          { low: 0, high: 1 },
          { low: 2, high: 3 },
          { low: 4, high: 5 },
          { low: 1, high: 6 },
          { low: 0, high: 2 },
          { low: 3, high: 4 },
          { low: 5, high: 6 },
        ],
        fritz_tiles: [
          { low: 0, high: 3 },
          { low: 1, high: 2 },
          { low: 4, high: 6 },
          { low: 0, high: 5 },
          { low: 1, high: 4 },
          { low: 2, high: 5 },
          { low: 3, high: 6 },
        ],
        boneyard: [],
        locked: [],
      },
      60,
      7,
    );
    const openers = new Set(
      getLegalMoves(state, 'you')
        .filter((m) => m.type === 'play')
        .map((m) => `${m.tile!.low}-${m.tile!.high}`),
    );
    let sawNonOpener = false;
    for (const tile of state.players.you.hand) {
      if (openers.has(`${tile.low}-${tile.high}`)) continue;
      sawNonOpener = true;
      expect(getPlacementTargetsForTile(null, tile)).toEqual(['left']);
    }
    expect(sawNonOpener).toBe(true);
  });
});
