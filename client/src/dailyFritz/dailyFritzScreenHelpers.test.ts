// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  formatDateLabel,
  titleCaseTier,
  tierDisplayLabel,
  getDailyFritzGameSeed,
  normalizeGameNumber,
  formatMargin,
  formatCountdownHms,
  pacificDateText,
  secondsUntilNextPacificMidnight,
  friendlyDailyFritzInitError,
  normalizeSetResult,
  getNextGameNumberFromSetResult,
  resolveTodayNextAction,
  resolveBetweenGamesOverlayFromStart,
} from './dailyFritzScreenHelpers';

describe('pacificDateText', () => {
  it('is the Pacific calendar date, not the UTC one', () => {
    // 23:30 PDT on Oct 31 is already Nov 1 in UTC.
    expect(pacificDateText(new Date('2026-11-01T06:30:00.000Z'))).toBe('2026-10-31');
    // 01:30 PDT, the hour before the clocks fall back.
    expect(pacificDateText(new Date('2026-11-01T08:30:00.000Z'))).toBe('2026-11-01');
  });

  it('rolls over at Pacific midnight on both sides of the daylight-saving change', () => {
    // PDT (UTC-7): midnight is 07:00Z.
    expect(pacificDateText(new Date('2026-07-05T06:59:59.000Z'))).toBe('2026-07-04');
    expect(pacificDateText(new Date('2026-07-05T07:00:00.000Z'))).toBe('2026-07-05');
    // PST (UTC-8): midnight is 08:00Z.
    expect(pacificDateText(new Date('2026-12-05T07:59:59.000Z'))).toBe('2026-12-04');
    expect(pacificDateText(new Date('2026-12-05T08:00:00.000Z'))).toBe('2026-12-05');
  });

  it('agrees with the reset countdown: the date changes exactly when the countdown reaches zero', () => {
    const justBefore = new Date('2026-12-05T07:59:59.000Z');
    expect(secondsUntilNextPacificMidnight(justBefore)).toBe(1);
    expect(pacificDateText(new Date(justBefore.getTime() + 1000))).not.toBe(pacificDateText(justBefore));
  });
});

describe('formatDateLabel', () => {
  it('formats a valid date string', () => {
    const result = formatDateLabel('2024-01-15');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
  it('handles invalid date gracefully', () => {
    expect(() => formatDateLabel('not-a-date')).not.toThrow();
  });
});

describe('titleCaseTier', () => {
  it('capitalizes first letter', () => {
    expect(titleCaseTier('amateur')).toBe('Amateur');
  });
  it('handles already-capitalized input', () => {
    expect(titleCaseTier('Pro')).toBe('Pro');
  });
  it('handles empty string', () => {
    expect(() => titleCaseTier('')).not.toThrow();
  });
});

describe('tierDisplayLabel', () => {
  it('returns a non-empty string for known tiers', () => {
    expect(tierDisplayLabel('pro').length).toBeGreaterThan(0);
    expect(tierDisplayLabel('amateur').length).toBeGreaterThan(0);
  });
});

describe('getDailyFritzGameSeed', () => {
  it('returns a string seed', () => {
    expect(typeof getDailyFritzGameSeed('2024-01-15', 1)).toBe('string');
  });
  it('returns different seeds for different dates', () => {
    const a = getDailyFritzGameSeed('2024-01-15', 1);
    const b = getDailyFritzGameSeed('2024-01-16', 1);
    expect(a).not.toBe(b);
  });
  it('returns different seeds for different game numbers', () => {
    const a = getDailyFritzGameSeed('2024-01-15', 1);
    const b = getDailyFritzGameSeed('2024-01-15', 2);
    expect(a).not.toBe(b);
  });
});

describe('normalizeGameNumber', () => {
  it('returns 1 for valid game number 1', () => {
    expect(normalizeGameNumber(1)).toBe(1);
  });
  it('returns fallback for null', () => {
    expect(normalizeGameNumber(null, 1)).toBe(1);
  });
  it('returns fallback for out-of-range value', () => {
    expect(normalizeGameNumber(99, 1)).toBe(1);
  });
});

describe('formatMargin', () => {
  it('formats positive margin', () => {
    expect(formatMargin(10)).toMatch(/\+?10|10/);
  });
  it('formats negative margin', () => {
    expect(formatMargin(-5)).toMatch(/-5/);
  });
  it('formats zero', () => {
    expect(typeof formatMargin(0)).toBe('string');
  });
});

describe('formatCountdownHms', () => {
  it('formats zero seconds', () => {
    expect(formatCountdownHms(0)).toMatch(/0/);
  });
  it('formats one hour', () => {
    expect(formatCountdownHms(3600)).toMatch(/1/);
  });
  it('formats 90 minutes', () => {
    const result = formatCountdownHms(5400);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('secondsUntilNextPacificMidnight', () => {
  it('returns a positive number', () => {
    expect(secondsUntilNextPacificMidnight(new Date())).toBeGreaterThan(0);
  });
  it('returns less than 86400 seconds', () => {
    expect(secondsUntilNextPacificMidnight(new Date())).toBeLessThanOrEqual(86400);
  });
});

describe('friendlyDailyFritzInitError', () => {
  it('returns string for Error object', () => {
    expect(typeof friendlyDailyFritzInitError(new Error('fail'))).toBe('string');
  });
  it('returns string for unknown input', () => {
    expect(typeof friendlyDailyFritzInitError('raw string')).toBe('string');
    expect(typeof friendlyDailyFritzInitError(null)).toBe('string');
  });
});

describe('normalizeSetResult', () => {
  it('returns null for null input', () => {
    expect(normalizeSetResult(null)).toBeNull();
  });
  it('returns null for invalid input', () => {
    expect(normalizeSetResult('garbage')).toBeNull();
  });
});

describe('getNextGameNumberFromSetResult', () => {
  it('returns 1 when set result is null', () => {
    expect(getNextGameNumberFromSetResult(null)).toBe(1);
  });
});

describe('resolveTodayNextAction', () => {
  it('uses server next_action when present', () => {
    expect(resolveTodayNextAction({
      ok: true,
      run_date: '2026-08-19',
      fritz_tier: 'elite',
      deal_size: 7,
      winning_score: 60,
      attempt_status: 'started',
      next_action: 'between_games',
      current_game_number: 2,
      streak: 1,
      result: null,
      set_result: null,
      rank: null,
      leaderboard_preview: [],
    })).toBe('between_games');
  });

  it('falls back gracefully when next_action is missing', () => {
    expect(resolveTodayNextAction({
      ok: true,
      run_date: '2026-08-19',
      fritz_tier: 'elite',
      deal_size: 7,
      winning_score: 60,
      attempt_status: 'completed',
      current_game_number: null,
      streak: 1,
      result: null,
      set_result: null,
      rank: null,
      leaderboard_preview: [],
    })).toBe('view_results');
  });
});

describe('resolveBetweenGamesOverlayFromStart', () => {
  const game1 = {
    gameNumber: 1 as const,
    seed: 'g1',
    playerWon: true,
    playerScore: 60,
    fritzScore: 40,
    pointDiff: 20,
    completedAt: '2026-08-19T10:00:00.000Z',
  };

  const startBase = {
    ok: true as const,
    attempt_id: 'attempt-1',
    verified_match_id: 'verified-1',
    run_date: '2026-08-19',
    current_hand_index: 0,
    current_game_number: 2 as const,
    needs_completion: false,
    set_result: {
      version: 2 as const,
      format: 'best_of_3' as const,
      playerGamesWon: 1,
      fritzGamesWon: 0,
      totalPointDiff: 20,
      games: [game1],
    },
    fritz_tier: 'elite' as const,
    deal_size: 7 as const,
    winning_score: 60,
    first_hand: {
      player_tiles: [{ low: 0, high: 0 }],
      fritz_tiles: [{ low: 1, high: 1 }],
      boneyard: [],
      locked: [],
    },
    draw_winner: 'you' as const,
    draw_player_tile: { low: 0, high: 1 },
    draw_fritz_tile: { low: 0, high: 2 },
  };

  it('reconstructs the last completed game and next game slot from a between_games /start payload', () => {
    expect(resolveBetweenGamesOverlayFromStart({
      ...startBase,
      next_action: 'between_games',
    })).toEqual({
      completedGame: game1,
      setResult: startBase.set_result,
      nextGameNumber: 2,
    });
  });

  it('does not reconstruct an overlay for a mid-hand play_hand resume', () => {
    expect(resolveBetweenGamesOverlayFromStart({
      ...startBase,
      next_action: 'play_hand',
      current_hand_index: 2,
      current_game_number: 2,
    })).toBeNull();
  });
});
