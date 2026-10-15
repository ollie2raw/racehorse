// @vitest-environment jsdom
/**
 * 5/5 forced-draw sequencing — drives the REAL useBotTurnEffect, draw sequence and
 * overlay refs (useBotMatchRefs) and records every committed render's player-visible
 * model: Fritz rack size, boneyard count, whose turn the UI shows, and whether the
 * human can act (BotHandTray predicate). Rack DOM is rendered via the real HUD.
 */
import { act, render } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BotMatchLiveHudLeft } from '../../bot/view/hud/BotMatchLiveHud.tsx';
import { buildFiveFiveForcedDrawFixture } from './forcedDrawFixture.ts';
import { createMatchStore, useForcedDrawHarness, type VisibleModel } from './forcedDrawHarness.tsx';

type Frame = VisibleModel & { domRackTiles: number; html: string; boardTiles: number };

function Probe(props: Parameters<typeof useForcedDrawHarness>[0] & { frames: Frame[]; store: ReturnType<typeof createMatchStore> }) {
  const { frames, store, ...rest } = props;
  const model = useForcedDrawHarness({ ...rest, store, onRender: () => {} });
  const ref = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const match = store.get();
  useLayoutEffect(() => {
    const el = ref.current!;
    frames.push({
      ...model,
      domRackTiles: el.querySelectorAll('.rh-tile-rack__tile').length,
      html: el.innerHTML,
      boardTiles: match.board?.mainLine.length ?? 0,
    });
  });
  return (
    <div ref={ref}>
      <BotMatchLiveHudLeft
        opponentLabel="Fritz"
        ghostSubLabel={null}
        opponentPillRef={pillRef}
        match={match}
        botTurn={model.botTurn}
        onOpenScoreTrack={() => {}}
        drawStepBotHandCount={model.fritzRackCount === match.players.bot.hand.length ? null : model.fritzRackCount}
      />
    </div>
  );
}

/** Advance in slices, flushing React between each so intermediate commits are observable. */
async function advance(totalMs: number, sliceMs = 25) {
  for (let t = 0; t < totalMs; t += sliceMs) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(sliceMs);
    });
  }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(
  initial: ReturnType<typeof buildFiveFiveForcedDrawFixture>,
  drawStepMs = 800,
  isDailyFritzMode = true,
) {
  const store = createMatchStore(initial);
  const frames: Frame[] = [];
  const view = render(
    <Probe store={store} drawStepMs={drawStepMs} frames={frames} isDailyFritzMode={isDailyFritzMode} onRender={() => {}} />,
  );
  return { store, frames, view };
}

const humanEnabledTransitions = (frames: Frame[]) =>
  frames.reduce((n, f, i) => n + (f.humanCanAct && (i === 0 || !frames[i - 1].humanCanAct) ? 1 : 0), 0);

/** Rack count never moves by more than +1 between commits and never decreases mid-turn. */
function expectRackAdvancesOneAtATime(frames: Frame[], startCount: number) {
  let prev = startCount;
  for (const f of frames) {
    expect(f.domRackTiles).toBe(f.fritzRackCount);
    expect(f.fritzRackCount - prev).toBeGreaterThanOrEqual(0);
    expect(f.fritzRackCount - prev).toBeLessThanOrEqual(1);
    prev = f.fritzRackCount;
  }
}

function expectNoTileIdentitiesInDom(frames: Frame[]) {
  for (const f of frames) {
    expect(f.html).not.toMatch(/\d\s*[|\-/]\s*\d/);
    expect(f.html).not.toMatch(/data-tile|domino-tile|\[\d\|\d\]/i);
  }
}

describe('standalone blocked draw: both ends 5, no 5 anywhere Fritz can reach', () => {
  it.each([4, 6, 10])('boneyard %i: one visible draw per step, human enabled once, after the pass', async (size) => {
    const { store, frames } = setup(buildFiveFiveForcedDrawFixture({ boneyardSize: size }));
    await advance(30_000);
    const drawable = size - 2;
    const final = store.get();
    expect(final.currentPlayer).toBe('you');
    expect(final.players.bot.hand).toHaveLength(7 + drawable);
    expect(final.boneyard).toHaveLength(2);
    expectRackAdvancesOneAtATime(frames, 7);
    // human is never enabled while Fritz is still drawing or before the pass
    for (const f of frames) {
      if (f.humanCanAct) expect(f.fritzRackCount).toBe(7 + drawable);
    }
    expect(humanEnabledTransitions(frames)).toBe(1);
    expect(frames[frames.length - 1].humanCanAct).toBe(true);
    expectNoTileIdentitiesInDom(frames);
  });

  it('control: playable 5 late in the boneyard — Fritz plays only after drawing to it', async () => {
    const { store, frames } = setup(
      buildFiveFiveForcedDrawFixture({ boneyardSize: 8, playableAtBoneyardIndex: 4 }),
    );
    await advance(30_000);
    // 5 draws (indexes 0..4): rack 7 -> 12, then the found 5-6 is played (rack 12 -> 11).
    const firstPlay = frames.findIndex((f, i) => i > 0 && f.fritzRackCount < frames[i - 1].fritzRackCount);
    expect(firstPlay).toBeGreaterThan(-1);
    expect(frames[firstPlay - 1].fritzRackCount).toBe(12);
    for (const f of frames.slice(0, firstPlay)) expect(f.humanCanAct).toBe(false);
    expect(store.get().players.bot.hand).toHaveLength(11);
    expectRackAdvancesOneAtATime(frames.slice(0, firstPlay), 7);
  });
});

describe('embedded forced draw: Fritz scoring 1-5 leaves 5/5, engine drains boneyard + passes atomically', () => {
  it.each([4, 6, 10])('boneyard %i: authoritative turn is complete at commit, presentation is not', async (size) => {
    const { store, frames } = setup(
      buildFiveFiveForcedDrawFixture({ boneyardSize: size, fritzHoldsScoringFive: true }),
    );
    await advance(30_000);
    const drawable = size - 2;
    const final = store.get();
    expect(final.currentPlayer).toBe('you'); // authoritative state resolved atomically
    expect(final.boneyard).toHaveLength(2);
    expect(final.players.bot.hand).toHaveLength(6 + drawable);

    // Visible: rack grows one tile per commit, never jumps to the final count early.
    const postPlay = 6;
    expectRackAdvancesOneAtATime(frames.filter((f) => f.currentPlayer === 'you' || f.botTurn), postPlay);
    const firstHuman = frames.findIndex((f) => f.humanCanAct);
    expect(firstHuman).toBeGreaterThan(-1);
    expect(frames[firstHuman].fritzRackCount).toBe(6 + drawable);
    for (const f of frames.slice(0, firstHuman)) {
      expect(f.humanCanAct).toBe(false);
      expect(f.fritzRackCount).toBeLessThanOrEqual(6 + drawable);
    }
    // never enabled before the final draw, never re-enabled/replayed afterwards
    expect(humanEnabledTransitions(frames)).toBe(1);
    for (const f of frames.slice(firstHuman)) {
      expect(f.humanCanAct).toBe(true);
      expect(f.fritzRackCount).toBe(6 + drawable);
    }
    expectNoTileIdentitiesInDom(frames);
  });

  it('UI keeps showing Fritz as the active turn while the committed state already names the human', async () => {
    const { store, frames } = setup(
      buildFiveFiveForcedDrawFixture({ boneyardSize: 6, fritzHoldsScoringFive: true }),
    );
    await advance(30_000);
    const held = frames.filter((f) => f.currentPlayer === 'you' && f.botTurn);
    expect(held.length).toBeGreaterThan(0);
    expect(held.every((f) => !f.humanCanAct && f.drawSequenceActive)).toBe(true);
    expect(store.get().currentPlayer).toBe('you');
  });

  it('delayed animation: authoritative handoff cannot expose the human turn mid-presentation', async () => {
    const { store, frames } = setup(
      buildFiveFiveForcedDrawFixture({ boneyardSize: 10, fritzHoldsScoringFive: true }),
      5_000, // long per-tile beat: hold the animation barrier open
    );
    // opening think (1000) + handoff (560) + a bit: play committed, first draw presenting
    await advance(1_000 + 560 + 100);
    expect(store.get().currentPlayer).toBe('you');
    const mark = frames.length;
    await advance(9_000); // roughly two further tiles
    const mid = frames.slice(mark - 1);
    expect(mid.every((f) => !f.humanCanAct)).toBe(true);
    expect(mid[mid.length - 1].fritzRackCount).toBeLessThan(6 + 8);
    await advance(60_000);
    expect(frames[frames.length - 1].humanCanAct).toBe(true);
  });

  it('zero-delay draw timers still sequence correctly', async () => {
    const { frames } = setup(
      buildFiveFiveForcedDrawFixture({ boneyardSize: 6, fritzHoldsScoringFive: true }),
      0,
    );
    await advance(30_000);
    expect(humanEnabledTransitions(frames)).toBe(1);
    const firstHuman = frames.findIndex((f) => f.humanCanAct);
    expect(frames[firstHuman].fritzRackCount).toBe(10);
    expect(frames.slice(firstHuman).every((f) => f.fritzRackCount === 10)).toBe(true);
  });

  it('re-render mid-presentation does not reinitialise the rack from the final hand', async () => {
    const { frames, view, store } = setup(
      buildFiveFiveForcedDrawFixture({ boneyardSize: 10, fritzHoldsScoringFive: true }),
    );
    await advance(1_000 + 560 + 900);
    const before = frames[frames.length - 1].fritzRackCount;
    for (let i = 0; i < 3; i += 1) {
      view.rerender(<Probe store={store} drawStepMs={800} frames={frames} onRender={() => {}} />);
    }
    expect(frames[frames.length - 1].fritzRackCount).toBe(before);
    await advance(30_000);
    expect(humanEnabledTransitions(frames)).toBe(1);
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i].fritzRackCount).toBeGreaterThanOrEqual(frames[i - 1].fritzRackCount);
    }
  });
});

describe('Play vs Fritz (non-Daily) shares the same bot-turn spine', () => {
  it.each([false, true])('embedded forced draw, isDailyFritzMode=%s: same sequencing', async (daily) => {
    const { store, frames } = setup(
      buildFiveFiveForcedDrawFixture({ boneyardSize: 10, fritzHoldsScoringFive: true }),
      800,
      daily,
    );
    await advance(30_000);
    expect(store.get().currentPlayer).toBe('you');
    expect(humanEnabledTransitions(frames)).toBe(1);
    const firstHuman = frames.findIndex((f) => f.humanCanAct);
    expect(frames[firstHuman].fritzRackCount).toBe(14);
    expectRackAdvancesOneAtATime(frames, 7);
  });
});
