// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  isDailyFritzSkunk,
  getDailyFritzPublishedSetScore,
  getGameSkunkChipLabel,
  getSetSkunkBadgeFromLeaderboardRow,
  getSetSkunkBadge,
  getSkunkOverlayCopy,
} from './skunk';
import type { DailyFritzSetResult, DailyFritzSetGameResult } from './api';

describe('skunk detection and messaging', () => {
  describe('isDailyFritzSkunk', () => {
    it('1. returns true for scores below 30', () => {
      expect(isDailyFritzSkunk(29)).toBe(true);
      expect(isDailyFritzSkunk(0)).toBe(true);
    });

    it('2. returns false for scores equal to or above 30', () => {
      expect(isDailyFritzSkunk(30)).toBe(false);
      expect(isDailyFritzSkunk(45)).toBe(false);
    });

    it('3. returns false for non-finite values', () => {
      expect(isDailyFritzSkunk(NaN)).toBe(false);
      expect(isDailyFritzSkunk(Infinity)).toBe(false);
      expect(isDailyFritzSkunk(-Infinity)).toBe(false);
    });
  });

  describe('getGameSkunkChipLabel', () => {
    it('4. returns null if game.skunk is false or undefined', () => {
      const game = { gameNumber: 1 as const, playerWon: true, playerScore: 60, fritzScore: 40 };
      expect(getGameSkunkChipLabel(game)).toBeNull();
    });

    it('5. returns G1 SKUNKED for game 1 fritz win skunk', () => {
      const game = { gameNumber: 1 as const, playerWon: false, playerScore: 10, fritzScore: 60, skunk: true, skunkBy: 'fritz' as const };
      expect(getGameSkunkChipLabel(game)).toBe('G1 SKUNKED 10–60');
    });

    it('6. returns G1 SKUNK for game 1 player win skunk', () => {
      const game = { gameNumber: 1 as const, playerWon: true, playerScore: 60, fritzScore: 15, skunk: true, skunkBy: 'player' as const };
      expect(getGameSkunkChipLabel(game)).toBe('G1 SKUNK 60–15');
    });

    it('7. returns G2 SKUNK for game 2 skunk', () => {
      const game = { gameNumber: 2 as const, playerWon: true, playerScore: 60, fritzScore: 10, skunk: true, skunkBy: 'player' as const };
      expect(getGameSkunkChipLabel(game)).toBe('G2 SKUNK 60–10');
    });

    it('8. returns G3 SKUNK for game 3 skunk', () => {
      const game = { gameNumber: 3 as const, playerWon: true, playerScore: 60, fritzScore: 5, skunk: true, skunkBy: 'player' as const };
      expect(getGameSkunkChipLabel(game)).toBe('G3 SKUNK 60–5');
    });
  });

  describe('getSetSkunkBadge', () => {
    it('9. returns null if hasSkunk is false', () => {
      const setResult: DailyFritzSetResult = {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 2,
        fritzGamesWon: 0,
        totalPointDiff: 40,
        games: [],
        setWinner: 'player',
        hasSkunk: false,
      };
      expect(getSetSkunkBadge(setResult)).toBeNull();
      expect(getSetSkunkBadge(null)).toBeNull();
    });

    it('10. returns G1 SKUNK for instant player skunk', () => {
      const setResult: DailyFritzSetResult = {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 2,
        fritzGamesWon: 0,
        totalPointDiff: 50,
        games: [],
        setWinner: 'player',
        hasSkunk: true,
        instantSkunk: true,
        skunkBy: 'player',
      };
      expect(getSetSkunkBadge(setResult)).toBe('G1 SKUNK');
    });

    it('11. returns SKUNKED for instant fritz skunk', () => {
      const setResult: DailyFritzSetResult = {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 0,
        fritzGamesWon: 2,
        totalPointDiff: -50,
        games: [],
        setWinner: 'fritz',
        hasSkunk: true,
        instantSkunk: true,
        skunkBy: 'fritz',
      };
      expect(getSetSkunkBadge(setResult)).toBe('SKUNKED');
    });

    it('12. returns SKUNK FINISH for game 2 player win skunk', () => {
      const setResult: DailyFritzSetResult = {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 2,
        fritzGamesWon: 0,
        totalPointDiff: 60,
        games: [],
        setWinner: 'player',
        hasSkunk: true,
        skunkGameNumber: 2,
      };
      expect(getSetSkunkBadge(setResult)).toBe('SKUNK FINISH');
    });

    it('13. returns DECIDER SKUNK for game 3 player win skunk', () => {
      const setResult: DailyFritzSetResult = {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 2,
        fritzGamesWon: 1,
        totalPointDiff: 30,
        games: [],
        setWinner: 'player',
        hasSkunk: true,
        skunkGameNumber: 3,
      };
      expect(getSetSkunkBadge(setResult)).toBe('DECIDER SKUNK');
    });
  });

  describe('getSetSkunkBadgeFromLeaderboardRow', () => {
    it('14. returns null for row with no games or no skunks', () => {
      const row: any = {
        userId: '1',
        username: 'user',
        glickoRating: 1000,
        finalScore: 2,
        opponentScore: 0,
        pointDiff: 40,
        completedAt: '2026-06-28',
        rank: 1,
        games: [],
      };
      expect(getSetSkunkBadgeFromLeaderboardRow(row)).toBeNull();
    });

    it('15. returns correct badge from leaderboard row', () => {
      const row: any = {
        userId: '1',
        username: 'user',
        glickoRating: 1000,
        finalScore: 2,
        opponentScore: 0,
        pointDiff: 60,
        completedAt: '2026-06-28',
        rank: 1,
        won: true,
        games: [
          { gameNumber: 1, playerWon: true, playerScore: 60, fritzScore: 40, pointDiff: 20 },
          { gameNumber: 2, playerWon: true, playerScore: 60, fritzScore: 10, pointDiff: 50, skunk: true, skunkBy: 'player' },
        ],
      };
      expect(getSetSkunkBadgeFromLeaderboardRow(row)).toBe('SKUNK FINISH');
    });
  });

  describe('getSkunkOverlayCopy', () => {
    it('16. returns null if game has no skunk', () => {
      const setResult: DailyFritzSetResult = {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 2,
        fritzGamesWon: 0,
        totalPointDiff: 40,
        games: [],
        setWinner: 'player',
        hasSkunk: false,
      };
      const game: DailyFritzSetGameResult = {
        gameNumber: 1,
        seed: '',
        playerWon: true,
        playerScore: 60,
        fritzScore: 40,
        pointDiff: 20,
        completedAt: '2026-06-28',
      };
      expect(getSkunkOverlayCopy(setResult, game)).toBeNull();
    });

    it('17. returns correct copy for game 1 instant player skunk', () => {
      const setResult: DailyFritzSetResult = {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 2,
        fritzGamesWon: 0,
        totalPointDiff: 50,
        games: [],
        setWinner: 'player',
        hasSkunk: true,
        instantSkunk: true,
        skunkBy: 'player',
      };
      const game: DailyFritzSetGameResult = {
        gameNumber: 1,
        seed: '',
        playerWon: true,
        playerScore: 60,
        fritzScore: 15,
        pointDiff: 45,
        completedAt: '2026-06-28',
        skunk: true,
        skunkBy: 'player',
      };
      const copy = getSkunkOverlayCopy(setResult, game);
      expect(copy).not.toBeNull();
      expect(copy!.headline).toBe('SKUNK');
      expect(copy!.subheadline).toContain('2–0');
      expect(copy!.primaryTone).toBe('success');
    });

    it('18. returns correct copy for game 1 instant fritz skunk', () => {
      const setResult: DailyFritzSetResult = {
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 0,
        fritzGamesWon: 2,
        totalPointDiff: -50,
        games: [],
        setWinner: 'fritz',
        hasSkunk: true,
        instantSkunk: true,
        skunkBy: 'fritz',
      };
      const game: DailyFritzSetGameResult = {
        gameNumber: 1,
        seed: '',
        playerWon: false,
        playerScore: 10,
        fritzScore: 60,
        pointDiff: -50,
        completedAt: '2026-06-28',
        skunk: true,
        skunkBy: 'fritz',
      };
      const copy = getSkunkOverlayCopy(setResult, game);
      expect(copy).not.toBeNull();
      expect(copy!.headline).toBe('Skunked by Fritz');
      expect(copy!.primaryTone).toBe('default');
    });
  });

  describe('getDailyFritzPublishedSetScore', () => {
    it('publishes a game-1 player skunk as 2–0', () => {
      expect(getDailyFritzPublishedSetScore({
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 2,
        fritzGamesWon: 0,
        totalPointDiff: 45,
        games: [],
        setWinner: 'player',
        hasSkunk: true,
        instantSkunk: true,
        skunkGameNumber: 1,
        skunkBy: 'player',
      })).toEqual({ finalScore: 2, opponentScore: 0, label: '2–0' });
    });

    it('keeps a game-2 split skunk as 1–1', () => {
      expect(getDailyFritzPublishedSetScore({
        version: 2,
        format: 'best_of_3',
        playerGamesWon: 1,
        fritzGamesWon: 1,
        totalPointDiff: 20,
        games: [],
        setWinner: 'player',
        hasSkunk: true,
        skunkGameNumber: 2,
        skunkBy: 'player',
      })).toEqual({ finalScore: 1, opponentScore: 1, label: '1–1' });
    });
  });
});
