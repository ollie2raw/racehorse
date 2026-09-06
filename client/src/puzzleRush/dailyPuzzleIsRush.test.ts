/**
 * Daily Puzzle is Puzzle Rush.
 *
 * Source-level guards rather than renders: the thing that must not regress is
 * *which mode the entry points route to*, and that the retired ladder has no
 * reachable door left. A render test would assert the button's label; these
 * assert its destination.
 */
import { describe, expect, it } from 'vitest';

// Vite `?raw` imports rather than node:fs. The app project has no node types
// (`types: ["vite/client", "vitest/globals"]`), so `readFileSync`/`__dirname`
// broke `tsc -b` and therefore the production build. `?raw` is typed by
// vite/client and resolves through the same bundler the app uses.
import homeSource from '../screens/HomeScreen.tsx?raw';
import soloRoutesSource from '../routes/soloPlayRoutes.tsx?raw';
import singlePlayerHubSource from '../screens/SinglePlayerHubScreen.tsx?raw';

// The retired 5-slot ladder's screens/helpers were deleted (CODE_QUALITY_PLAN.md
// §CQ9.1.6). This glob is the door-count: only the 8 files Puzzle Rush / home /
// learn still share should remain under dailyPuzzle/.
const dailyPuzzleModules = Object.keys(
  import.meta.glob('../dailyPuzzle/*.{ts,tsx}', { eager: false }),
).map((p) => p.replace('../dailyPuzzle/', ''));

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
  it('the retired ladder screens are deleted, not just unrouted', () => {
    // Was: assert the ladder hub source has no route into Rush. The hub file
    // (and every other ladder screen) is now gone entirely — a stronger guard.
    const forbidden = [
      'DailyPuzzleScreen.tsx',
      'DailyPuzzleLadderScreen.tsx',
      'DailyPuzzleLadderHubView.tsx',
      'DailyPuzzleLadderLeaderboardScreen.tsx',
      'DailyPuzzleLegacyInPlayView.tsx',
      'DailyPuzzleAdminScreen.tsx',
      'validator.worker.ts',
    ];
    expect(dailyPuzzleModules.filter((m) => forbidden.includes(m))).toEqual([]);
  });

  it('no route module imports a DailyPuzzle screen', () => {
    // The `/daily` AppMode renders nothing; soloPlayRoutes must not resurrect a
    // ladder screen behind it.
    expect(soloRoutesSource).not.toMatch(/import[^;]*DailyPuzzle\w*(Screen|Ladder|InPlay)/);
    expect(soloRoutesSource).not.toContain("from '../dailyPuzzle/DailyPuzzle");
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
    // 'daily' remains a member of the AppMode union but has no renderer; no live
    // surface should send a player there.
    const liveNavigations = [homeSource, singlePlayerHubSource, soloRoutesSource].filter((source) =>
      /navigate\('daily'\)|setAppMode\('daily'\)|onNavigate\('daily'\)/.test(source),
    );
    expect(liveNavigations).toHaveLength(0);
  });
});
