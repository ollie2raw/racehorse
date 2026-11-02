/**
 * What a shared link shows.
 *
 * Every page used to share one of two images (the home card, and for Journey, Learn and Tournaments a Daily Puzzle card), so a link to a mode said nothing about
 * that mode. And an image that is not a real file in public/ is not a missing image: Vercel's SPA catch-all serves index.html in its place, and the preview renders
 * with no picture and no error. So this pins that every route's image exists as a real 1200x630 PNG, that each mode page has its own, and that the iOS home-screen
 * icon is a real 180px file the page links.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — build script module, not part of the app's TS program.
import { PRERENDER_ROUTES } from './prerenderRoutes.mjs';

type Route = { path: string; image: string };

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicFile = (name: string) => path.join(clientDir, 'public', name.replace(/^\//, ''));
const routes = PRERENDER_ROUTES as Route[];
const imageOf = (routePath: string) => routes.find((route) => route.path === routePath)?.image;

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(0, 8).toString('hex'), `${file} is a PNG`).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('every prerendered route has a real social image', () => {
  const images = [...new Set(routes.map((route) => route.image))];

  it('lists images to check', () => {
    expect(images.length).toBeGreaterThanOrEqual(8);
  });

  it.each(images)('%s is a real 1200x630 PNG in public/', (image) => {
    expect(image.startsWith('/')).toBe(true);
    expect(pngSize(publicFile(image))).toEqual({ width: 1200, height: 630 });
  });
});

describe('each mode page has its own card', () => {
  const home = imageOf('/')!;
  const modes: Array<[string, string]> = [
    ['/solo/fritz', 'Play vs Fritz'],
    ['/solo/ghost', 'Ghost Mode'],
    ['/journey', 'Journey'],
    ['/learn', 'Learn'],
    ['/tournament', 'Tournaments'],
    ['/multiplayer', 'Multiplayer'],
    ['/daily-fritz', 'Daily Fritz'],
  ];

  it.each(modes)('%s (%s) does not reuse the home card', (route) => {
    expect(imageOf(route)).toBeTruthy();
    expect(imageOf(route)).not.toBe(home);
  });

  it('no mode shares a card with a different mode', () => {
    const owners = new Map<string, string[]>();
    for (const [route] of modes) {
      const image = imageOf(route)!;
      owners.set(image, [...(owners.get(image) ?? []), route]);
    }
    expect([...owners.values()].filter((routesForImage) => routesForImage.length > 1)).toEqual([]);
  });

  it('a mode\'s sub-pages share its card: private and quick multiplayer, the tutorial and Learn, the tournament pages', () => {
    expect(imageOf('/multiplayer/private')).toBe(imageOf('/multiplayer'));
    expect(imageOf('/learn/how-to-play')).toBe(imageOf('/learn'));
    expect(imageOf('/tournament/detail')).toBe(imageOf('/tournament'));
    expect(imageOf('/tournament/result')).toBe(imageOf('/tournament'));
  });

  it('nothing but the Daily Puzzle itself uses the Daily Puzzle card', () => {
    expect(routes.filter((route) => route.image === '/dailypuzzleHOMEBG.png').map((route) => route.path)).toEqual([]);
  });
});

describe('the iOS home-screen icon', () => {
  it('is a real 180x180 file, and the page links it by that size', () => {
    expect(pngSize(publicFile('/apple-touch-icon.png'))).toEqual({ width: 180, height: 180 });
    const html = readFileSync(path.join(clientDir, 'index.html'), 'utf8');
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />');
    expect(html).not.toMatch(/rel="apple-touch-icon"[^>]*icon-192/);
  });
});
