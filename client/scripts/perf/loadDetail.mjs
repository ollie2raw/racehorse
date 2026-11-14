#!/usr/bin/env node
/** Non-JS resources before first paint, and chunk totals per menu tap: node scripts/perf/loadDetail.mjs <run.json> */
import fs from 'node:fs';

const run = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const S of run.runs) {
  const P = S.perf;
  const fcp = P.paint['first-contentful-paint'];
  console.log(`== ${S.label}  FCP ${Math.round(fcp)} ms  LCP ${Math.round(P.lcp?.t ?? 0)} ms (${P.lcp?.url?.split('/').pop() ?? P.lcp?.el})`);
  const pre = P.res.filter((x) => x.s < fcp);
  const kind = (n) => (/\.(woff2?)$/.test(n) || n.includes('/l/font') ? 'font' : /\.css$|^\/css2/.test(n) ? 'css' : /\.js$/.test(n) ? 'js' : /\.(webp|png|jpg|jpeg|svg)$/.test(n) ? 'image' : /\.(mp3|ogg|wav)$/.test(n) ? 'audio' : 'other');
  const sum = (arr) => Math.round(arr.reduce((a, x) => a + (x.enc || 0), 0) / 1024);
  for (const k of ['css', 'font', 'image', 'audio', 'other']) {
    const items = pre.filter((x) => kind(x.n) === k);
    if (items.length) console.log(`  before FCP ${k}: ${items.length} files, ${sum(items)} KB: ${items.map((x) => `${x.n.split('/').pop().slice(0, 34)}(${Math.round((x.enc || 0) / 1024)}KB ${Math.round(x.s)}→${Math.round(x.e)})`).join(', ')}`);
  }
  const jsPre = pre.filter((x) => kind(x.n) === 'js');
  console.log(`  before FCP js: ${jsPre.length} files, ${sum(jsPre)} KB brotli, ${Math.round(jsPre.reduce((a, x) => a + (x.dec || 0), 0) / 1024)} KB decoded; last JS response ends at ${Math.round(Math.max(0, ...jsPre.map((x) => x.e)))} ms`);
  const post = P.res.filter((x) => x.s >= fcp && kind(x.n) !== 'js');
  console.log(`  after FCP non-js: ${post.length} files, ${sum(post)} KB: ${post.slice(0, 8).map((x) => `${x.n.split('/').pop().slice(0, 30)}(${Math.round((x.enc || 0) / 1024)}KB @${Math.round(x.s)})`).join(', ')}`);
  for (const m of S.marks.filter((x) => x.tapT != null && !x.point && x.shownT != null)) {
    const inWin = P.res.filter((x) => x.s >= m.tapT && x.s <= m.shownT);
    const js = inWin.filter((x) => kind(x.n) === 'js');
    console.log(`  tap "${m.label}": ${Math.round(m.shownT - m.tapT)} ms; fetched in window: ${inWin.length} files = ${sum(inWin)} KB (${js.length} JS ${sum(js)} KB brotli / ${Math.round(js.reduce((a, x) => a + (x.dec || 0), 0) / 1024)} KB decoded; ${inWin.filter((x) => kind(x.n) === 'image').length} images ${sum(inWin.filter((x) => kind(x.n) === 'image'))} KB)`);
  }
}
