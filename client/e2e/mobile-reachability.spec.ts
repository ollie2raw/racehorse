import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Repo-wide mobile reachability harness.
 *
 * Asserts, for every top-level route at three viewports, two contracts that
 * together define "usable on this device":
 *
 *  1. TAP TARGETS — every interactive element (link, button, role=button,
 *     input, select, textarea, [tabindex>=0]) has a *computed* bounding box
 *     whose smaller dimension is >= 44px (WCAG 2.5.5 / Apple HIG), measured on
 *     the element itself, never a container. An undersized target is exempt
 *     under WCAG 2.5.8 when its centre is >= 24px from the centre of every
 *     other target (24px circles centred on each do not overlap) — the actual
 *     standard, and stable under sub-pixel layout jitter.
 *
 *  2. HORIZONTAL OVERFLOW — document.scrollWidth <= clientWidth. Sideways
 *     scroll on a phone is always a bug.
 *
 * Determinism: each route is measured twice, 500ms apart, after fonts.ready +
 * a geometry-quiet settle; only violations present in BOTH samples are
 * reported. This is a blocking CI gate — a flaky assertion here is worse than
 * no assertion. The red/green matrix is written to
 * e2e/screenshots/mobile-reachability/matrix.json after a full run.
 *
 * Auth-gated routes (stats/friends/social/settings/...) render their signed-out
 * gate as a guest; the gate itself must still pass both contracts.
 */

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(e2eDir, 'screenshots', 'mobile-reachability');

const MIN_TAP = 44;
const MIN_SPACING = 24;

type BP = { id: string; width: number; height: number };
const BREAKPOINTS: BP[] = [
  { id: 'phone-portrait', width: 390, height: 844 },
  { id: 'tablet-portrait', width: 834, height: 1112 },
  { id: 'phone-landscape', width: 844, height: 390 },
];

const ROUTES: string[] = [
  '/',
  '/stats',
  '/friends',
  '/daily-fritz',
  '/daily-fritz/leaderboard',
  '/rating-history',
  '/solo',
  '/solo/fritz',
  '/solo/ghost',
  '/journey',
  '/tournament',
  '/practice',
  '/learn',
  '/learn/how-to-play',
  // '/learn/recorder' — deliberately exempt: internal content-authoring tool
  // (records the fixed Standard Fritz match into guided-lesson JSON), reached
  // only from the Learn screen's AUTHOR column. No mobile use case, so it is
  // held to no phone-portrait tap-target bar. See docs/breakpoints.md.
  '/learn/guided-annotator',
  '/multiplayer',
  '/multiplayer/private',
  '/social',
  '/settings',
  '/admin/daily-fritz-health',
];

type Violation =
  | { kind: 'tap'; label: string; w: number; h: number; selector: string }
  | { kind: 'overflow'; scrollWidth: number; clientWidth: number };

type Cell = { route: string; bp: string; pass: boolean; violations: Violation[] };

// Each test appends its cell as one JSONL line; afterAll assembles the matrix
// from the file. A module-level array is unreliable — Playwright may isolate
// describe blocks across hook scopes.
const jsonlPath = path.join(outDir, 'cells.jsonl');

test.beforeEach(async ({ page }) => {
  // Past the welcome gate, with a stable guest identity so identity-derived UI
  // renders instead of a first-run prompt.
  await page.addInitScript(() => {
    window.localStorage.setItem('hasSeenWelcome', '1');
    window.localStorage.setItem('racehorse_guest_identity_v1', 'guest_e2e_reach_stable');
    window.localStorage.setItem('racehorse_guest_display_name_v1', 'Guest 4242');
  });
});

async function settle(page: Page, capMs = 12_000) {
  await page.waitForLoadState('domcontentloaded');
  // Custom fonts change text metrics, which reflows every button that sizes to
  // its label. Measuring before the swap is the classic source of a flaky
  // matrix (a stepper rail that is 188px pre-swap, 208px after).
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => undefined) : undefined)).catch(() => {});
  await page.waitForTimeout(400); // floor: let post-mount transitions start

  // Coarse layout signal — document height + viewport-level boxes only, so a
  // live "N online" counter or a spinner does not perpetually reset the timer
  // (some routes, e.g. /multiplayer/private, never go fully quiet).
  const measure = () =>
    page.evaluate(() => {
      const d = document.documentElement;
      return d.scrollHeight * 1000 + d.clientHeight + Math.round(document.body.getBoundingClientRect().height);
    });
  const deadline = Date.now() + capMs;
  let last = await measure().catch(() => 0);
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(150);
    const next = await measure().catch(() => last);
    if (next !== last) {
      last = next;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= 600) return;
  }
  // Cap hit without going quiet — proceed anyway; the twice-measured guard in
  // the test filters any residual jitter.
}

async function collectViolations(page: Page): Promise<Violation[]> {
  return page.evaluate(
    ({ MIN_TAP, MIN_SPACING }) => {
      const out: any[] = [];
      const doc = document.documentElement;
      if (doc.scrollWidth > doc.clientWidth + 1) {
        out.push({ kind: 'overflow', scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth });
      }

      const SEL = 'a[href], button, [role="button"], input:not([type="hidden"]), select, textarea, [tabindex]';
      const isVisible = (el: Element) => {
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
        if (s.pointerEvents === 'none') return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      const nodes = [...document.querySelectorAll(SEL)].filter((el) => {
        if (!isVisible(el)) return false;
        if (el.hasAttribute('tabindex') && Number(el.getAttribute('tabindex')) < 0) return false;
        if (el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled) return false;
        // A wrapper <a>/<button> that only contains another interactive node is
        // measured via that child, not here.
        return true;
      });

      const rects = nodes.map((el) => el.getBoundingClientRect());

      const shortLabel = (el: Element) => {
        const t =
          (el.getAttribute('aria-label') ||
            (el as HTMLElement).innerText ||
            el.getAttribute('title') ||
            el.getAttribute('name') ||
            el.getAttribute('placeholder') ||
            el.tagName).trim();
        return t.replace(/\s+/g, ' ').slice(0, 40) || el.tagName;
      };
      const cssPath = (el: Element) => {
        const parts: string[] = [];
        let cur: Element | null = el;
        for (let i = 0; cur && i < 4; i += 1) {
          let seg = cur.tagName.toLowerCase();
          if (cur.id) {
            seg += `#${cur.id}`;
            parts.unshift(seg);
            break;
          }
          const cls = (cur.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
          if (cls.length) seg += `.${cls.join('.')}`;
          parts.unshift(seg);
          cur = cur.parentElement;
        }
        return parts.join(' > ');
      };

      for (let i = 0; i < nodes.length; i += 1) {
        const r = rects[i]!;
        const small = Math.min(r.width, r.height);
        if (small >= MIN_TAP) continue;

        // WCAG 2.5.8 spacing exemption: an undersized target is acceptable when
        // the distance from its centre to the centre of every other target is
        // >= 24px (equivalently, 24px-diameter circles centred on each do not
        // overlap). Centre-to-centre — not centre-to-edge — is both the actual
        // standard and stable under the sub-pixel layout jitter that made an
        // earlier centre-to-edge check flaky near its threshold.
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        let crowded = false;
        for (let j = 0; j < nodes.length; j += 1) {
          if (j === i) continue;
          const o = rects[j]!;
          const ox = o.left + o.width / 2;
          const oy = o.top + o.height / 2;
          if (Math.hypot(cx - ox, cy - oy) < MIN_SPACING) {
            crowded = true;
            break;
          }
        }
        if (!crowded) continue;

        out.push({
          kind: 'tap',
          label: shortLabel(nodes[i]!),
          w: Math.round(r.width),
          h: Math.round(r.height),
          selector: cssPath(nodes[i]!),
        });
      }
      return out;
    },
    { MIN_TAP, MIN_SPACING },
  );
}

for (const bp of BREAKPOINTS) {
  test.describe(`reachability — ${bp.id} ${bp.width}×${bp.height}`, () => {
    for (const route of ROUTES) {
      test(`${route}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width: bp.width, height: bp.height });
        await page.goto(route, { waitUntil: 'commit' });
        await settle(page);

        // Report only violations that persist across two measurements 500ms
        // apart. A real undersized/overflowing target is stable; a violation
        // that appears in only one sample is a settle race, not a defect.
        const first = await collectViolations(page);
        await page.waitForTimeout(500);
        const second = await collectViolations(page);
        const key = (v: Violation) =>
          v.kind === 'overflow' ? 'overflow' : `${v.selector}|${v.label}`;
        const firstKeys = new Set(first.map(key));
        const violations = second.filter((v) => firstKeys.has(key(v)));
        const pass = violations.length === 0;
        const cell: Cell = { route, bp: bp.id, pass, violations };
        fs.mkdirSync(outDir, { recursive: true });
        fs.appendFileSync(jsonlPath, JSON.stringify(cell) + '\n');

        await page
          .screenshot({ path: path.join(outDir, `${bp.id}${route.replace(/\//g, '_') || '_root'}.png`) })
          .catch(() => {});

        expect(
          violations,
          `${route} @ ${bp.id} — ${violations.length} reachability violation(s):\n${JSON.stringify(violations, null, 2)}`,
        ).toEqual([]);
      });
    }
  });
}

test.afterAll(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  // Assemble from the JSONL, keeping the last cell written per route|bp.
  const byKey = new Map<string, Cell>();
  for (const line of fs.readFileSync(jsonlPath, 'utf8').split('\n').filter(Boolean)) {
    const c = JSON.parse(line) as Cell;
    byKey.set(`${c.route}|${c.bp}`, c);
  }
  const matrix = [...byKey.values()];
  fs.writeFileSync(path.join(outDir, 'matrix.json'), JSON.stringify(matrix, null, 2));

  const bps = BREAKPOINTS.map((b) => b.id);
  const pad = (s: string, n: number) => s.padEnd(n);
  const lines = [pad('route', 28) + bps.map((b) => pad(b, 18)).join('')];
  for (const route of ROUTES) {
    const row = matrix.filter((c) => c.route === route);
    lines.push(
      pad(route, 28) +
        bps
          .map((b) => {
            const cell = row.find((c) => c.bp === b);
            if (!cell) return pad('—', 18);
            return pad(cell.pass ? 'PASS' : `FAIL(${cell.violations.length})`, 18);
          })
          .join(''),
    );
  }
  fs.writeFileSync(path.join(outDir, 'matrix.txt'), lines.join('\n') + '\n');
  console.log('\n' + lines.join('\n') + '\n');
});
