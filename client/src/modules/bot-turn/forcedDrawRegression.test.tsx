// @vitest-environment jsdom
/**
 * Normal Fritz turn regression matrix (Play vs Fritz + Daily Fritz share the bot-turn spine).
 * Pacing is pinned to the pre-fix baseline (fc864689): release time and draw cadence of the
 * ordinary paths must be unchanged by the embedded-presentation ownership fix.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEmbeddedChainFixture, POOL_TILES } from './embeddedChainFixture.ts';
import { buildFiveFiveForcedDrawFixture } from './forcedDrawFixture.ts';
import { createMatchStore, useForcedDrawHarness, type VisibleModel } from './forcedDrawHarness.tsx';
import type { BotMatchState } from '../match/runtime/botEngine.ts';

type Frame = VisibleModel & { t: number };
let clock = 0;

function Probe(props: Parameters<typeof useForcedDrawHarness>[0] & { frames: Frame[] }) {
  const { frames, ...rest } = props;
  const model = useForcedDrawHarness(rest);
  frames.push({ ...model, t: clock });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 0;
});
afterEach(() => vi.useRealTimers());

const P = (a: number, b: number) =>
  POOL_TILES.find((t) => t.low === Math.min(a, b) && t.high === Math.max(a, b))!;

function fritzHoldsFive(s: BotMatchState): BotMatchState {
  // move the human's 5-6 to Fritz: an immediate, non-scoring legal play
  const five6 = s.players.you.hand.find((t) => t.low === 5 && t.high === 6)!;
  return {
    ...s,
    players: {
      you: { ...s.players.you, hand: s.players.you.hand.filter((t) => t !== five6) },
      bot: { ...s.players.bot, hand: [...s.players.bot.hand, five6] },
    },
  };
}

const SCENARIOS: Array<{ name: string; build: () => BotMatchState }> = [
  { name: 'immediate legal play', build: () => fritzHoldsFive(buildFiveFiveForcedDrawFixture({ boneyardSize: 6 })) },
  { name: 'draws one tile then plays', build: () => buildFiveFiveForcedDrawFixture({ boneyardSize: 6, playableAtBoneyardIndex: 0 }) },
  { name: 'draws several then plays', build: () => buildFiveFiveForcedDrawFixture({ boneyardSize: 8, playableAtBoneyardIndex: 3 }) },
  { name: 'draws to locked boneyard then passes', build: () => buildFiveFiveForcedDrawFixture({ boneyardSize: 5 }) },
  {
    name: 'embedded scoring forced draw',
    build: () =>
      buildEmbeddedChainFixture({
        fritzPool: [P(0, 2), P(0, 3)],
        boneyardPool: [P(0, 4), P(2, 2), P(2, 4)],
        humanHoldsFive: true,
      }),
  },
];

/**
 * Pinned from the pre-fix baseline (fc864689) for the four ordinary paths. The embedded path is
 * the one that intentionally changes: baseline released the human at 1560ms with the final rack
 * (the defect); it now releases after the three 861ms draw beats.
 */
const PINNED: Record<string, { releaseAt: number; releaseRack: number; lockFrames: number; racks: number[] }> = {
  'immediate legal play': { releaseAt: 1560, releaseRack: 7, lockFrames: 0, racks: [8] },
  'draws one tile then plays': { releaseAt: 3980, releaseRack: 7, lockFrames: 2, racks: [7, 8] },
  'draws several then plays': { releaseAt: 6560, releaseRack: 10, lockFrames: 5, racks: [7, 8, 9, 10, 11] },
  'draws to locked boneyard then passes': { releaseAt: 4800, releaseRack: 10, lockFrames: 3, racks: [7, 8, 9, 10] },
  'embedded scoring forced draw': { releaseAt: 4150, releaseRack: 5, lockFrames: 3, racks: [3, 4, 5] },
};

async function run(initial: BotMatchState, daily: boolean) {
  const store = createMatchStore(initial);
  const frames: Frame[] = [];
  render(<Probe store={store} frames={frames} drawStepMs={861} isDailyFritzMode={daily} onRender={() => {}} />);
  for (let i = 0; i < 4000; i += 1) {
    clock += 10;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
  }
  return frames;
}

describe.each([false, true])('normal Fritz turn regression matrix (daily=%s)', (daily) => {
  it.each(SCENARIOS)('$name', async ({ name, build }) => {
    const frames = await run(build(), daily);
    const release = frames.find((f) => f.humanCanAct)!;
    const lockFrames = frames.filter((f) => f.drawSequenceActive);
    const racks = frames.filter((f) => f.botTurn).map((f) => f.fritzRackCount);
    const summary = {
      releaseAt: release.t,
      releaseRack: release.fritzRackCount,
      lockFrames: lockFrames.length,
      racks: [...new Set(racks)],
    };
    expect(summary).toEqual(PINNED[name]);
    // exactly one release into the human's turn, and the lock is down at the end
    expect(frames.filter((f, i) => i > 0 && f.humanCanAct && !frames[i - 1]!.humanCanAct)).toHaveLength(1);
    expect(frames[frames.length - 1]!.drawSequenceActive).toBe(false);
  });
});
