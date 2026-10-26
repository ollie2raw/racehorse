import { describe, expect, it } from 'vitest';
import type { BoardState } from '../../types.ts';
import {
  playGame,
  VARIANTS,
  type Policy,
} from '../../../../packages/game-core/src/__tests__/support/engineHarness';
import { FIXTURES } from './boardRoutingFixtures.ts';
import { computeBoardLayout } from './boardLayout.ts';
import {
  READABILITY_CANDIDATES_PX,
  VIEWPORT_PROFILES,
  countBoardTiles,
  layoutOptionsFor,
  measureHand,
  modelCameraFit,
  summarize,
  type PlacementSample,
  type ViewportProfile,
} from './boardQualityMetrics.ts';

const profile = (name: string): ViewportProfile => {
  const found = VIEWPORT_PROFILES.find((p) => p.name === name);
  if (!found) throw new Error(`unknown profile ${name}`);
  return found;
};

describe('boardQualityMetrics: the model matches the browser', () => {
  // Scale the real camera produced for the `longBoth` fixture (19 tiles) in the browser
  // geometry report (e2e/board-routing-geometry.spec.ts, BOARD_GEOMETRY_REPORT=1). Phones were
  // 0.17 / 0.14 before Pass 1a (bend after 1 tile + exact drop-zone bounds).
  const measuredInBrowser: Array<[string, number]> = [
    ['desktop-1512x982', 0.29],
    ['laptop-1280x720', 0.28],
    ['phone-932x430', 0.3],
    ['phone-844x390', 0.26],
  ];
  for (const [name, browserScale] of measuredInBrowser) {
    it(`longBoth at ${name} fits at ~${browserScale}`, () => {
      const p = profile(name);
      const board = FIXTURES.longBoth();
      const layout = computeBoardLayout(board, [], layoutOptionsFor(p));
      const fit = modelCameraFit(layout, countBoardTiles(board), p);
      expect(Math.abs(fit.scale - browserScale)).toBeLessThanOrEqual(0.02);
    });
  }
});

describe('boardQualityMetrics: measureHand', () => {
  it('reports no jump for the first tile and counts only placements', () => {
    const p = profile('desktop-1512x982');
    const samples = measureHand([FIXTURES.longBoth()], p);
    expect(samples).toHaveLength(1);
    expect(samples[0].maxTileJumpPx).toBe(0);
    expect(samples[0].tileCount).toBe(countBoardTiles(FIXTURES.longBoth()));
  });

  it('ignores repeated states with no new tile', () => {
    const p = profile('desktop-1512x982');
    const board: BoardState = FIXTURES.longBoth();
    expect(measureHand([board, board, board], p)).toHaveLength(1);
  });
});

describe('boardQualityMetrics: summarize', () => {
  const sample = (over: Partial<PlacementSample>): PlacementSample => ({
    tileCount: 5,
    scale: 0.3,
    tileShortEdgePx: 21.6,
    rawTileEdgePx: 21.6,
    widthNeedAtFloor: 0.5,
    heightNeedAtFloor: 0.5,
    overflowed: false,
    fillRatio: 0.8,
    maxTileJumpPx: 0,
    reflowedTiles: 0,
    scaleStepPct: 0,
    bends: 0,
    ...over,
  });

  it('computes shares and percentiles', () => {
    const s = summarize([
      sample({ tileShortEdgePx: 10, overflowed: true, maxTileJumpPx: 100, reflowedTiles: 2 }),
      sample({ tileShortEdgePx: 30 }),
      sample({ tileShortEdgePx: 30 }),
      sample({ tileShortEdgePx: 30 }),
    ]);
    expect(s.placements).toBe(4);
    expect(s.tileEdgeMin).toBe(10);
    expect(s.underPx[12]).toBeCloseTo(0.25);
    expect(s.underPx[24]).toBeCloseTo(0.25);
    expect(s.overflowShare).toBeCloseTo(0.25);
    expect(s.bigJumpShare).toBeCloseTo(0.25);
    expect(s.reflowShare).toBeCloseTo(0.25);
    expect(s.jumpMax).toBe(100);
  });

  it('is all zeros for no samples', () => {
    const s = summarize([]);
    expect(s.placements).toBe(0);
    expect(s.overflowShare).toBe(0);
    expect(s.tileEdgeMin).toBe(0);
  });
});

// ─── baseline report (opt-in) ────────────────────────────────
//
//   BOARD_CAMERA_REPORT=1 npx vitest run src/components/board/boardQualityMetrics.test.ts
//
// Replays seeded engine games (the same corpus recipe the routing tests use) through
// every viewport profile and prints one table. It is a measurement tool, not a gate.

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const POLICIES: Policy[] = ['random', 'scoreGreedy', 'doubles', 'branch'];
const GAMES_PER_POLICY = Number(env.BOARD_CAMERA_GAMES ?? 8);

function* hands(): Generator<BoardState[]> {
  for (const variant of VARIANTS.slice(0, 2)) {
    for (const policy of POLICIES) {
      for (let g = 0; g < GAMES_PER_POLICY; g += 1) {
        const run = playGame(`board-camera-baseline-v1:${variant.name}:${policy}:${g}`, variant, policy, { keepStates: true });
        let current: BoardState[] = [];
        let lastCount = 0;
        for (const state of run.states) {
          const board = state.board as unknown as BoardState | null;
          const count = countBoardTiles(board);
          if (count < lastCount) {
            if (current.length > 0) yield current;
            current = [];
          }
          if (board && count > 0) current.push(board);
          lastCount = count;
        }
        if (current.length > 0) yield current;
      }
    }
  }
}

const fmt = (n: number, d = 1) => n.toFixed(d);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

describe.skipIf(!env.BOARD_CAMERA_REPORT)('board camera baseline report', () => {
  it('prints the baseline table', () => {
    const allHands = [...hands()];
    const rows: string[] = [];
    for (const p of VIEWPORT_PROFILES) {
      const samples = allHands.flatMap((h) => measureHand(h, p));
      const s = summarize(samples);
      const late = summarize(samples.filter((x) => x.tileCount >= 14));
      rows.push(
        [
          `BASELINE|${p.name}`,
          `hands=${allHands.length} placements=${s.placements}`,
          `tileEdgePx min/p5/p50=${fmt(s.tileEdgeMin)}/${fmt(s.tileEdgeP5)}/${fmt(s.tileEdgeP50)}`,
          `late(>=14 tiles) p5/p50=${fmt(late.tileEdgeP5)}/${fmt(late.tileEdgeP50)}`,
          `under ${READABILITY_CANDIDATES_PX.map((px) => `${px}px:${pct(s.underPx[px])}`).join(' ')}`,
          `overflow=${pct(s.overflowShare)}`,
          `cannotBeWholeAndReadable(<18px)=${pct(s.unreadableShare)} (byHeight=${pct(s.unreadableByHeight)} byWidth=${pct(s.unreadableByWidth)})`,
          `jumpPx p50/p95/max=${fmt(s.jumpP50)}/${fmt(s.jumpP95)}/${fmt(s.jumpMax)} bigJump(>40px)=${pct(s.bigJumpShare)}`,
          `reflow=${pct(s.reflowShare)}`,
          `scaleStep% p95/max=${fmt(s.scaleStepP95)}/${fmt(s.scaleStepMax)}`,
        ].join(' | '),
      );
    }
    console.warn(`\n${rows.join('\n')}\n`);
    expect(rows).toHaveLength(VIEWPORT_PROFILES.length);
  });
});
