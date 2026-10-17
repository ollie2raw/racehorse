/** In-browser board geometry measurement shared by the board-routing e2e specs. */
import type { Page } from '@playwright/test';

export const ROUTING_HARNESS = '/e2e/harness/board-routing.html';

export const EXCLUSION_SELECTORS: Record<string, string> = {
  hudPill: '.rh-hud-pill',
  hudCenter: '.rh-hud-center',
  boardControls: '.rh-board-controls',
  boardMeta: '.rh-board-meta-bar',
  zoomTray: '.board-zoom-tray',
  rack: '.hand-area[data-ui="tray"]',
};

export interface Box { left: number; top: number; right: number; bottom: number; width: number; height: number }

export interface ArmReport {
  key: string;
  tiles: number;
  /** e.g. "V6H3": vertical tiles then horizontal tiles. */
  route: string;
  verticalTiles: number;
  horizontalTiles: number;
  bendSide: 'none' | 'left' | 'right';
  exposed: { key: string; rect: Box };
}

export interface GeometryReport {
  viewport: { width: number; height: number };
  container: Box;
  exclusions: Array<{ name: string; rect: Box }>;
  cameraScale: number;
  tileCount: number;
  boardBox: Box | null;
  distances: { toContainerTop: number; toContainerBottom: number; toContainerLeft: number; toContainerRight: number; toHudBottom: number | null; toRackTop: number | null };
  intersectsExclusion: string[];
  arms: ArmReport[];
  tiles: Array<{ key: string; rect: Box }>;
}

export async function openRoutingHarness(page: Page, query: string): Promise<void> {
  await page.route((url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1', (route) => route.abort());
  await page.goto(`${ROUTING_HARNESS}?${query}`);
  await page.waitForSelector('.board-tile-wrapper');
  await waitForStableCamera(page);
}

/** The camera transform is eased: sample it until it stops moving (or give up after ~4s). */
export async function waitForStableCamera(page: Page): Promise<void> {
  // Fresh samples every call: stale ones from before a resize would read as "stable" at once.
  await page.evaluate(async () => {
    // Web fonts change the HUD/rack heights, hence the container, hence the fit.
    await document.fonts.ready;
    (window as unknown as { __camSamples?: string[] }).__camSamples = [];
  });
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('.board-canvas') as HTMLElement | null;
      const container = document.querySelector('.board-container');
      if (!canvas || !container) return false;
      const w = window as unknown as { __camSamples?: string[] };
      const samples = (w.__camSamples ??= []);
      samples.push(`${getComputedStyle(canvas).transform}|${container.getBoundingClientRect().height}`);
      if (samples.length > 10) samples.shift();
      return samples.length === 10 && samples.every((s) => s === samples[0]);
    },
    undefined,
    { polling: 100, timeout: 5000 },
  ).catch(() => undefined);
}

export async function measureBoard(page: Page): Promise<GeometryReport> {
  return page.evaluate((exclusionSelectors) => {
    const box = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height });
    const container = document.querySelector('.board-container')!.getBoundingClientRect();
    const canvas = document.querySelector('.board-canvas') as HTMLElement;
    const m = new DOMMatrixReadOnly(getComputedStyle(canvas).transform);
    const tiles = [...document.querySelectorAll<HTMLElement>('.board-tile-wrapper')].map((w) => ({
      key: w.dataset.layoutKey ?? '',
      rect: box((w.querySelector('.board-tile') ?? w).getBoundingClientRect()),
    }));
    const exclusions: Array<{ name: string; rect: ReturnType<typeof box> }> = [];
    for (const [name, sel] of Object.entries(exclusionSelectors)) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) exclusions.push({ name, rect: box(r) });
      }
    }
    const union = tiles.length
      ? {
          left: Math.min(...tiles.map((t) => t.rect.left)),
          top: Math.min(...tiles.map((t) => t.rect.top)),
          right: Math.max(...tiles.map((t) => t.rect.right)),
          bottom: Math.max(...tiles.map((t) => t.rect.bottom)),
        }
      : null;
    const boardBox = union ? { ...union, width: union.right - union.left, height: union.bottom - union.top } : null;
    const hudBottoms = exclusions.filter((e) => e.name === 'hudPill' || e.name === 'hudCenter').map((e) => e.rect.bottom);
    const rackTops = exclusions.filter((e) => e.name === 'rack').map((e) => e.rect.top);
    const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const intersectsExclusion = new Set<string>();
    for (const t of tiles) for (const e of exclusions) if (hit(t.rect, e.rect)) intersectsExclusion.add(`${t.key}×${e.name}`);

    const spinner = tiles.find((t) => t.key.startsWith('main-') && t.key.endsWith('-6-6'));
    const hubCx = spinner ? (spinner.rect.left + spinner.rect.right) / 2 : (container.left + container.right) / 2;
    const arms: Array<Record<string, unknown>> = [];
    for (const arm of ['0', '1']) {
      const armTiles = tiles
        .filter((t) => t.key.startsWith(`branch-0-${arm}-`))
        .sort((a, b) => Number(a.key.split('-')[3]) - Number(b.key.split('-')[3]));
      if (!armTiles.length) continue;
      const onAxis = (t: { rect: ReturnType<typeof box> }) => Math.abs((t.rect.left + t.rect.right) / 2 - hubCx) < 3;
      let route = '';
      let v = 0;
      let h = 0;
      let bendSide = 'none';
      for (const t of armTiles) {
        const cx = (t.rect.left + t.rect.right) / 2;
        const isV = onAxis(t);
        if (isV) v += 1; else { h += 1; bendSide = cx < hubCx ? 'left' : 'right'; }
        const tag = isV ? 'V' : 'H';
        if (!route.endsWith(tag)) route += tag; // run-length encode below
      }
      route = `V${v}${h ? `H${h}` : ''}`;
      const exposed = armTiles[armTiles.length - 1];
      arms.push({ key: `arm${arm}`, tiles: armTiles.length, route, verticalTiles: v, horizontalTiles: h, bendSide, exposed });
    }
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      container: box(container),
      exclusions,
      cameraScale: m.a,
      tileCount: tiles.length,
      boardBox,
      distances: {
        toContainerTop: boardBox ? boardBox.top - container.top : 0,
        toContainerBottom: boardBox ? container.bottom - boardBox.bottom : 0,
        toContainerLeft: boardBox ? boardBox.left - container.left : 0,
        toContainerRight: boardBox ? container.right - boardBox.right : 0,
        toHudBottom: boardBox && hudBottoms.length ? boardBox.top - Math.max(...hudBottoms) : null,
        toRackTop: boardBox && rackTops.length ? Math.min(...rackTops) - boardBox.bottom : null,
      },
      intersectsExclusion: [...intersectsExclusion],
      arms,
      tiles,
    };
  }, EXCLUSION_SELECTORS) as unknown as Promise<GeometryReport>;
}

export const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
export const round2 = (n: number) => Math.round(n * 100) / 100;
