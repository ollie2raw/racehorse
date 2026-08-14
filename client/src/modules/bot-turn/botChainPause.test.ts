// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { computeBotChainPaused } from './botChainPause.ts';

describe('computeBotChainPaused', () => {
  it('pauses when bot retains turn on a live hand', () => {
    const match = createBotMatch(60, 7);
    const next = { ...match, currentPlayer: 'bot' as const };
    expect(computeBotChainPaused({ state: next })).toBe(true);
  });

  it('does not pause when turn passes to the player', () => {
    const match = createBotMatch(60, 7);
    const next = { ...match, currentPlayer: 'you' as const };
    expect(computeBotChainPaused({ state: next })).toBe(false);
  });

  it('does not pause when the hand ends', () => {
    const match = createBotMatch(60, 7);
    const next = { ...match, currentPlayer: 'bot' as const, handOver: true };
    expect(computeBotChainPaused({ state: next })).toBe(false);
  });
});