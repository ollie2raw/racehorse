#!/usr/bin/env node
/**
 * CSS ratchet: per-file counts of `!important`, hardcoded hex colours and gradients
 * may never go UP. The project rules are no `!important`, tokens instead of hex
 * (outside styles/tokens.css) and matte surfaces instead of gradients, but the
 * existing stylesheets carry a long tail of all three. Stylelint cannot baseline
 * per file, so this compares against a committed baseline: a new file starts at
 * zero, an existing file may keep what it has and may only shrink.
 *
 *   node scripts/checkCssRatchet.mjs            check (exit 1 on any increase)
 *   node scripts/checkCssRatchet.mjs --update   rewrite the baseline to the current counts
 *
 * Lowering a count never fails, but run --update in the same PR so the room it
 * freed cannot be spent again later.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLIENT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(CLIENT_ROOT, 'src');
const BASELINE_PATH = join(CLIENT_ROOT, 'css-ratchet-baseline.json');
const TOKENS_FILE = 'src/styles/tokens.css';

export const METRICS = ['important', 'hex', 'gradient'];

const IMPORTANT = /!\s*important/gi;
// A colour literal in a value: not part of a selector (#id), not followed by more word characters.
const HEX = /(?<![\w&#-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/g;
const GRADIENT = /\b(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi;

/** Counts for one stylesheet's text. Comments are ignored; selector lines are not scanned for hex. */
export function countCss(text, { countHex = true } = {}) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const valueLines = stripped
    .split('\n')
    .filter((line) => !line.trim().endsWith('{'))
    .join('\n');
  return {
    important: (stripped.match(IMPORTANT) ?? []).length,
    hex: countHex ? (valueLines.match(HEX) ?? []).length : 0,
    gradient: (stripped.match(GRADIENT) ?? []).length,
  };
}

/** Every metric that went up against the baseline; a file missing from the baseline counts from zero. */
export function findRegressions(current, baseline) {
  const regressions = [];
  for (const [file, counts] of Object.entries(current)) {
    for (const metric of METRICS) {
      const allowed = baseline[file]?.[metric] ?? 0;
      if (counts[metric] > allowed) regressions.push({ file, metric, allowed, found: counts[metric] });
    }
  }
  return regressions;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith('.css')) out.push(path);
  }
  return out;
}

export function measureAll() {
  const result = {};
  for (const path of walk(SRC).sort()) {
    const rel = relative(CLIENT_ROOT, path).split('\\').join('/');
    const counts = countCss(readFileSync(path, 'utf8'), { countHex: rel !== TOKENS_FILE });
    if (METRICS.some((metric) => counts[metric] > 0)) result[rel] = counts;
  }
  return result;
}

function main() {
  const current = measureAll();
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`css-ratchet: baseline written for ${Object.keys(current).length} files`);
    return;
  }
  if (!existsSync(BASELINE_PATH)) {
    console.error('css-ratchet: css-ratchet-baseline.json is missing; run with --update');
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const regressions = findRegressions(current, baseline);
  if (regressions.length > 0) {
    console.error('css-ratchet: these stylesheets use MORE than the committed baseline allows:');
    for (const r of regressions) console.error(`  ${r.file}: ${r.metric} ${r.found} (allowed ${r.allowed})`);
    console.error('Use a token / a matte surface / a proper selector instead. Never raise the baseline to make this pass.');
    process.exit(1);
  }
  const totals = METRICS.map((m) => `${m} ${Object.values(current).reduce((a, c) => a + c[m], 0)}`).join(', ');
  console.log(`css-ratchet: OK (${totals})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
