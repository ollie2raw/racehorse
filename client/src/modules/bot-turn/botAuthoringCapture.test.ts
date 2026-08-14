// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBotMatch } from '../match/runtime/botEngine.ts';
import { deriveBotCaptureAction } from './botAuthoringCapture.ts';

describe('deriveBotCaptureAction', () => {
  const match = createBotMatch(60, 7);

  it('returns draw when result drew', () => {
    expect(
      deriveBotCaptureAction({
        state: match,
        drew: { player: 'bot', tile: { low: 1, high: 2 } },
      }),
    ).toBe('draw');
  });

  it('returns pass when result passed', () => {
    expect(deriveBotCaptureAction({ state: match, passed: { player: 'bot' } })).toBe('pass');
  });

  it('returns play for a tile placement', () => {
    expect(deriveBotCaptureAction({ state: match })).toBe('play');
  });
});