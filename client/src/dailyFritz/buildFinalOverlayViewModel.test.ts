// @vitest-environment jsdom
/**
 * The dossier fields on the final result card.
 *
 * The ranked flag comes from the run's verification status, not from whether
 * the player won — an unverified win is still unranked, and the card has to
 * say so rather than showing a silent blank rank.
 */
import { describe, it, expect } from 'vitest';
import { buildDailyFritzFinalOverlayViewModel } from './buildFinalOverlayViewModel';
import type { DailyFritzSetResult } from './api';

const game = (n: number, ps: number, fz: number, skunk = false) => ({
  gameNumber: n, seed: 's', playerWon: ps > fz, playerScore: ps, fritzScore: fz,
  pointDiff: ps - fz, completedAt: '2026-08-28T09:36:00Z',
  ...(skunk ? { skunk: true, skunkBy: 'player' } : {}),
});

function setResult(over: Partial<DailyFritzSetResult> = {}): DailyFritzSetResult {
  return {
    version: 2, format: 'best_of_3', playerGamesWon: 2, fritzGamesWon: 0,
    totalPointDiff: 80, games: [game(1, 65, 33), game(2, 60, 12, true)],
    setWinner: 'player', hasSkunk: true, instantSkunk: false,
    skunkGameNumber: 2, skunkBy: 'player', ...over,
  } as unknown as DailyFritzSetResult;
}

function build(over: Record<string, unknown> = {}) {
  return buildDailyFritzFinalOverlayViewModel({
    setResult: setResult(), rank: 1, runDate: '2026-08-26', fritzTier: 'elite',
    shareRating: 1742, shareStreak: 1, canViewLeaderboard: true,
    onPrimary: () => {}, onSecondary: () => {}, ...over,
  } as never);
}

describe('final overlay dossier fields', () => {
  it('reads a verified run as ranked', () => {
    expect(build({ verificationStatus: 'verified' }).ranked).toBe(true);
  });

  it('marks an unverified run unranked even when the set was won', () => {
    const vm = build({ verificationStatus: 'legacy_unverified' });
    expect(vm.ranked).toBe(false);
    expect(vm.note).toMatch(/verified/i);
  });

  it('defaults to ranked when verification is not supplied, preserving old behaviour', () => {
    expect(build().ranked).toBe(true);
  });

  it('says the streak held when a loss leaves it intact', () => {
    const vm = build({
      setResult: setResult({
        playerGamesWon: 1, fritzGamesWon: 2, totalPointDiff: -10,
        setWinner: 'fritz', hasSkunk: false,
        games: [game(1, 60, 52), game(2, 49, 60), game(3, 53, 60)],
      } as Partial<DailyFritzSetResult>),
      shareStreak: 4,
    });
    expect(vm.streakHeld).toBe(true);
    expect(vm.note).toMatch(/missed day/i);
  });

  it('does not claim a held streak on a win, or with no streak', () => {
    expect(build({ shareStreak: 4 }).streakHeld).toBe(false);
    expect(build({
      setResult: setResult({ setWinner: 'fritz', playerGamesWon: 0, fritzGamesWon: 2 } as Partial<DailyFritzSetResult>),
      shareStreak: 0,
    }).streakHeld).toBe(false);
  });

  it('states the outcome in the headline rather than a generic completion', () => {
    expect(build().headline).toBe('Skunk finish');
    expect(build({
      setResult: setResult({ hasSkunk: false, skunkGameNumber: undefined, skunkBy: undefined,
        games: [game(1, 65, 33), game(2, 60, 42)] } as Partial<DailyFritzSetResult>),
    }).headline).toBe('Set won');
    expect(build({
      setResult: setResult({ setWinner: 'fritz', playerGamesWon: 1, fritzGamesWon: 2,
        hasSkunk: false, skunkGameNumber: undefined, skunkBy: undefined,
        games: [game(1, 60, 52), game(2, 49, 60), game(3, 53, 60)] } as Partial<DailyFritzSetResult>),
    }).headline).toBe('Fritz takes it');
  });

  it('lets the unranked headline win over the outcome', () => {
    expect(build({ verificationStatus: 'rejected' }).headline).toBe('Finished, but unranked');
  });

  it('keeps rank and rating blank on an unranked run', () => {
    const vm = build({ verificationStatus: 'rejected' });
    expect(vm.rankValue).toBeNull();
  });
});
