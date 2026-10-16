// @vitest-environment jsdom
/**
 * Real <BotMatchScreen> integration for the embedded forced-draw chain.
 *
 * The match is injected through resolveInitialBotMatchState (deterministic fixture, no random
 * deal). Every React commit is observed with a <Profiler> and the player-visible state is read
 * back from the DOM: Fritz rack, boneyard pill, turn label/pill side, human tile enablement and
 * the hand-over / game-over surfaces.
 */
import { act, fireEvent, render } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildEmbeddedChainFixture,
  POOL_TILES,
  type EmbeddedChainFixtureOptions,
} from './embeddedChainFixture.ts';
import { captureScreenFrame, type ScreenFrame } from './forcedDrawScreenFrames.ts';

const holder = vi.hoisted(() => ({ state: null as unknown }));
vi.mock('../match/bootstrap/resolveInitialBotMatchState.ts', () => ({
  resolveInitialBotMatchState: () => holder.state,
}));
vi.mock('../../match/preGameDraw/preGameDrawEligibility.ts', async (orig) => ({
  ...(await orig<typeof import('../../match/preGameDraw/preGameDrawEligibility.ts')>()),
  isPreGameDrawEligible: () => false,
}));
vi.mock('../../auth/useAuth.ts', () => ({
  useAuth: () => ({ user: null, session: null, accessToken: null, loading: false }),
}));

import BotMatchScreen from '../../bot/BotMatchScreen.tsx';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const P = (a: number, b: number) =>
  POOL_TILES.find((t) => t.low === Math.min(a, b) && t.high === Math.max(a, b))!;

/** Fritz holds 1-5 + 2 pool tiles; the drawable boneyard is 3 pool tiles (+2 dead). */
const BASE: EmbeddedChainFixtureOptions = {
  fritzPool: [P(0, 2), P(0, 3)],
  boneyardPool: [P(0, 4), P(2, 2), P(2, 4)],
};
const FINAL_RACK = 5; // 2 held + 3 drawn
const FINAL_BONEYARD = 2; // dead tiles stay

async function playOut(
  options: EmbeddedChainFixtureOptions,
  hooks: { afterSlice?: (frames: ScreenFrame[], slice: number) => void; slices?: number } = {},
) {
  holder.state = buildEmbeddedChainFixture(options);
  const frames: ScreenFrame[] = [];
  const view = render(
    <Profiler id="screen" onRender={() => frames.push(captureScreenFrame())}>
      <BotMatchScreen onBack={() => {}} dealSize={7} mode="bot" />
    </Profiler>,
  );
  for (let i = 0; i < (hooks.slices ?? 700); i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25);
    });
    hooks.afterSlice?.(frames, i);
  }
  return { frames, view };
}

const firstIndex = (frames: ScreenFrame[], pred: (f: ScreenFrame) => boolean) =>
  frames.findIndex(pred);

/** Frames of the first Fritz turn (until the display first hands the turn to the human). */
function fritzTurnFrames(frames: ScreenFrame[]) {
  const release = firstIndex(frames, (f) => !f.fritzSideActive);
  expect(release).toBeGreaterThan(0);
  return { turn: frames.slice(0, release), release, releaseFrame: frames[release]! };
}

describe('BotMatchScreen: embedded forced draw, human keeps a play (non-terminal)', () => {
  it('shows Fritz drawing one tile per frame, then releases the human exactly once', async () => {
    const { frames } = await playOut({ ...BASE, humanHoldsFive: true });
    const { turn, releaseFrame } = fritzTurnFrames(frames);

    // Fritz stays the displayed active side with a consistent label the whole time
    expect(turn.every((f) => f.fritzSideActive)).toBe(true);
    expect(turn.every((f) => /^Fritz is (thinking|drawing)…$/.test(f.label))).toBe(true);
    expect(turn.filter((f) => f.label === 'Fritz is drawing…').length).toBeGreaterThanOrEqual(3);

    // human controls disabled for every frame of Fritz's turn
    expect(turn.every((f) => f.humanTilesEnabled === 0)).toBe(true);

    // rack climbs monotonically by at most one per frame; boneyard falls the same way
    for (let i = 1; i < turn.length; i += 1) {
      const dRack = turn[i]!.rack - turn[i - 1]!.rack;
      const dBy = turn[i - 1]!.boneyard - turn[i]!.boneyard;
      expect(dRack === 0 || dRack === 1).toBe(true);
      expect(dBy === 0 || dBy === 1).toBe(true);
    }
    // no final-count flash: the final rack count first appears together with the final
    // boneyard count and only after the previous step was shown
    const firstFinal = turn.findIndex((f) => f.rack === FINAL_RACK);
    expect(firstFinal).toBeGreaterThan(0);
    expect(turn[firstFinal]!.boneyard).toBe(FINAL_BONEYARD);
    expect(turn[firstFinal - 1]!.rack).toBe(FINAL_RACK - 1);
    expect(turn.every((f) => f.rack <= FINAL_RACK)).toBe(true);

    // release: human turn appears once, with the final counts and enabled tiles
    expect(releaseFrame.label).toBe('Your move');
    expect(releaseFrame.rack).toBe(FINAL_RACK);
    expect(releaseFrame.boneyard).toBe(FINAL_BONEYARD);
    expect(releaseFrame.humanTilesEnabled).toBeGreaterThan(0);
    const reentries = frames.filter(
      (f, i) => i > 0 && f.fritzSideActive && !frames[i - 1]!.fritzSideActive,
    );
    expect(reentries).toHaveLength(0); // no flip back to Fritz after the release
    expect(frames.every((f) => !f.handOverModal && !f.gameOverModal)).toBe(true);
  });

  it('clicks on human tiles while Fritz is drawing change nothing', async () => {
    let clicked = 0;
    const { frames } = await playOut({ ...BASE, humanHoldsFive: true }, {
      afterSlice: (fr) => {
        const last = fr[fr.length - 1];
        if (last?.fritzSideActive && last.label === 'Fritz is drawing…') {
          document.querySelectorAll('.hand-container .guided-tile-wrap > *').forEach((el) => {
            fireEvent.click(el);
            clicked += 1;
          });
        }
      },
    });
    expect(clicked).toBeGreaterThan(0);
    const { releaseFrame } = fritzTurnFrames(frames);
    expect(releaseFrame.humanTiles).toBe(releaseFrame.humanTilesEnabled);
    // nothing got selected during the hold
    expect(document.querySelectorAll('.hand-container .selected').length).toBe(0);
  });

  it('never exposes tile identities in the rack or boneyard surfaces', async () => {
    const { frames } = await playOut({ ...BASE, humanHoldsFive: true });
    const { turn } = fritzTurnFrames(frames);
    for (const f of turn) {
      const doc = new DOMParser().parseFromString(`<div>${f.html}</div>`, 'text/html');
      const rack = doc.querySelector('.rh-tile-rack');
      expect(rack?.innerHTML ?? '').not.toMatch(/\d/);
      expect(rack?.getAttribute('aria-label')).toMatch(/^\d+ tiles? in hand$/);
      expect(doc.querySelector('.boneyard-pill')?.textContent ?? '').toMatch(/^\s*\d+(locked)?\s*$/);
    }
  });
});

describe('BotMatchScreen: terminal outcome after an embedded forced draw (human blocked)', () => {
  const cases = [
    {
      name: 'Fritz wins the blocked hand on pips',
      options: BASE,
      expectScores: (bot: number, you: number) => bot > 2 && you === 0,
    },
    {
      name: 'human wins the blocked hand on pips',
      options: {
        fritzPool: [P(6, 6), P(3, 6), P(2, 6)],
        boneyardPool: [P(4, 4), P(3, 4), P(3, 3), P(2, 4)],
      },
      expectScores: (bot: number, you: number) => bot === 2 && you > 0,
    },
    {
      name: 'tied blocked hand awards nothing',
      options: {
        fritzPool: [P(6, 6), P(3, 6), P(2, 6)],
        boneyardPool: [P(4, 4), P(3, 4), P(0, 4)],
      },
      expectScores: (bot: number, you: number) => bot === 2 && you === 0,
    },
  ] as const;

  it.each(cases)('$name: result surface only after the draws and the pass', async ({ options, expectScores }) => {
    const { frames: allFrames } = await playOut(options as EmbeddedChainFixtureOptions);
    // The fixture is deterministic for the FIRST hand only: once the result surface is dismissed the next hand is
    // dealt from an unseeded shuffle, and Fritz may legitimately draw again inside the 17.5s simulated window. The
    // draw/result ordering is a property of the fixture hand, so it is asserted on the frames up to that new deal
    // (frames from the new deal on are only used for the "dealt after the result" check at the end).
    const nextHand = firstIndex(allFrames, (f) => f.rack === 7 && f.boneyard === 14);
    expect(nextHand).toBeGreaterThan(0);
    const frames = allFrames.slice(0, nextHand);
    const fritzDrawFrames = frames.filter((f) => f.fritzSideActive && f.label === 'Fritz is drawing…');
    expect(fritzDrawFrames.length).toBeGreaterThanOrEqual(2);
    const lastDraw = frames.lastIndexOf(fritzDrawFrames[fritzDrawFrames.length - 1]!);
    const finalRack = frames[lastDraw]!.rack;

    const terminal = firstIndex(frames, (f) => f.handOverModal || f.gameOverModal);
    expect(terminal).toBeGreaterThan(lastDraw); // never ahead of, or on top of, the draws

    // every frame up to the result keeps Fritz's rack at or below the presented count, and no
    // frame before the last draw shows the human as active/enabled
    for (let i = 0; i <= lastDraw; i += 1) {
      expect(frames[i]!.rack).toBeLessThanOrEqual(finalRack);
      expect(frames[i]!.humanTilesEnabled).toBe(0);
      expect(frames[i]!.fritzSideActive).toBe(true);
    }
    // the result frame carries the final presented counts and nobody drew after it
    expect(frames[terminal]!.rack).toBe(finalRack);
    const modalFrames = frames.slice(terminal).filter((f) => f.handOverModal || f.gameOverModal);
    expect(modalFrames.length).toBeGreaterThan(0);
    for (const f of modalFrames) {
      expect(f.rack).toBe(finalRack);
      expect(f.humanTilesEnabled).toBe(0);
    }
    // hand result recorded; the final scores match the expected outcome
    const settled = frames.find((f, i) => i >= terminal && f.handOverModal && /^\d+\/\d+$/.test(f.scores))!;
    const [bot, you] = settled.scores.split('/').map(Number) as [number, number];
    expect(expectScores(bot, you)).toBe(true);
    // the next hand is dealt only after the result surface (fresh 7/14 deal)
    expect(nextHand).toBeGreaterThan(terminal);
    // single release into the human's turn before the result
    const releases = frames
      .slice(0, terminal)
      .filter((f, i) => i > 0 && !f.fritzSideActive && frames[i - 1]!.fritzSideActive);
    expect(releases).toHaveLength(1);
  });

  it('match-ending score: game-over surface appears after the draws, never on top of them', async () => {
    const { frames } = await playOut({ ...BASE, winningScore: 3 });
    const drawing = frames.filter((f) => f.label === 'Fritz is drawing…' && f.fritzSideActive);
    const lastDraw = frames.lastIndexOf(drawing[drawing.length - 1]!);
    const gameOver = firstIndex(frames, (f) => f.gameOverModal);
    expect(gameOver).toBeGreaterThan(lastDraw);
    expect(frames.slice(0, gameOver).every((f) => !f.handOverModal)).toBe(true);
    expect(frames[gameOver]!.rack).toBe(FINAL_RACK);
    expect(frames.slice(gameOver).every((f) => f.rack === FINAL_RACK)).toBe(true);
  });
});
