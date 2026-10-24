// @vitest-environment jsdom
/**
 * Presentation-lock ownership under restart / supersession / unmount.
 * Drives the real useBotTurnEffect through the forced-draw harness with a long per-tile beat so
 * a stale continuation wakes up long after a newer sequence has taken over.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEmbeddedChainFixture, POOL_TILES } from './embeddedChainFixture.ts';
import { buildFiveFiveForcedDrawFixture } from './forcedDrawFixture.ts';
import {
  createMatchStore,
  useForcedDrawHarness,
  type HarnessControls,
  type VisibleModel,
} from './forcedDrawHarness.tsx';
import type { BotMatchState } from '../match/runtime/botEngine.ts';

type ProbeProps = Parameters<typeof useForcedDrawHarness>[0] & { frames: VisibleModel[] };

function Probe({ frames, ...rest }: ProbeProps) {
  const model = useForcedDrawHarness(rest);
  frames.push({ ...model });
  return null;
}

const P = (a: number, b: number) =>
  POOL_TILES.find((t) => t.low === Math.min(a, b) && t.high === Math.max(a, b))!;
const chain = (humanHoldsFive = true) =>
  buildEmbeddedChainFixture({
    fritzPool: [P(0, 2), P(0, 3)],
    boneyardPool: [P(0, 4), P(2, 2), P(2, 4)],
    humanHoldsFive,
  });

async function advance(ms: number, slice = 25) {
  for (let t = 0; t < ms; t += slice) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(slice);
    });
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const BEAT = 5_000;

function mount(initial: BotMatchState, extra: Partial<ProbeProps> = {}) {
  const store = createMatchStore(initial);
  const frames: VisibleModel[] = [];
  const steps: Array<[string, number]> = [];
  const controlsRef: { current: HarnessControls | null } = { current: null };
  const view = render(
    <Probe
      store={store}
      frames={frames}
      drawStepMs={BEAT}
      controlsRef={controlsRef}
      onVisualStep={(p, n) => steps.push([p, n])}
      onRender={() => {}}
      {...extra}
    />,
  );
  return { store, frames, steps, controlsRef, view };
}

/** Time until Fritz has played, the engine has handed the turn over, and the first beat is open. */
const TO_FIRST_BEAT = 560 + 1000 + 300;

describe('embedded presentation ownership', () => {
  it('a stale finally from restarted sequence A cannot release newer sequence B', async () => {
    const { store, frames, steps, controlsRef } = mount(chain());
    await advance(TO_FIRST_BEAT);
    // A has committed (engine says human) and is holding the lock in its first beat
    expect(store.get().currentPlayer).toBe('you');
    expect(frames[frames.length - 1]!.drawSequenceActive).toBe(true);

    // restart in place: invalidate (clears the lock) and deal a fresh embedded position (B)
    act(() => {
      controlsRef.current!.invalidateLocalRuns();
      // B: a bigger Fritz rack so any stale write from A (hand sizes 2-5) is distinguishable
      store.set(
        buildEmbeddedChainFixture({
          fritzPool: [P(0, 2), P(0, 3), P(3, 3), P(3, 4), P(6, 6)],
          boneyardPool: [P(0, 4), P(2, 2), P(2, 4)],
          humanHoldsFive: true,
        }),
      );
    });
    const stepsAtRestart = steps.length;
    // B: handoff 560 + opening 1000, then seeds ownership and starts its own beats
    await advance(560 + 1000 + 300);
    expect(frames[frames.length - 1]!.drawSequenceActive).toBe(true);

    // A's beat (5s) wakes now while B is mid-beat: it must neither step nor release B's lock
    const seen = steps.length;
    await advance(BEAT - 560 - 1000 - 300 + 400);
    const lastBotIdx = frames.map((f) => f.currentPlayer).lastIndexOf('bot');
    const aWake = frames.slice(lastBotIdx + 1); // B's committed frames only
    expect(aWake.length).toBeGreaterThan(0);
    expect(aWake.every((f) => f.drawSequenceActive)).toBe(true);
    expect(aWake.every((f) => f.botTurn)).toBe(true); // UI still shows Fritz's turn for B
    expect(aWake.every((f) => !f.humanCanAct)).toBe(true);
    // A made no overlay writes after being superseded; only B's first-step writes exist
    expect(steps.slice(stepsAtRestart).every(([, n]) => n >= 5)).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(seen);

    // B completes in order and releases exactly once
    await advance(BEAT * 6);
    const final = frames[frames.length - 1]!;
    expect(final.humanCanAct).toBe(true);
    expect(final.fritzRackCount).toBe(8); // 5 held + 3 drawn
    const rises = frames.filter((f, i) => i > 0 && f.humanCanAct && !frames[i - 1]!.humanCanAct);
    expect(rises).toHaveLength(1); // only B's release ever enables the human
  });

  it('restart mid-presentation leaves no stale overlay writes on the replacement match', async () => {
    const { store, frames, steps, controlsRef } = mount(chain());
    await advance(TO_FIRST_BEAT);
    const before = steps.length;
    act(() => {
      controlsRef.current!.invalidateLocalRuns();
      // replacement: plain standalone blocked draw (fritz 7-tile hand), not an embedded chain
      store.set(buildFiveFiveForcedDrawFixture({ boneyardSize: 4 }));
    });
    await advance(BEAT * 4);
    // after the restart only the replacement's draws (hand sizes 8, 9) are ever written
    const after = steps.slice(before);
    expect(after.every(([, n]) => n >= 8)).toBe(true);
    expect(frames[frames.length - 1]!.humanCanAct).toBe(true);
    expect(store.get().currentPlayer).toBe('you');
  });

  it('unmount during a held animation barrier: no warnings, no further writes, no stuck lock on remount', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = mount(chain());
    await advance(TO_FIRST_BEAT);
    const writes = a.steps.length;
    a.view.unmount();
    await advance(BEAT * 5);
    expect(a.steps.length).toBe(writes); // stale continuation wrote nothing after unmount
    expect(errors).not.toHaveBeenCalled();

    // re-enter the game: fresh instance, fresh lock, plays out cleanly exactly once
    const b = mount(chain());
    await advance(BEAT * 8);
    const final = b.frames[b.frames.length - 1]!;
    expect(final.humanCanAct).toBe(true);
    expect(final.drawSequenceActive).toBe(false);
    expect(final.fritzRackCount).toBe(5);
    const writesB = b.steps.map(([, n]) => n);
    expect(writesB).toEqual([...writesB].sort((x, y) => x - y)); // monotone: no replay/duplicate
    expect(new Set(writesB).size).toBeGreaterThanOrEqual(3);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('re-render and reschedule never start a second presentation', async () => {
    const { frames, steps, view, store } = mount(chain());
    await advance(TO_FIRST_BEAT);
    for (let i = 0; i < 4; i += 1) {
      view.rerender(
        <Probe
          store={store}
          frames={frames}
          drawStepMs={BEAT}
          onVisualStep={(p, n) => steps.push([p, n])}
          onRender={() => {}}
        />,
      );
    }
    await advance(BEAT * 6);
    const counts = steps.filter(([p]) => p === 'bot').map(([, n]) => n);
    // post-play seed (2) then draws 3,4,5 — each value written once, in order
    expect([...new Set(counts)]).toEqual([2, 3, 4, 5]);
    expect(counts).toEqual([...counts].sort((x, y) => x - y)); // never rewinds
    expect(frames[frames.length - 1]!.fritzRackCount).toBe(5);
  });
});
