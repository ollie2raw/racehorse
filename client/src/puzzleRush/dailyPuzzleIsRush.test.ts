/**
 * Daily Puzzle is Puzzle Rush.
 *
 * Source-level guards rather than renders: the thing that must not regress is
 * *which mode the entry points route to*, and that the retired ladder has no
 * reachable door left. A render test would assert the button's label; these
 * assert its destination.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string) => readFileSync(resolve(__dirname, '..', relative), 'utf8');

const homeSource = read('screens/HomeScreen.tsx');
const hubSource = read('dailyPuzzle/DailyPuzzleLadderHubView.tsx');
const soloRoutesSource = read('routes/soloPlayRoutes.tsx');
const singlePlayerHubSource = read('screens/SinglePlayerHubScreen.tsx');

/** The Daily Puzzle card's JSX, isolated from the rest of Home. */
function dailyPuzzleCard(): string {
  const start = homeSource.indexOf('daily-puzzle-card-container');
  expect(start).toBeGreaterThan(-1);
  const end = homeSource.indexOf('</section>', start);
  expect(end).toBeGreaterThan(start);
  return homeSource.slice(start, end);
}

describe("Home's Daily Puzzle card", () => {
  it('routes straight into Rush, with no intermediate choice screen', () => {
    const card = dailyPuzzleCard();
    expect(card).toContain("navigate('puzzleRush')");
    // The retired ladder is not a destination from this card.
    expect(card).not.toContain("navigate('daily')");
  });

  it('offers exactly one play button — not a Ladder/Rush split', () => {
    const card = dailyPuzzleCard();
    const navCalls = card.match(/navigate\('[a-zA-Z]+'\)/g) ?? [];
    expect(navCalls).toEqual(["navigate('puzzleRush')"]);
    // Copy from the two-button era must not survive.
    expect(card).not.toContain('Play Ladder');
    expect(card).not.toContain('Puzzle Rush</span>');
  });

  it('no longer advertises the five-slot ladder', () => {
    expect(homeSource).not.toContain('Five daily puzzles');
  });
});

describe('retired ladder entry points', () => {
  it('the ladder hub offers no route into Rush or back to itself', () => {
    // The ladder-vs-rush selector inside the hub is gone entirely.
    expect(hubSource).not.toContain('puzzleRush');
  });

  it('the Single Player hub no longer lists Rush', () => {
    // Rush moved out of Single Player and into Daily Puzzle.
    expect(singlePlayerHubSource).not.toContain('puzzleRush');
  });

  it("Rush's back button returns Home, not to the retired ladder screen", () => {
    const start = soloRoutesSource.indexOf('export function PuzzleRushRoute');
    const end = soloRoutesSource.indexOf('export function', start + 10);
    const route = soloRoutesSource.slice(start, end);
    expect(route).toContain("setAppMode('home')");
    expect(route).not.toContain("setAppMode('daily')");
  });

  it('nothing outside the retired daily routes navigates to the ladder', () => {
    // 'daily' remains a valid AppMode (the screen is left in place), but no
    // live surface should send a player there.
    const liveNavigations = [homeSource, singlePlayerHubSource, hubSource].filter((source) =>
      /navigate\('daily'\)|setAppMode\('daily'\)|onNavigate\('daily'\)/.test(source),
    );
    expect(liveNavigations).toHaveLength(0);
  });
});
