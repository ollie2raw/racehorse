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
 *     whose smaller dimension is >= 44px (WCAG 2.5.5 / Apple HIG). We measure
 *     getBoundingClientRect() on the element itself, never a container.
 *     Elements smaller than 44px in BOTH dimensions but with >= 24px and
 *     >= 44px of slack to their nearest interactive neighbour are treated as
 *     spacing-exempt (WCAG 2.5.8), matching how a finger actually resolves
 *     targets.
 *
 *  2. HORIZONTAL OVERFLOW — document.scrollWidth <= clientWidth. Sideways
 *     scroll on a phone is always a bug.
 *
 * This is the CI worklist for the screen-by-screen mobile pass. It is
 * infrastructure: it fixes nothing. A route that fails here is a route that
 * needs hand work. The red/green matrix is written to
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

async function settle(page: Page, timeoutMs = 20_000) {
  await page.waitForLoadState('domcontentloaded');
  // Poll geometry until it stops moving rather than sleeping a fixed interval.
  const measure = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('*')].reduce((a, el) => a + el.scrollHeight + el.clientHeight, 0),
    );
  const deadline = Date.now() + timeoutMs;
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

        // WCAG 2.5.8 spacing exemption: a small target is acceptable if a 24px
        // radius circle at its centre reaches no other target's box.
        let crowded = false;
        for (let j = 0; j < nodes.length; j += 1) {
          if (j === i) continue;
          const o = rects[j]!;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const dx = Math.max(o.left - cx, 0, cx - o.right);
          const dy = Math.max(o.top - cy, 0, cy - o.bottom);
          if (Math.hypot(dx, dy) < MIN_SPACING) {
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

        const violations = await collectViolations(page);
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
