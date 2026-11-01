#!/usr/bin/env node
/**
 * Bundle ratchet: the built JS may not quietly grow. `check-bundle-size.mjs` holds a few hand-set ceilings that are far
 * above today's sizes (index limit 700 kB against ~564 kB), so a chunk can gain 100 kB before anything fails. This compares
 * against a committed baseline of what each chunk weighs now: a chunk may keep its size and may only shrink.
 *
 *   node scripts/checkBundleRatchet.mjs            check dist/assets (exit 1 on growth)
 *   node scripts/checkBundleRatchet.mjs --update   rewrite the baseline to the current sizes
 *
 * Chunks are matched by their name without the content hash. Only chunks of TRACKED_MIN_BYTES or more are listed one by
 * one; everything smaller is covered by the total. A new large chunk fails on purpose: splitting code out is fine, but it
 * should be a visible decision, so run --update in the same PR and say why. Shrinking never fails; run --update in the
 * same PR so the room it freed cannot be spent again later.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(CLIENT_ROOT, 'dist', 'assets');
const BASELINE_PATH = join(CLIENT_ROOT, 'bundle-ratchet-baseline.json');

/** Chunks at or above this size get their own line in the baseline. */
export const TRACKED_MIN_BYTES = 10_000;
/** Build-to-build wobble that is not growth (a different minifier pass, a hash length). */
export const TOLERANCE_BYTES = 1_000;

/** `index-BWsEKhTp.js` -> `index`; `lesson-v2-Cx1.js` -> `lesson-v2`. */
export function chunkStem(file) {
  return file.replace(/\.js$/, '').replace(/-[A-Za-z0-9_-]{8}$/, '');
}

/** `[{ file, size }]` -> `{ total, chunks: { stem: size } }`, listing only the chunks worth tracking. */
export function summarise(files) {
  const chunks = {};
  let total = 0;
  for (const { file, size } of files) {
    total += size;
    if (size < TRACKED_MIN_BYTES) continue;
    const stem = chunkStem(file);
    chunks[stem] = (chunks[stem] ?? 0) + size;
  }
  return { total, chunks };
}

/** Everything that grew past the baseline (plus tolerance), and every large chunk the baseline has never seen. */
export function findGrowth(current, baseline) {
  const problems = [];
  if (current.total > baseline.total + TOLERANCE_BYTES) {
    problems.push({ name: 'total JS', allowed: baseline.total, found: current.total });
  }
  for (const [stem, size] of Object.entries(current.chunks)) {
    const allowed = baseline.chunks[stem];
    if (allowed === undefined) problems.push({ name: stem, allowed: null, found: size });
    else if (size > allowed + TOLERANCE_BYTES) problems.push({ name: stem, allowed, found: size });
  }
  return problems;
}

/** Baseline entries that are now noticeably smaller, so the PR knows to lower them. */
export function findSlack(current, baseline) {
  const slack = [];
  if (current.total < baseline.total - TOLERANCE_BYTES) slack.push({ name: 'total JS', allowed: baseline.total, found: current.total });
  for (const [stem, allowed] of Object.entries(baseline.chunks)) {
    const size = current.chunks[stem] ?? 0;
    if (size < allowed - TOLERANCE_BYTES) slack.push({ name: stem, allowed, found: size });
  }
  return slack;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

function main() {
  const update = process.argv.includes('--update');
  if (!existsSync(ASSETS)) {
    console.error('bundle-ratchet: dist/assets is missing; run `npx vite build` first.');
    process.exit(1);
  }
  const files = readdirSync(ASSETS)
    .filter((f) => f.endsWith('.js'))
    .map((file) => ({ file, size: statSync(join(ASSETS, file)).size }));
  const current = summarise(files);

  if (update) {
    const sorted = Object.fromEntries(Object.entries(current.chunks).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE_PATH, `${JSON.stringify({ total: current.total, chunks: sorted }, null, 2)}\n`);
    console.log(`bundle-ratchet: baseline written (${kb(current.total)} total, ${Object.keys(sorted).length} tracked chunks)`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const growth = findGrowth(current, baseline);
  if (growth.length > 0) {
    for (const g of growth) {
      console.error(
        g.allowed === null
          ? `bundle-ratchet: new chunk "${g.name}" is ${kb(g.found)}; run --update if it is intended`
          : `bundle-ratchet: ${g.name} grew from ${kb(g.allowed)} to ${kb(g.found)} (tolerance ${kb(TOLERANCE_BYTES)})`,
      );
    }
    console.error('Shrink it, or run `node scripts/checkBundleRatchet.mjs --update` and justify the growth in the PR.');
    process.exit(1);
  }
  for (const s of findSlack(current, baseline)) {
    console.log(`bundle-ratchet: ${s.name} is down to ${kb(s.found)} (baseline ${kb(s.allowed)}); run --update to lock it in`);
  }
  console.log(`bundle-ratchet: OK (${kb(current.total)} total JS)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
