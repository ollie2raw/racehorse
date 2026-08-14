// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createBotMatch } from '../../botEngine.ts';
import { buildPreGameDrawHudContent, selectTurnLabel } from './botMatchHudLabels.ts';
import type { BotMatchViewPreGameDraw } from '../../view-model/botMatchViewModelTypes.ts';

describe('selectTurnLabel', () => {
  it('shows your move when it is the player turn', () => {
    const match = createBotMatch(60, 7);
    expect(selectTurnLabel(match, 'Fritz', false)).toBe('Your move');
  });

  it('shows opponent thinking on bot turn', () => {
    const match = { ...createBotMatch(60, 7), currentPlayer: 'bot' as const };
    expect(selectTurnLabel(match, 'Fritz', true)).toBe('Fritz is thinking…');
  });

  it('shows drawing phase without a tile count', () => {
    const match = { ...createBotMatch(60, 7), currentPlayer: 'bot' as const };
    expect(
      selectTurnLabel(match, 'Fritz', true, {
        phase: 'drawing',
        drawCount: 2,
        turnScoreTotal: 0,
        lastScorePoints: 0,
      }),
    ).toBe('Fritz is drawing…');
  });
});

describe('buildPreGameDrawHudContent', () => {
  it('returns tap-to-draw copy when player pick is enabled', () => {
    const preGameDraw: BotMatchViewPreGameDraw = {
      drawState: {
        phase: 'pick-player',
        tiles: [],
        currentRound: { you: null, bot: null },
        winner: null,
        remainingDeck: null,
      },
      isPlayerPickEnabled: true,
      isOpponentThinking: false,
      resultMessage: null,
      handlePlayerTileTap: () => {},
    };
    expect(buildPreGameDrawHudContent(preGameDraw, 'Fritz')).toEqual({
      label: 'Tap a tile to draw',
      tone: 'your-turn',
    });
  });
});