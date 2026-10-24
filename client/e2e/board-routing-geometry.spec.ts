/**
 * Numeric board-routing geometry (no pixel baselines): mounts the real
 * LiveMatchScreen with fixture boards and records tile bounds, camera scale,
 * HUD/rack clearance and each arm's route. Prints one `GEOM|` JSON line per case
 * so a before/after comparison can be diffed.
 */
import { test } from '@playwright/test';
import { measureBoard, openRoutingHarness, round, round2 } from './support/boardGeometry';

// Measurement tool, not a gate: the asserting checks live in board-routing.spec.ts.
// Run with BOARD_GEOMETRY_REPORT=1 and grep the output for `GEOM|`.
test.skip(!process.env.BOARD_GEOMETRY_REPORT, 'numeric report tool; set BOARD_GEOMETRY_REPORT=1');

const DESKTOP = [
  { name: '1512x982', width: 1512, height: 982 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x720', width: 1280, height: 720 },
] as const;
// The harness collapses the board container below ~800px wide (it lacks the
// standard-live-board shell classes), so narrower phones are covered by the
// existing mobile-landscape visual specs instead.
const PHONE = [
  { name: '844x390', width: 844, height: 390 },
  { name: '932x430', width: 932, height: 430 },
] as const;
const FIXTURES = ['longUp', 'longUpMax', 'longDown', 'longBoth', 'mediumBoth', 'longHorizontal'];

for (const vp of DESKTOP) {
  test.describe(`geometry ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const fixture of FIXTURES) {
      test(fixture, async ({ page }) => {
        await openRoutingHarness(page, `fixture=${fixture}`);
        const g = await measureBoard(page);
        console.log(`GEOM|${vp.name}|${fixture}|${JSON.stringify({
          container: [round(g.container.width), round(g.container.height)],
          scale: round2(g.cameraScale),
          tiles: g.tileCount,
          board: g.boardBox ? [round(g.boardBox.left), round(g.boardBox.top), round(g.boardBox.right), round(g.boardBox.bottom)] : null,
          dist: g.distances,
          hits: g.intersectsExclusion,
          arms: g.arms.map((a) => ({ arm: a.key, route: a.route, bend: a.bendSide, exposed: a.exposed.rect && [round(a.exposed.rect.left), round(a.exposed.rect.top), round(a.exposed.rect.right), round(a.exposed.rect.bottom)] })),
          excl: g.exclusions.map((e) => `${e.name}:${round(e.rect.top)}-${round(e.rect.bottom)}`),
        })}`);
      });
    }
  });
}

for (const vp of PHONE) {
  test.describe(`geometry ${vp.name} (landscape phone)`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, isMobile: true, hasTouch: true });
    for (const fixture of FIXTURES) {
      test(fixture, async ({ page }) => {
        await openRoutingHarness(page, `fixture=${fixture}`);
        const g = await measureBoard(page);
        console.log(`GEOM|${vp.name}|${fixture}|${JSON.stringify({
          container: [round(g.container.width), round(g.container.height)],
          scale: round2(g.cameraScale),
          tiles: g.tileCount,
          board: g.boardBox ? [round(g.boardBox.left), round(g.boardBox.top), round(g.boardBox.right), round(g.boardBox.bottom)] : null,
          dist: g.distances,
          hits: g.intersectsExclusion,
          arms: g.arms.map((a) => ({ arm: a.key, route: a.route, bend: a.bendSide, exposed: a.exposed.rect && [round(a.exposed.rect.left), round(a.exposed.rect.top), round(a.exposed.rect.right), round(a.exposed.rect.bottom)] })),
          excl: g.exclusions.map((e) => `${e.name}:${round(e.rect.top)}-${round(e.rect.bottom)}`),
        })}`);
      });
    }
  });
}
