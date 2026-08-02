import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../game/types';
import { sanitizePrivateRoomConfig } from './privateRoomConfig';

describe('sanitizePrivateRoomConfig', () => {
  it('defaults to 7-tile deal with 2 dead tiles and winning score 60', () => {
    expect(sanitizePrivateRoomConfig({})).toEqual({
      tilesPerPlayer: 7,
      deadTileCount: 2,
      winningScore: 60,
      skipPregameDraw: false,
    });
  });

  it('maps 14-tile deal to zero dead tiles so validateConfig passes for 2 players', () => {
    expect(sanitizePrivateRoomConfig({ tilesPerPlayer: 14 })).toEqual({
      tilesPerPlayer: 14,
      deadTileCount: 0,
      winningScore: 60,
      skipPregameDraw: false,
    });
  });

  it('clamps invalid winning scores to the default', () => {
    expect(sanitizePrivateRoomConfig({ winningScore: 99 }).winningScore).toBe(
      DEFAULT_CONFIG.winningScore,
    );
    expect(sanitizePrivateRoomConfig({ winTarget: 45 }).winningScore).toBe(
      DEFAULT_CONFIG.winningScore,
    );
    expect(sanitizePrivateRoomConfig({ winningScore: 30 }).winningScore).toBe(30);
  });

  it('allows winningScore 5 only in MP_PRIVATE_CERT_MODE', () => {
    const previous = process.env.MP_PRIVATE_CERT_MODE;
    process.env.MP_PRIVATE_CERT_MODE = '1';
    expect(sanitizePrivateRoomConfig({ winningScore: 5 }).winningScore).toBe(5);
    delete process.env.MP_PRIVATE_CERT_MODE;
    expect(sanitizePrivateRoomConfig({ winningScore: 5 }).winningScore).toBe(
      DEFAULT_CONFIG.winningScore,
    );
    if (previous !== undefined) process.env.MP_PRIVATE_CERT_MODE = previous;
  });
});
