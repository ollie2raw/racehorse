// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { asPlayMoves } from '../../game/tileUtils.ts';
import { drawOne, getLegalMoves, passTurn } from '../match/runtime/botEngine.ts';
import { createRunDrawSequence } from './drawSequence.ts';
import { buildFiveFiveForcedDrawFixture } from './forcedDrawFixture.ts';

function makeRun() {
  const visual: Array<{ hand: number; boneyard: number }> = [];
  const run = createRunDrawSequence({
    setMatch: vi.fn(),
    onDrawVisualStep: (_p, s) => visual.push({ hand: s.players.bot.hand.length, boneyard: s.boneyard.length }),
    isMuted: true,
    isLocalRunCurrent: () => true,
    triggerDrawStepAnimation: vi.fn(),
    drawStepMs: 0,
  });
  return { run, visual };
}

describe('5/5 forced draw — engine rule semantics', () => {
  it('fixture: Fritz has no play, ends are 5/5', () => {
    const s = buildFiveFiveForcedDrawFixture({ boneyardSize: 6 });
    expect(asPlayMoves(getLegalMoves(s, 'bot'))).toHaveLength(0);
    expect(s.boneyard.some((t) => t.low === 5 || t.high === 5)).toBe(false);
  });

  it.each([4, 5, 10])('boneyard %i: draws one tile at a time until drawable exhausted, then passes', async (size) => {
    const s = buildFiveFiveForcedDrawFixture({ boneyardSize: size });
    const drawable = size - 2;
    const { run, visual } = makeRun();
    const steps: string[] = [];
    const result = await run(s, 'bot', undefined, (st) => steps.push(st.actionKind));
    expect(steps).toEqual([...Array(drawable).fill('draw'), 'pass']);
    expect(visual.map((v) => v.hand)).toEqual(Array.from({ length: drawable }, (_, i) => 8 + i));
    expect(result.state.boneyard).toHaveLength(2); // dead tiles stay
    expect(result.state.players.bot.hand).toHaveLength(7 + drawable);
    expect(result.state.currentPlayer).toBe('you');
    expect(result.passed?.player).toBe('bot');
  });

  it('control: playable tile mid-boneyard stops the draw chain, no pass', async () => {
    const s = buildFiveFiveForcedDrawFixture({ boneyardSize: 8, playableAtBoneyardIndex: 3 });
    const { run, visual } = makeRun();
    const result = await run(s, 'bot');
    expect(visual).toHaveLength(4);
    expect(result.passed).toBeUndefined();
    expect(result.state.currentPlayer).toBe('bot');
    expect(asPlayMoves(getLegalMoves(result.state, 'bot')).length).toBeGreaterThan(0);
  });

  it('draw at locked boneyard is rejected; pass is the only legal action', () => {
    let s = buildFiveFiveForcedDrawFixture({ boneyardSize: 4 });
    s = drawOne(drawOne(s, 'bot').state, 'bot').state;
    expect(drawOne(s, 'bot').drew).toBeUndefined();
    expect(passTurn(s, 'bot').passed?.player).toBe('bot');
  });
});
