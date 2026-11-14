#!/usr/bin/env node
/** Compact text view of a transition summary: node scripts/perf/viewTransitions.mjs summary.json */
import fs from 'node:fs';

const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(`${d.file} mode=${d.mode} profile=${d.profile} cpu=${d.cpu} net=${d.net} outcome=${JSON.stringify(d.outcome)} ${d.fatal ? 'FATAL ' + d.fatal.slice(0, 150) : ''}`);
for (const s of d.sessions) {
  console.log(`\n== ${s.label}`);
  if (s.load) {
    const l = s.load;
    console.log(` load: reactReady ${l.reactReadyMs} firstTapAt ${l.firstTapAtMs} TTFB ${l.navTTFBms} FCP ${l.fcp} LCP ${l.lcp} (${l.lcpEl} ${l.lcpUrl}) DCL ${l.domContentLoaded} load ${l.loadEvent} CLS ${l.cls}; requests ${l.requestsTotal}, before FCP ${l.beforeFirstPaint.n}; TBT ${l.totalBlockingMs}; long tasks ${JSON.stringify(l.longTasks)}; lastLongEnd<firstTap ${l.lastLongTaskEndBeforeFirstTap}`);
    console.log(`   before FCP by type ${JSON.stringify(l.beforeFirstPaint.byType)}`);
    console.log(`   total by type ${JSON.stringify(l.total)}`);
    console.log(`   biggest js ${JSON.stringify(l.biggestJs)}; main 0-3s ${JSON.stringify(l.mainThreadFirst3s)}`);
  }
  for (const m of s.menuTaps) {
    if (m.label === 'tier: Rookie') continue;
    console.log(` tap "${m.label}" -> first frame ${m.tapToFirstFrameMs} ms | net ${m.networkInFlightMs} main ${m.mainThreadBusyMs} resid ${m.residualAnimationOrTimerMs} commits ${m.commits} long ${JSON.stringify(m.longTasks)} layout ${m.layoutMs} style ${m.styleMs} script ${m.scriptMs}`);
    if (m.requests?.length) console.log(`     reqs ${m.requests.slice(0, 8).map((r) => `${r.n.split('/').pop()}(${r.kb}KB @${r.at}+${r.ms})`).join(' ')}${m.requests.length > 8 ? ` …+${m.requests.length - 8}` : ''}`);
  }
  if (s.enterAndPreDraw) {
    const e = s.enterAndPreDraw;
    console.log(` enter+predraw: tap→first playable ${e.tapToFirstPlayableMs} ms; tap→draw pickable ${e.nonInteractiveWaitMs} ms`);
    for (const t of e.timeline) console.log(`    ${String(t.atMsFromTap ?? '').padStart(6)} ms from tap | ${String(t.atMsFromMatchScreen).padStart(6)} from match screen | ${t.step}`);
    for (const g of e.segments) console.log(`    seg ${g.name}: ${g.totalMs} ms = net ${g.networkInFlightMs} + main ${g.mainThreadBusyMs} + residual ${g.residualAnimationOrTimerMs}; long ${JSON.stringify(g.longTasks)}; commits ${g.commits}; anims ${g.anims.join(',')}; imgs ${g.imgs}; calls ${g.calls.join('; ')}`);
    console.log(`    board mount (first 1.5 s): ${JSON.stringify(s.boardMount.first1500ms)}, gbcr total ${s.boardMount.gbcrTotal}`);
  }
  if (s.handEnds?.length) {
    console.log(` hand ends (${s.handEnds.length}): last tile → next hand first playable ms: ${s.handEnds.map((h) => h.lastTileToFirstPlayableMs).join(', ')}`);
    for (const h of s.handEnds.slice(0, 3)) {
      console.log(`    hand ${h.n}: total ${h.lastTileToFirstPlayableMs} ms (botOpened ${h.botOpened}); net ${h.total?.networkInFlightMs} main ${h.total?.mainThreadBusyMs} resid ${h.total?.residualAnimationOrTimerMs}; long tasks ${JSON.stringify(h.total?.longTasks)}`);
      for (const p of h.phases) console.log(`       ${p.name.padEnd(30)} ${String(p.ms).padStart(6)} ms | net ${p.net} main ${p.main} resid ${p.residual} long ${p.longTasks} ${p.calls.length ? '| ' + p.calls.join('; ') : ''}`);
    }
  }
  if (s.gameEnd) console.log(` game end: last tile → result ${s.gameEnd.lastTileToResultMs} ms: net ${s.gameEnd.networkInFlightMs} main ${s.gameEnd.mainThreadBusyMs} resid ${s.gameEnd.residualAnimationOrTimerMs}; long ${JSON.stringify(s.gameEnd.longTasks)}; calls ${(s.gameEnd.calls ?? []).join('; ')}; after result: ${(s.gameEnd.afterResultCalls ?? []).join('; ')}`);
  if (s.placement) console.log(` placement n=${s.placement.n} p50 ${s.placement.p50} p75 ${s.placement.p75} p95 ${s.placement.p95} p99 ${s.placement.p99} max ${s.placement.max} (>100ms ${s.placement.over100}, >300ms ${s.placement.over300}); zoneAppear ${JSON.stringify(s.zoneAppear)}; draw ${JSON.stringify(s.draw)}; INP ${JSON.stringify(s.inp)}; long tasks ${JSON.stringify(s.longTasksTotal)}`);
  if (s.placement?.slowest?.length) for (const x of s.placement.slowest) console.log(`    slow ${x.ms} ms @${x.atSec}s commits ${x.commits} long ${JSON.stringify(x.longTasks)} ${x.note ?? ''} ${JSON.stringify(x.loaf)}`);
}
