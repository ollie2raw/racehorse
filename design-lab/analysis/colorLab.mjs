#!/usr/bin/env node
// Colorblind simulation + distinguishability + WCAG contrast for the pip palette (experiment only).
// CVD: Machado, Oliveira, Fernandes 2009 matrices (severity 1.0), applied in linear sRGB.
// Distance: CIE deltaE2000 (Sharma 2005) after simulation.
// Usage: node colorLab.mjs  -> writes color-report.md and palettes.json next to this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('');
const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const delin = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

const M = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export function simulate(hex, kind) {
  const l = hex2rgb(hex).map(lin);
  const o = M[kind].map((r) => r[0] * l[0] + r[1] * l[1] + r[2] * l[2]);
  return rgb2hex(o.map(delin));
}
export function lum(hex) {
  const [r, g, b] = hex2rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function toLab(hex) {
  const [r, g, b] = hex2rgb(hex).map(lin);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export function dE2000(h1, h2) {
  const [L1, a1, b1] = toLab(h1), [L2, a2, b2] = toLab(h2);
  const rad = Math.PI / 180, deg = 180 / Math.PI;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = (Math.atan2(b1, a1p) * deg + 360) % 360, h2p = (Math.atan2(b2, a2p) * deg + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? hbp / 2 : (hbp + (hbp < 360 ? 360 : -360)) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export const KINDS = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];
export const TILE_FACE = '#f4ebda'; // current .domino-body background-color (match-live-theme.css)
export const BOARD = '#0c0e12'; // current board canvas (racehorse-matte.css .nbl-board-canvas)
const CURRENT = { 1: '#1e3a8a', 2: '#0B5A3C', 3: '#38bdf8', 4: '#f97316', 5: '#22c55e', 6: '#dc2626' }; // DominoTile.tsx PIP_COLORS

function pairTable(pal) {
  const rows = [];
  const keys = Object.keys(pal);
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const d = {};
    for (const k of KINDS) d[k] = dE2000(simulate(pal[keys[i]], k), simulate(pal[keys[j]], k));
    rows.push({ pair: `${keys[i]}-${keys[j]}`, ...d, min: Math.min(...Object.values(d)) });
  }
  return rows;
}
const f1 = (n) => n.toFixed(1);

function lch2hex(L, C, h) {
  const rad = (h * Math.PI) / 180;
  const a = C * Math.cos(rad), b = C * Math.sin(rad);
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047, Y = L > 8 ? fy ** 3 : L / (24389 / 27), Z = inv(fz) * 1.08883;
  const out = [3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z, -0.969266 * X + 1.8760108 * Y + 0.041556 * Z, 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z];
  if (out.some((v) => v < -0.002 || v > 1.002)) return null;
  return rgb2hex(out.map(delin));
}
function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
// Deterministic random search: nudge each pip's L/C/h around the current colour, require contrast >= minContrast on the tile face,
// maximise the worst pair dE2000 over normal + 3 CVD kinds.
function search({ minContrast, hueWindow, seed, minC = 15 }) {
  const baseLch = Object.fromEntries(Object.entries(CURRENT).map(([k, v]) => { const [L, a, b] = toLab(v); return [k, [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360]]; }));
  const r = rng(seed);
  let best = null;
  for (let it = 0; it < 80000; it++) {
    const pal = {};
    let ok = true;
    for (const k of Object.keys(CURRENT)) {
      const [L0, C0, h0] = baseLch[k];
      let hx = null;
      for (let tries = 0; tries < 60 && !hx; tries++) {
        const L = 25 + r() * 35;
        const C = minC + r() * (100 - minC);
        const h = (h0 + (r() - 0.5) * 2 * hueWindow + 360) % 360;
        const cand = lch2hex(L, C, h);
        if (cand && contrast(cand, TILE_FACE) >= minContrast) hx = cand;
      }
      if (!hx) { ok = false; (globalThis.__fail ??= {})[k] = (globalThis.__fail[k] || 0) + 1; break; }
      pal[k] = hx;
    }
    if (!ok) continue;
    const score = Math.min(...pairTable(pal).map((p) => p.min));
    if (!best || score > best.score) best = { score, pal };
  }
  return best;
}

export function run() {
  const lines = [];
  lines.push('# Pip palette colour report (generated by design-lab/analysis/colorLab.mjs)\n');
  lines.push('Status: MEASURED (computed, not tested on people). CVD = Machado 2009 severity 1.0 in linear sRGB; distance = CIE dE2000 after simulation. Rule of thumb (read from the literature, a guess for this UI): dE2000 under 5 is hard to tell apart, 5-10 distinguishable with effort, over 10 clearly distinct. Wrong if: a real colour-vision user separates a pair we rate under 5 easily (pip position/count also disambiguates, since a half shows N pips), or confuses one we rate above 10.\n');
  // Hand-picked candidates (the random search above produced muddy palettes: kept for reference, unused).
  const sets = {
    current: CURRENT,
    'A-enamel-faithful': { 1: '#1b3fa0', 2: '#0a5c66', 3: '#0b86c9', 4: '#ee6a0a', 5: '#2a8a3a', 6: '#c01d24' },
    'C-spread-lightness': { 1: '#2a2a8c', 2: '#0d6b5a', 3: '#1581d1', 4: '#e8700e', 5: '#23863d', 6: '#a80f3a' },
  };
  for (const [name, pal] of Object.entries(sets)) {
    lines.push(`## Palette: ${name}\n`);
    lines.push('| pip | hex | contrast vs tile face ' + TILE_FACE + ' |\n|---|---|---|');
    for (const [k, v] of Object.entries(pal)) { const c = contrast(v, TILE_FACE); lines.push(`| ${k} | ${v} | ${f1(c)}:1 ${c >= 4.5 ? '(>=4.5)' : c >= 3 ? '(>=3 non-text)' : '(FAILS 3:1)'} |`); }
    lines.push('\n| pair | normal | protan | deutan | tritan | worst |\n|---|---|---|---|---|---|');
    const tbl = pairTable(pal);
    for (const r of tbl) lines.push(`| ${r.pair} | ${f1(r.normal)} | ${f1(r.protanopia)} | ${f1(r.deuteranopia)} | ${f1(r.tritanopia)} | **${f1(r.min)}** |`);
    const worst = tbl.reduce((a, b) => (a.min < b.min ? a : b));
    lines.push(`\nWorst pair ${worst.pair} at ${f1(worst.min)}. Pairs under 10 in some vision: ${tbl.filter((r) => r.min < 10).map((r) => r.pair).join(', ') || 'none'}. Under 5: ${tbl.filter((r) => r.min < 5).map((r) => r.pair).join(', ') || 'none'}.\n`);
  }
  lines.push('## Other WCAG contrast ratios (flat colours)\n');
  const extra = [
    ['tile face vs current board #0c0e12', TILE_FACE, BOARD],
    ['tile face vs navy board #0b1220', TILE_FACE, '#0b1220'],
    ['tile face vs #11151d', TILE_FACE, '#11151d'],
    ['current open-end glow, flat approx of blue rgba(84,165,255,.06) over board', '#0f1623', BOARD],
    ['current active zone border, brass 55% over board (approx)', '#7e6425', BOARD],
    ['marker A electric blue #4da3ff on #0b1220', '#4da3ff', '#0b1220'],
    ['marker B brass #e7b64a on #11151d', '#e7b64a', '#11151d'],
    ['marker C cyan #5ce1e6 on #0a0d12', '#5ce1e6', '#0a0d12'],
  ];
  lines.push('| pair | ratio |\n|---|---|');
  for (const [n, a, b] of extra) lines.push(`| ${n} | ${f1(contrast(a, b))}:1 |`);
  lines.push('\nThe current markers are translucent fills (alpha .06-.15); their flat-colour rows are rough approximations of the alpha blend (guess). Wrong if a measured screenshot pixel differs by more than a few levels.');
  fs.writeFileSync(path.join(here, 'color-report.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(here, 'palettes.json'), JSON.stringify(sets, null, 2));
  console.log(lines.join('\n'));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) run();
