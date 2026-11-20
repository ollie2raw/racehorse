#!/usr/bin/env node
/**
 * Pools eventsHarness.mjs runs of one cell and reports interactions by type: count, p50/p98 of Event Timing duration, the phase split
 * (input delay / processing / presentation delay) and what the main thread was doing (script / style+layout / paint, via the
 * overlapping long-animation-frames, with the top script functions), plus the 20 slowest and every long task over 100 ms.
 *   node scripts/perf/analyzeEvents.mjs run1.json run2.json ... [--top 20]
 * Event Timing only reports interactions of 16 ms or more, so p50 is "of the reported ones"; the share reported is printed as >=16ms/taps.
 */
import fs from 'node:fs';
const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
const top = Number(process.argv[process.argv.indexOf('--top') + 1]) || 20;
const r0 = (x) => Math.round(x);
const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
const rows = []; const longs = []; const taps = {}; let runs = 0; let placements = 0;
for (const f of files) {
  const run = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const s of run.sessions ?? []) {
    runs++; const P = s.perf;
    const byId = new Map();
    for (const e of P.events) { const c = byId.get(e.id); if (!c) byId.set(e.id, { ...e, start: e.s }); else { c.start = Math.min(c.start, e.s); if (e.d > c.d) Object.assign(c, { d: e.d, inDelay: e.inDelay, proc: e.proc, pres: e.pres }); } }
    for (const d of P.downs ?? []) { const ty = d.ty.startsWith('button:') ? 'button' : d.ty.replace(/^draw$/, 'draw*'); taps[ty] = (taps[ty] ?? 0) + 1; }
    placements += P.board.filter((x) => x.c > x.prev).length;
    for (const e of byId.values()) {
      const dn = (P.downs ?? []).reduce((b, d) => (Math.abs(d.t - e.start) < 40 && (!b || Math.abs(d.t - e.start) < Math.abs(b.t - e.start)) ? d : b), null);
      let ty = dn ? dn.ty : 'unmatched';
      // The driver taps the boneyard whenever it is visible, also on the bot's turn: a draw only counts if the hand grew within 1.5 s.
      if (ty === 'draw') ty = (P.hand ?? []).some((h) => h.h > h.prev && h.t >= e.start && h.t <= e.start + 1500) ? 'draw' : 'draw(no-op tap)';
      const end = e.start + e.d; let script = 0, forced = 0, styleLayout = 0, paintish = 0; const fns = {};
      for (const l of P.loaf) {
        const lEnd = l.s + l.d; if (lEnd < e.start || l.s > end) continue;
        for (const sc of l.scripts) { script += sc.d; forced += sc.forced || 0; const k = `${sc.fn || sc.inv || '(anon)'} @${sc.src || '?'}`; fns[k] = (fns[k] ?? 0) + sc.d; }
        if (l.styleLayout != null && l.renderStart != null) { styleLayout += l.d - l.styleLayout; paintish += l.styleLayout - l.renderStart; }
      }
      rows.push({ f: f.split('/').pop(), ty: ty.startsWith('button:') ? 'button' : ty, label: ty, d: e.d, inDelay: e.inDelay, proc: e.proc, pres: e.pres, script, forced, styleLayout, render: paintish + styleLayout, fns: Object.entries(fns).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${r0(v)}ms`) });
    }
    const board = P.board.map((b) => b.t);
    for (const l of P.longtasks) if (l.d > 100) {
      const near = board.some((t) => t >= l.s - 700 && t <= l.s + l.d + 100);
      const lo = P.loaf.find((x) => x.s <= l.s + l.d && x.s + x.d >= l.s);
      const ev = [...byId.values()].find((e) => e.start <= l.s + l.d && e.start + e.d >= l.s);
      longs.push({ f: f.split('/').pop(), d: r0(l.d), nearPlacement: near, interaction: ev ? (rows.find((r) => r.d === ev.d)?.label ?? '?') : null, fns: lo ? lo.scripts.slice().sort((a, b) => b.d - a.d).slice(0, 2).map((x) => `${x.fn || x.inv || '(anon)'}@${x.src} ${r0(x.d)}ms`) : [] });
    }
  }
}
console.log(`runs/sessions ${runs}, placements ${placements}, interactions reported (>=16 ms) ${rows.length}`);
console.log('\ntype            taps  >=16ms   p50   p98   max |  p98: input-delay  processing  presentation |  mean main-thread in the slow ones: script  style+layout(forced)  render-ish');
const types = [...new Set(rows.map((r) => r.ty))].sort();
for (const ty of types) {
  const rs = rows.filter((r) => r.ty === ty); const d = rs.map((r) => r.d); const m = (k) => r0(rs.reduce((a, r) => a + r[k], 0) / rs.length);
  const slow = rs.filter((r) => r.d >= pct(d, 0.9)); const ms = (k) => r0(slow.reduce((a, r) => a + r[k], 0) / Math.max(1, slow.length));
  console.log(`${ty.padEnd(15)} ${String(taps[ty] ?? '?').padStart(4)} ${String(rs.length).padStart(7)} ${String(r0(pct(d, 0.5))).padStart(5)} ${String(r0(pct(d, 0.98))).padStart(5)} ${String(r0(Math.max(...d))).padStart(5)} |  ${String(m('inDelay')).padStart(6)} ${String(m('proc')).padStart(11)} ${String(m('pres')).padStart(12)} |  ${String(ms('script')).padStart(6)} ${String(ms('styleLayout')).padStart(8)}(${ms('forced')}) ${String(ms('render')).padStart(8)}`);
}
console.log(`\n${top} slowest interactions:`);
for (const r of [...rows].sort((a, b) => b.d - a.d).slice(0, top)) console.log(`  ${String(r0(r.d)).padStart(4)} ms ${r.label.padEnd(22)} in ${String(r0(r.inDelay)).padStart(3)} proc ${String(r0(r.proc)).padStart(3)} pres ${String(r0(r.pres)).padStart(3)} | script ${String(r0(r.script)).padStart(3)} style+layout ${String(r0(r.styleLayout)).padStart(3)} (forced ${r0(r.forced)}) | ${r.fns.join('; ')}`);
console.log(`\nlong tasks >100 ms: ${longs.length} in ${runs} sessions; near a placement animation: ${longs.filter((l) => l.nearPlacement).length}; inside a measured interaction: ${longs.filter((l) => l.interaction).length}`);
for (const l of longs.slice(0, 12)) console.log(`  ${l.d} ms ${l.nearPlacement ? 'near-placement' : 'no-placement'} ${l.interaction ?? 'no-interaction'} ${l.fns.join('; ')}`);
