/**
 * Real-browser regression for the board camera and tile identity (audit, 2026-11-21). Mounts the real LiveMatchScreen through the routing harness
 * and plays boards one placement at a time (`seq=` in boardRoutingHarness.tsx), so the placements are deterministic and the ends are chosen, not
 * random. Tiles are tracked by their pips (the last two numbers of data-layout-key), never by a positional React key.
 *
 * Two kinds of check, because they catch different things:
 *   INSTANT: tile positions read in the same task as the render (flushSync), before any animation frame can have moved the camera. A placement must
 *            not move a placed tile by itself. This is not timing-dependent. It failed for every left-end placement while the layout key contained
 *            the tile's position in the main line (the world frame lost every tile), and for bent arms whose side flipped on phones.
 *   FRAMES:  per-frame tile positions while the camera glides: no teleport (normalised to a 60 Hz frame so a slow runner does not look like a jump),
 *            it settles, and the whole board ends up inside the container.
 * The same checks run for camera policy A (default) and policy B ('comfort', config/boardCameraPolicy.ts).
 */
import { expect, test, type Page } from '@playwright/test';
import { openRoutingHarness, waitForStableCamera } from './support/boardGeometry';

interface StepResult {
  instantPx: number;
  maxPxPer16ms: number;
  settled: boolean;
  settleMs: number;
  cameraBefore: string;
  cameraAfter: string;
  allInside: boolean;
  tiles: number;
  container: { w: number; h: number };
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    type H = { show: (i: number) => void; length: number };
    const w = window as unknown as { __camHarness: H; __stepAndMeasure: (i: number) => Promise<StepResult> };
    interface StepResult { instantPx: number; maxPxPer16ms: number; settled: boolean; settleMs: number; cameraBefore: string; cameraAfter: string; allInside: boolean; tiles: number; container: { w: number; h: number } }
    const snap = () => {
      const m = new Map<string, [number, number]>();
      document.querySelectorAll<HTMLElement>('.board-tile-wrapper').forEach((el) => {
        const id = /(\d+)-(\d+)$/.exec(el.dataset.layoutKey ?? '');
        if (!id) return;
        const r = el.getBoundingClientRect();
        m.set(`${id[1]}-${id[2]}`, [r.left + r.width / 2, r.top + r.height / 2]);
      });
      return m;
    };
    const canvas = () => document.querySelector<HTMLElement>('.board-canvas')!;
    const maxMove = (a: Map<string, [number, number]>, b: Map<string, [number, number]>) => {
      let m = 0;
      for (const [id, p] of b) { const q = a.get(id); if (q) m = Math.max(m, Math.hypot(p[0] - q[0], p[1] - q[1])); }
      return m;
    };
    w.__stepAndMeasure = async (i: number) => {
      const before = snap();
      const cameraBefore = canvas().style.transform;
      w.__camHarness.show(i); // renders synchronously
      const instantPx = maxMove(before, snap()); // same task: no animation frame has run
      let prev = snap();
      let prevT = performance.now();
      const t0 = prevT;
      let maxPxPer16ms = 0;
      let settled = false;
      let settleMs = 0;
      await new Promise<void>((resolve) => {
        const tick = () => {
          const now = performance.now();
          const cur = snap();
          const dt = Math.max(1, now - prevT);
          maxPxPer16ms = Math.max(maxPxPer16ms, (maxMove(prev, cur) * 16.7) / dt);
          prev = cur; prevT = now;
          if (canvas().dataset.cameraSettled === 'true' && now - t0 > 60) { settled = true; settleMs = Math.round(now - t0); resolve(); return; }
          if (now - t0 > 3000) { resolve(); return; }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const c = document.querySelector('.board-container')!.getBoundingClientRect();
      let allInside = true;
      document.querySelectorAll<HTMLElement>('.board-tile-wrapper').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.left < c.left - 1 || r.right > c.right + 1 || r.top < c.top - 1 || r.bottom > c.bottom + 1) allInside = false;
      });
      return { instantPx, maxPxPer16ms, settled, settleMs, cameraBefore, cameraAfter: canvas().style.transform, allInside, tiles: document.querySelectorAll('.board-tile-wrapper').length, container: { w: c.width, h: c.height } };
    };
  });
}

async function playOnce(page: Page, seq: string, policy: 'full' | 'comfort'): Promise<StepResult[]> {
  await openRoutingHarness(page, `seq=${seq}`);
  await expect(page.locator('.board-container')).toHaveAttribute('data-camera-policy', policy);
  await installProbe(page);
  // The camera snaps for a short window after mount; the placements below must be the animated kind.
  await page.waitForTimeout(700);
  await waitForStableCamera(page);
  const length = await page.evaluate(() => (window as unknown as { __camHarness: { length: number } }).__camHarness.length);
  const out: StepResult[] = [];
  for (let i = 1; i < length; i += 1) out.push(await page.evaluate((k) => (window as unknown as { __stepAndMeasure: (i: number) => Promise<StepResult> }).__stepAndMeasure(k), i));
  return out;
}

async function play(page: Page, seq: string, policy: 'full' | 'comfort'): Promise<StepResult[]> {
  await page.addInitScript((p) => { try { window.localStorage.setItem('racehorse_board_camera_policy', p); } catch { /* none */ } }, policy);
  // The dev server can reload the page once while it optimises dependencies on a cold start or under load ("Execution context was destroyed"). That is
  // the tool, not the board: replay the whole sequence from a fresh load. Assertions run on the result, so a real failure is never retried away.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await playOnce(page, seq, policy);
    } catch (error) {
      if (attempt >= 3 || !/^Error: page\.evaluate: Execution context was destroyed, most likely because of a navigation/.test(String(error))) throw error;
    }
  }
}

const SEQUENCES: Array<{ name: string; seq: string; needsPhone?: boolean }> = [
  { name: 'left-end placements', seq: 'LLLLLL' },
  { name: 'right-end placements', seq: 'RRRRRR' },
  { name: 'alternating left and right', seq: 'LRLRLRLR' },
  { name: 'expanding substantially in one direction', seq: 'RRRRRRRRRR' },
  { name: 'expanding in both directions', seq: 'LLLRRRLLRR' },
  { name: 'arms and both ends (bent arms must not flip sides)', seq: 'UULRUDLR' },
];

const PROFILES = [
  { name: 'phone landscape 844x390', viewport: { width: 844, height: 390 }, phone: true },
  { name: 'desktop 1440x900', viewport: { width: 1440, height: 900 }, phone: false },
] as const;

for (const profile of PROFILES) {
  for (const policy of ['full', 'comfort'] as const) {
    test.describe(`board camera: ${profile.name}, policy ${policy === 'full' ? 'A (full recentre, default)' : 'B (comfort hold)'}`, () => {
      test.use({ viewport: profile.viewport, ...(profile.phone ? { isMobile: true, hasTouch: true } : {}) });
      test.describe.configure({ retries: 0 });

      for (const s of SEQUENCES) {
        test(s.name, async ({ page }) => {
          test.setTimeout(240_000);
          const steps = await play(page, s.seq, policy);
          expect(steps.length).toBe(s.seq.length);
          steps.forEach((r, i) => {
            const label = `${s.seq[i]} (placement ${i + 1}, ${r.tiles} tiles)`;
            // INSTANT: a placement alone never moves a tile that was already on the board.
            expect(r.instantPx, `${label}: a placed tile moved on screen in the same task as the placement`).toBeLessThan(1.5);
            // FRAMES: smooth glide, no teleport, settles, board visible.
            expect(r.maxPxPer16ms, `${label}: single-frame move`).toBeLessThan(30);
            expect(r.settled, `${label}: the camera settles`).toBe(true);
            expect(r.settleMs, `${label}: settle time`).toBeLessThan(2500);
            expect(r.allInside, `${label}: every tile inside the container`).toBe(true);
          });
        });
      }

      if (policy === 'comfort' && !profile.phone) {
        // Policy B only holds when the board has room to spare in the dimension that is growing: a main line that is already as wide as the
        // viewport allows refits on every tile (no spare room, so no hold), but a tall hub with arms leaves width, and the tiles that follow fit.
        test('policy B holds the camera while the board is comfortable, and refits (as policy A does) when it is not', async ({ page }) => {
          test.setTimeout(240_000);
          const steps = await play(page, 'UDLRUDLR', 'comfort');
          const held = steps.filter((r) => r.cameraBefore === r.cameraAfter).length;
          expect(held, 'placements that left the camera exactly where it was').toBeGreaterThanOrEqual(2);
          expect(held, 'it does not hold forever: some placements still refit').toBeLessThan(steps.length);
          expect(steps.every((r) => r.allInside)).toBe(true);
        });
      }
    });
  }
}
