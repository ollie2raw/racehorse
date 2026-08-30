/**
 * Every prerendered shell needs a rewrite pointing at it.
 *
 * /settings was added to the prerender list without one, so Vercel's catch-all
 * served index.html and the generated settings.html was never reachable. The
 * route worked, which is exactly why nothing caught it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error — build script module, not part of the app's TS program.
import { PRERENDER_ROUTES } from './prerenderRoutes.mjs';

type Route = { path: string; output?: string };

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const vercel = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8')) as {
  rewrites: { source: string; destination: string }[];
};

/**
 * Asserted on `output`, not on `path`. Some shells are templates rather than
 * URLs — the `/players` shell is served for `/players/:username`, and
 * `/tournament/result` for `/tournament/:id/result` — so the invariant that
 * actually matters is that every generated file is some rewrite's
 * destination. `/` has no output: it is written as index.html and served
 * directly.
 */
describe('prerendered shells are reachable', () => {
  const destinations = new Set(vercel.rewrites.map((rule) => rule.destination));

  it.each(
    (PRERENDER_ROUTES as Route[])
      .filter((route) => route.output)
      .map((route) => [route.path, route.output!] as const),
  )('%s → %s is served by a rewrite, not the catch-all', (_routePath, output) => {
    expect(destinations.has(`/${output}`), `nothing rewrites to /${output}`).toBe(true);
  });

  it('writes the home shell to index.html rather than needing a rewrite', () => {
    const home = (PRERENDER_ROUTES as Route[]).find((route) => route.path === '/');
    expect(home?.output).toBeUndefined();
  });

  it('keeps the catch-all last, so it cannot shadow a shell', () => {
    expect(vercel.rewrites.at(-1)!.source).toBe('/(.*)');
  });
});
