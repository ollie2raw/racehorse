/**
 * Responsive board routing, measured in the real LiveMatchScreen (e2e/harness/
 * board-routing.html) with boards built through game-core's real placement.
 *
 * "Pre-fix" figures quoted in comments are the numbers recorded before the
 * routing change (same fixtures, same viewports, straight vertical arms and the
 * camera zooming out to fit): they are the bar the routing has to beat, kept here
 * so a regression to zoom-only fitting is obvious.
 */
import { expect, test } from '@playwright/test';
import { measureBoard, openRoutingHarness, waitForStableCamera, type GeometryReport } from './support/boardGeometry';

const routes = (g: GeometryReport) => g.arms.map((a) => `${a.key}:${a.route}${a.bendSide === 'none' ? '' : `:${a.bendSide}`}`);

function expectClearOfChrome(g: GeometryReport) {
  // No tile touches the HUD, rack, controls, meta bar or zoom tray, and the whole
  // board sits inside the board container.
  expect(g.intersectsExclusion).toEqual([]);
  expect(g.distances.toContainerTop).toBeGreaterThanOrEqual(0);
  expect(g.distances.toContainerBottom).toBeGreaterThanOrEqual(0);
  expect(g.distances.toContainerLeft).toBeGreaterThanOrEqual(0);
  expect(g.distances.toContainerRight).toBeGreaterThanOrEqual(0);
}

const LAPTOPS = [
  // viewport, container (1456x756 / 1384x674 / 1224x508), and the routes the
  // limit resolves to there. Pre-fix every vertical arm was straight (V9 / V12 / V8).
  { name: '1512x982', width: 1512, height: 982, longUp: 'arm0:V5H4:right', longUpMax: 'arm0:V5H7:right', minScaleLongUp: 0.44 /* pre-fix 0.30 */, minScaleMax: 0.44 /* pre-fix 0.25 */, minScaleBoth: 0.27 /* pre-fix 0.20 */ },
  { name: '1440x900', width: 1440, height: 900, longUp: 'arm0:V5H4:right', longUpMax: 'arm0:V5H7:right', minScaleLongUp: 0.38 /* pre-fix 0.30 */, minScaleMax: 0.38 /* pre-fix 0.22 */, minScaleBoth: 0.24 /* pre-fix 0.20 */ },
  { name: '1280x720', width: 1280, height: 720, longUp: 'arm0:V3H6:right', longUpMax: 'arm0:V3H9:right', minScaleLongUp: 0.38 /* pre-fix 0.20 */, minScaleMax: 0.38 /* pre-fix 0.22 (overflowed the container) */, minScaleBoth: 0.26 /* pre-fix 0.20 (overlapped HUD + rack) */ },
] as const;

for (const vp of LAPTOPS) {
  test.describe(`laptop/desktop ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test('a long upward arm turns into the unused width and keeps the board large', async ({ page }) => {
      await openRoutingHarness(page, 'fixture=longUp');
      const g = await measureBoard(page);
      expect(routes(g)).toEqual([vp.longUp]);
      expect(g.cameraScale).toBeGreaterThanOrEqual(vp.minScaleLongUp);
      expectClearOfChrome(g);
    });

    test('the longest possible single arm stays clear of the HUD and rack at a readable scale', async ({ page }) => {
      await openRoutingHarness(page, 'fixture=longUpMax');
      const g = await measureBoard(page);
      expect(routes(g)).toEqual([vp.longUpMax]);
      expect(g.cameraScale).toBeGreaterThanOrEqual(vp.minScaleMax);
      expectClearOfChrome(g);
    });

    test('long arms above and below turn independently and neither crowds the HUD or rack', async ({ page }) => {
      await openRoutingHarness(page, 'fixture=longBoth');
      const g = await measureBoard(page);
      expect(g.arms.map((a) => a.bendSide)).toEqual(['right', 'right']);
      expect(g.arms.every((a) => a.horizontalTiles > 0)).toBe(true);
      expect(g.cameraScale).toBeGreaterThanOrEqual(vp.minScaleBoth);
      expectClearOfChrome(g);
    });

    test('a long downward arm turns before it reaches the rack', async ({ page }) => {
      await openRoutingHarness(page, 'fixture=longDown');
      const g = await measureBoard(page);
      expect(g.arms).toHaveLength(1);
      expect(g.arms[0].key).toBe('arm1');
      expect(g.arms[0].bendSide).toBe('right');
      expect(g.distances.toRackTop).toBeGreaterThan(40);
      expectClearOfChrome(g);
    });

    test('a long horizontal main line is untouched by routing', async ({ page }) => {
      await openRoutingHarness(page, 'fixture=longHorizontal');
      const g = await measureBoard(page);
      expect(g.arms).toEqual([]);
      expectClearOfChrome(g);
    });
  });
}

test.describe('short and medium chains stay straight (no overcorrection)', () => {
  for (const vp of [{ width: 1512, height: 982 }, { width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
    test.describe(`${vp.width}x${vp.height}`, () => {
      test.use({ viewport: vp });
      test('three tiles per arm is not bent', async ({ page }) => {
        await openRoutingHarness(page, 'fixture=mediumBoth');
        const g = await measureBoard(page);
        expect(routes(g)).toEqual(['arm0:V3', 'arm1:V3']);
        expectClearOfChrome(g);
      });
    });
  }
});

// 1280x720 (508px board container) is the tightest laptop we calibrate against.
// The threshold is the readability limit in boardRouting.ts, not a tile count: arms
// stay straight while they fit comfortably and turn once they would not.
test.describe('1280x720 calibration: arm length -> route', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  const arms = [
    { tiles: 2, route: 'arm0:V2' },
    { tiles: 3, route: 'arm0:V3' },
    { tiles: 4, route: 'arm0:V3H1:right' },
    { tiles: 5, route: 'arm0:V3H2:right' },
    { tiles: 8, route: 'arm0:V3H5:right' },
  ];
  for (const a of arms) {
    test(`${a.tiles}-tile arm`, async ({ page }) => {
      await openRoutingHarness(page, `custom=1&up=${a.tiles}`);
      const g = await measureBoard(page);
      expect(routes(g)).toEqual([a.route]);
      expectClearOfChrome(g);
    });
  }

  test('3 tiles above and below both stay straight; 8+8 turns without touching the HUD or rack', async ({ page }) => {
    await openRoutingHarness(page, 'custom=1&up=3&down=3');
    expect(routes(await measureBoard(page))).toEqual(['arm0:V3', 'arm1:V3']);
    await openRoutingHarness(page, 'custom=1&up=8&down=8');
    const g = await measureBoard(page);
    expect(routes(g)).toEqual(['arm0:V3H5:right', 'arm1:V3H5:right']);
    expectClearOfChrome(g);
  });
});

test.describe('doubles never become the corner (real browser)', () => {
  test.use({ viewport: { width: 1280, height: 720 } });
  // At 1280x720 an ordinary tile would turn at arm index 3.
  const cases = [
    { name: 'double exactly at the turn: laid across the arm, turn waits two tiles', query: 'custom=1&up=9&upDouble=3', route: 'arm0:V5H4:right' },
    { name: 'double just before the threshold defers the same way', query: 'custom=1&up=9&upDouble=2', route: 'arm0:V4H5:right' },
    { name: 'no double: turns at the threshold', query: 'custom=1&up=9', route: 'arm0:V3H6:right' },
  ];
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await openRoutingHarness(page, c.query);
      const g = await measureBoard(page);
      expect(routes(g)).toEqual([c.route]);
      // The corner tile (first horizontal tile) is never a double: its box is wider than tall.
      const arm = g.tiles.filter((t) => t.key.startsWith('branch-0-0-')).sort((a, b) => Number(a.key.split('-')[3]) - Number(b.key.split('-')[3]));
      const cornerIndex = g.arms[0].verticalTiles;
      const parts = arm[cornerIndex].key.split('-');
      expect(parts[parts.length - 1]).not.toBe(parts[parts.length - 2]);
      expectClearOfChrome(g);
    });
  }
});

test.describe('routing is stable', () => {
  test.use({ viewport: { width: 1512, height: 982 } });

  test('rack size and score changes do not move the routing', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longUpMax&hand=7&score=15');
    const reference = await measureBoard(page);
    for (const query of ['fixture=longUpMax&hand=1&score=15', 'fixture=longUpMax&hand=7&score=88888']) {
      await openRoutingHarness(page, query);
      const g = await measureBoard(page);
      expect(routes(g)).toEqual(routes(reference));
      expect(g.tiles.map((t) => t.key)).toEqual(reference.tiles.map((t) => t.key));
      // The camera follows the container's exact height (a few px with the rack), the routing does not.
      expect(Math.abs(g.cameraScale / reference.cameraScale - 1)).toBeLessThan(0.05);
    }
  });

  test('a small resize does not re-route; a large one does, and coming back restores it exactly', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longUpMax');
    const start = await measureBoard(page);
    expect(routes(start)).toEqual(['arm0:V5H7:right']);

    await page.setViewportSize({ width: 1512, height: 990 });
    await waitForStableCamera(page);
    expect(routes(await measureBoard(page))).toEqual(routes(start));

    await page.setViewportSize({ width: 1280, height: 720 });
    await waitForStableCamera(page);
    const small = await measureBoard(page);
    expect(routes(small)).toEqual(['arm0:V3H9:right']);
    expectClearOfChrome(small);

    await page.setViewportSize({ width: 1512, height: 982 });
    await waitForStableCamera(page);
    const back = await measureBoard(page);
    expect(routes(back)).toEqual(routes(start));
    expect(back.cameraScale).toBeCloseTo(start.cameraScale, 2);
  });
});

test.describe('zoom, pan and home do not fight the routing', () => {
  test.use({ viewport: { width: 1512, height: 982 } });

  test('zooming and panning leave the routing alone, and home returns to the fitted view', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longUpMax');
    const fitted = await measureBoard(page);
    const box = fitted.container;
    const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };

    await page.mouse.move(centre.x, centre.y);
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(250);
    const zoomed = await measureBoard(page);
    expect(zoomed.cameraScale).toBeGreaterThan(fitted.cameraScale);
    expect(routes(zoomed)).toEqual(routes(fitted));

    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await page.mouse.move(centre.x + 120, centre.y + 80, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect(routes(await measureBoard(page))).toEqual(routes(fitted));

    await page.mouse.dblclick(centre.x, centre.y);
    await waitForStableCamera(page);
    const home = await measureBoard(page);
    expect(home.cameraScale).toBeCloseTo(fitted.cameraScale, 2);
    expect(routes(home)).toEqual(routes(fitted));
    expectClearOfChrome(home);
  });

  test('the fit scale is a safety net, not the fix: the routed board is much larger than the straight one was', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longUpMax');
    const g = await measureBoard(page);
    // Pre-fix at this viewport: scale 0.25 with the arm running 585px of the 756px container.
    expect(g.cameraScale).toBeGreaterThan(0.25 * 1.7);
    expect(g.boardBox!.height).toBeLessThan(g.container.height * 0.7);
  });
});

test.describe('phone landscape routes by tile count (one straight tile, then the arm turns)', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('arms turn after one tile and the board is much larger than the old two-tile rule gave', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=longBoth');
    const g = await measureBoard(page);
    expect(routes(g)).toEqual(['arm0:V1H7:right', 'arm1:V1H7:right']);
    // Two-tile routing with flat-padded bounds fitted this board at 0.14 (11.8px tiles); one-tile
    // routing with exact drop-zone bounds, kept clear of the controls tray and corner pills, fits it
    // at 0.26 (22px). Guard the 18px readability floor.
    expect(g.cameraScale).toBeGreaterThan(18 / 84);
    expect(g.cameraScale).toBeCloseTo(0.26, 1);
    expect(g.intersectsExclusion).toEqual([]);
  });

  test('a medium chain turns after one tile on the phone only', async ({ page }) => {
    await openRoutingHarness(page, 'fixture=mediumBoth');
    expect(routes(await measureBoard(page))).toEqual(['arm0:V1H2:right', 'arm1:V1H2:right']);
  });
});
