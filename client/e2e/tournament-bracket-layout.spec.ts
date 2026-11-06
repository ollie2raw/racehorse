/**
 * The tournament bracket and result screens as a player meets them, measured: the bracket tree fits its window without
 * scrolling and every match sits where its feeders say, lines join the rounds, a phone gets one round at a time with
 * every match reachable, and the result screen's headline, records and actions are laid out and tappable.
 *
 * Rendered through the e2e-only harness (e2e/harness/tournament-play.html) with fixture data: no server, nothing but
 * the dev server on the network. Stages: lobby (just locked, nothing played), sf (mid-event), final (finished).
 */
import { expect, test, type Page } from '@playwright/test';

const HARNESS = '/e2e/harness/tournament-play.html';

async function open(page: Page, query: string) {
  // Only the dev server: nothing reaches Supabase or any other host.
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (route) => route.abort());
  await page.goto(`${HARNESS}?${query}`);
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const DESKTOPS = [
  { name: '1288x800', width: 1288, height: 800 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x700', width: 1024, height: 700 },
] as const;

const PHONES = [
  { name: '390x844', width: 390, height: 844 },
  { name: '320x640', width: 320, height: 640 },
] as const;

/** Vertical centre of the first element matching `selector` inside `scope`. */
async function centreY(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return box.y + box.height / 2;
}

for (const viewport of DESKTOPS) {
  test.describe(`bracket tree at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    for (const stage of ['lobby', 'sf', 'final'] as const) {
      test(`${stage}: the whole tree fits the window with no scrolling anywhere`, async ({ page }) => {
        await open(page, `view=bracket&stage=${stage}`);
        await expect(page.locator('.tb-bracket')).toBeVisible();
        await noHorizontalOverflow(page);
        const scroll = await page.evaluate(() => {
          const bracket = document.querySelector('.tb-bracket')!;
          return {
            page: document.documentElement.scrollHeight - document.documentElement.clientHeight,
            bracket: bracket.scrollHeight - bracket.clientHeight,
          };
        });
        expect(scroll.page).toBeLessThanOrEqual(1);
        // The old layout needed 48-543px of scrolling inside the bracket here, with the last quarterfinal cut off.
        expect(scroll.bracket).toBeLessThanOrEqual(1);
        const outside = await page.evaluate(() => {
          const region = document.querySelector('.tb-bracket')!.getBoundingClientRect();
          return [...document.querySelectorAll('.tb-match, .tb-champion-card')]
            .map((el) => ({ el: el.className, r: el.getBoundingClientRect() }))
            .filter(({ r }) => r.top < region.top - 1 || r.bottom > region.bottom + 1 || r.left < region.left - 1 || r.right > region.right + 1)
            .map(({ el }) => el);
        });
        expect(outside).toEqual([]);
      });
    }

    test('each later round sits on the midpoint of the matches that feed it, and the champion on the final', async ({ page }) => {
      await open(page, 'view=bracket&stage=lobby');
      await expect(page.locator('.tb-bracket')).toBeVisible();
      const centres = await page.evaluate(() => {
        const rounds = [1, 2, 3].map((round) =>
          [...document.querySelectorAll(`.tb-col--r${round} .tb-match`)].map((el) => {
            const r = el.getBoundingClientRect();
            return r.top + r.height / 2;
          }),
        );
        const champion = document.querySelector('.tb-champion-card')!.getBoundingClientRect();
        return { qf: rounds[0], sf: rounds[1], final: rounds[2], champion: champion.top + champion.height / 2 };
      });
      expect(centres.qf).toHaveLength(4);
      expect(centres.sf).toHaveLength(2);
      expect(Math.abs(centres.sf[0] - (centres.qf[0] + centres.qf[1]) / 2)).toBeLessThan(2);
      expect(Math.abs(centres.sf[1] - (centres.qf[2] + centres.qf[3]) / 2)).toBeLessThan(2);
      expect(Math.abs(centres.final[0] - (centres.sf[0] + centres.sf[1]) / 2)).toBeLessThan(2);
      expect(Math.abs(centres.champion - centres.final[0])).toBeLessThan(2);
    });

    test('lines join the rounds: a stub out of each match, a join for each pair, a stub into each later card', async ({ page }) => {
      await open(page, 'view=bracket&stage=sf');
      await expect(page.locator('.tb-bracket')).toBeVisible();
      const lines = await page.evaluate(() => {
        const drawn = (el: Element, pseudo: string) => {
          const style = getComputedStyle(el, pseudo);
          return style.content !== 'none' && style.content !== 'normal' && parseFloat(style.width) + parseFloat(style.height) > 0;
        };
        const slots = [...document.querySelectorAll('.tb-col--r1 .tb-mslot, .tb-col--r2 .tb-mslot, .tb-col--r3 .tb-mslot')];
        const joins = [...document.querySelectorAll('.tb-mslot--join-down, .tb-mslot--join-up')];
        const cards = [...document.querySelectorAll('.tb-col--r2 .tb-match, .tb-col--r3 .tb-match, .tb-champion-card')];
        return {
          slots: slots.length,
          stubsOut: slots.filter((slot) => drawn(slot, '::after')).length,
          joins: joins.length,
          joinsDrawn: joins.filter((slot) => drawn(slot, '::before')).length,
          cards: cards.length,
          stubsIn: cards.filter((card) => drawn(card, '::before')).length,
        };
      });
      expect(lines.slots).toBe(7);
      expect(lines.stubsOut).toBe(7);
      expect(lines.joins).toBe(6);
      expect(lines.joinsDrawn).toBe(6);
      expect(lines.cards).toBe(4);
      expect(lines.stubsIn).toBe(4);
    });

    test('decided paths are brighter than pending ones, and the viewer\'s own path is the accent', async ({ page }) => {
      await open(page, 'view=bracket&stage=sf');
      await expect(page.locator('.tb-bracket')).toBeVisible();
      const colours = await page.evaluate(() => {
        const line = (selector: string) => getComputedStyle(document.querySelector(selector)!, '::after').borderTopColor;
        return {
          pending: line('.tb-col--r2 .tb-mslot:not(.tb-mslot--decided)'),
          decided: line('.tb-col--r1 .tb-mslot--decided:not(.tb-mslot--you)'),
          you: line('.tb-col--r1 .tb-mslot--you'),
        };
      });
      expect(new Set([colours.pending, colours.decided, colours.you]).size).toBe(3);
    });

    test('the tree is readable by name: rounds are lists, matches are groups', async ({ page }) => {
      await open(page, 'view=bracket&stage=sf');
      await expect(page.getByRole('list', { name: 'Quarterfinals', exact: true }).getByRole('listitem')).toHaveCount(4);
      await expect(page.getByRole('list', { name: 'Semifinals', exact: true }).getByRole('listitem')).toHaveCount(2);
      await expect(page.getByRole('list', { name: 'Final', exact: true }).getByRole('listitem')).toHaveCount(1);
    });
  });
}

for (const viewport of PHONES) {
  test.describe(`bracket on a phone at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('one round at a time, and every match of the round can be reached', async ({ page }) => {
      await open(page, 'view=bracket&stage=lobby');
      await expect(page.locator('.tb-bracket')).toBeVisible();
      await noHorizontalOverflow(page);
      for (const [index, label] of ['Quarterfinals', 'Semifinals', 'Final'].entries()) {
        await page.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
        const round = index + 1;
        const matches = page.locator(`.tb-col--r${round} .tb-match`);
        const count = await matches.count();
        expect(count).toBeGreaterThan(0);
        for (let i = 0; i < count; i++) {
          await matches.nth(i).scrollIntoViewIfNeeded();
          const reachable = await matches.nth(i).evaluate((el) => {
            const r = el.getBoundingClientRect();
            const region = document.querySelector('.tb-bracket')!.getBoundingClientRect();
            return r.top >= region.top - 1 && r.bottom <= region.bottom + 1 && r.left >= -1 && r.right <= window.innerWidth + 1;
          });
          expect(reachable, `round ${round} match ${i + 1} is inside the visible bracket region`).toBe(true);
        }
        await noHorizontalOverflow(page);
        // The tree's lines belong to the wide layout; a phone shows none.
        const stubs = await page.evaluate(() => [...document.querySelectorAll('.tb-mslot')].filter((el) => getComputedStyle(el, '::after').display !== 'none').length);
        expect(stubs).toBe(0);
      }
    });
  });
}

const RESULT_VIEWPORTS = [...DESKTOPS, ...PHONES, { name: '820x700', width: 820, height: 700 }] as const;

for (const viewport of RESULT_VIEWPORTS) {
  test.describe(`result screen at ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test('headline, records and actions are laid out, tappable and inside the window', async ({ page }) => {
      await open(page, 'view=result&next=1');
      await expect(page.getByRole('heading', { level: 1, name: 'Runner-Up' })).toBeVisible();
      await noHorizontalOverflow(page);

      // The headline letters must not collide: tracking is never negative and the lines are not tighter than the type.
      const title = await page.locator('.tr-champion-title').evaluate((el) => {
        const style = getComputedStyle(el);
        return { letterSpacing: parseFloat(style.letterSpacing) || 0, lineHeight: parseFloat(style.lineHeight), fontSize: parseFloat(style.fontSize) };
      });
      expect(title.letterSpacing).toBeGreaterThanOrEqual(0);
      expect(title.lineHeight).toBeGreaterThanOrEqual(title.fontSize);

      // Join (a ready match), Return and View Bracket: real buttons, 44px or more, none clipped off the right.
      for (const name of ['Join Final', 'Return to Tournament', 'View Bracket']) {
        const button = page.getByRole('button', { name });
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        expect(box, name).not.toBeNull();
        expect(box!.height, `${name} height`).toBeGreaterThanOrEqual(44);
        expect(box!.x, `${name} left`).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width, `${name} right`).toBeLessThanOrEqual(viewport.width + 1);
      }

      // The three records share a structure and their values sit on the same lines (side by side) or the same rows.
      const stats = await page.evaluate(() =>
        [...document.querySelectorAll('.tr-stat')].map((stat) => {
          const rect = (selector: string) => stat.querySelector(selector)!.getBoundingClientRect();
          const box = stat.getBoundingClientRect();
          return {
            top: box.top,
            height: box.height,
            labelOffset: rect('.tr-stat__label').top - box.top,
            valueOffset: rect('.tr-stat__value').top - box.top,
            subOffset: rect('.tr-stat__sub').top - box.top,
          };
        }),
      );
      expect(stats).toHaveLength(3);
      for (const stat of stats) {
        expect(Math.abs(stat.labelOffset - stats[0].labelOffset)).toBeLessThan(1);
        expect(Math.abs(stat.valueOffset - stats[0].valueOffset)).toBeLessThan(1);
        expect(Math.abs(stat.subOffset - stats[0].subOffset)).toBeLessThan(1);
        expect(Math.abs(stat.height - stats[0].height)).toBeLessThan(1);
      }
    });

    test('the page does not scroll by accident', async ({ page }) => {
      await open(page, 'view=result');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const scroll = await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight);
      expect(scroll).toBeLessThanOrEqual(1);
      // Only the tallest phone content may scroll, and only inside the shell (the shell is reachable from the top).
      const shell = await page.evaluate(() => {
        const el = document.querySelector('.tr-shell')!;
        return { overflow: el.scrollHeight - el.clientHeight, top: el.getBoundingClientRect().top };
      });
      if (viewport.height >= 700) expect(shell.overflow).toBeLessThanOrEqual(1);
    });
  });
}
