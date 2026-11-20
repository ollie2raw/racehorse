import fs from 'node:fs';
const incl = new Map(); let nrun = 0; let runMs = 0;
for (const f of process.argv.slice(2)) {
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  const nodes = new Map(p.nodes.map((x) => [x.id, x])); const parent = new Map();
  for (const x of p.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const nm = (x) => `${x.callFrame.functionName || '(anon)'} ${x.callFrame.url.split('/').pop()}:${x.callFrame.lineNumber}`;
  let run = []; const flush = () => { const tot = run.reduce((a, r) => a + r.us, 0); if (tot >= Number(process.env.MINUS ?? 80000)) { nrun++; runMs += tot; const seen = new Set(); for (const r of run) for (const k of r.names) incl.set(k, (incl.get(k) ?? 0) + r.us); } run = []; };
  for (let i = 0; i < p.samples.length; i++) {
    const us = p.timeDeltas[i] ?? 0; let id = p.samples[i]; const chain = [];
    while (id != null) { chain.push(nodes.get(id)); id = parent.get(id); }
    if (chain.some((c) => c.callFrame.functionName === 'dispatchDiscreteEvent')) run.push({ us, names: [...new Set(chain.map(nm))] }); else if (run.length) flush();
  }
  if (run.length) flush();
}
console.log(`discrete-event bursts >= 80 ms: ${nrun}, mean ${(runMs / Math.max(1, nrun) / 1000).toFixed(0)} ms`);
for (const [k, v] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(String((v / nrun / 1000).toFixed(1)).padStart(7), k);
