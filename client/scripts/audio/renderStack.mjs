#!/usr/bin/env node
/**
 * Renders the stacked scoring sounds OFFLINE, exactly as the game stacks them, through the real mix bus, before and after proposed bus changes,
 * and writes blind-labelled WAV files plus measurements. Changes nothing in the app: the variants patch the bus numbers inside the render page only.
 *
 *   node scripts/audio/renderStack.mjs --base http://127.0.0.1:5199 --out ~/racehorse-audio-ab [--browser chromium|webkit]
 *   (start the dev server first: npx vite --port 5199 --strictPort)
 *
 * As played (client/src/utils/tileImpact.ts, modules/match/hand-lifecycle/handAudioEffects.ts):
 *   scoring moment : tile clack at 0 ms, score ping 80 ms after it (the ping waits for the clack, then queueSound(…, 80))
 *   round end      : the same two, then the hand-win sound 320 ms after the hand-ending tile lands (queueSound(…, 320))
 * Variants (the key is written to <out>/key/KEY.txt, the files are named only A..D):
 *   current  bus as shipped: knee -6 dBFS, ceiling -1 dBFS, no extra headroom
 *   headroom the bus input 4 dB lower, same limiter
 *   limiter  a gentler limiter curve: knee -9 dBFS (0.35), same ceiling, no extra headroom
 *   both     headroom and the gentler limiter
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium, webkit } from '@playwright/test';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith('--') ? [[a.slice(2), all[i + 1]]] : [])));
const BASE = args.base ?? 'http://127.0.0.1:5199';
const OUT = (args.out ?? '~/racehorse-audio-ab').replace(/^~/, process.env.HOME);
const BROWSER = args.browser ?? 'chromium';
const SR = 44100;
const SECONDS = 3;

const VARIANTS = [
  { id: 'current', preGainDb: 0, knee: 0.5, ceiling: 0.89 },
  { id: 'headroom', preGainDb: -4, knee: 0.5, ceiling: 0.89 },
  { id: 'limiter', preGainDb: 0, knee: 0.35, ceiling: 0.89 },
  { id: 'both', preGainDb: -4, knee: 0.35, ceiling: 0.89 },
];
const SCENARIOS = [
  { id: 'scoring', score: 15, handWin: false },
  { id: 'roundend', score: 15, handWin: true },
];

const PAGE_FN = `
async function render(variant, scenario, linear) {
  // The sample is fetched by its URL, never imported as a module: importing it makes the dev server answer later fetches with a JS wrapper.
  const mp3 = { default: '/src/assets/sounds/freesound_community-thwump-85836.mp3' };
  const [eng, snd] = await Promise.all([import('/src/audio/audioEngine.ts'), import('/src/utils/sound.ts')]);
  const saved = { knee: eng.BUS.kneeLinear, ceiling: eng.BUS.ceilingLinear };
  const SR = ${SR};
  const offline = new OfflineAudioContext(2, SR * ${SECONDS}, SR);
  eng.BUS.kneeLinear = linear ? 1 : variant.knee;
  eng.BUS.ceilingLinear = linear ? 1 : variant.ceiling;
  // buildBus creates the bus input gain, then the limiter: set the extra headroom on the gain created just before the limiter.
  let lastGain = null;
  const makeGain = offline.createGain.bind(offline);
  offline.createGain = () => (lastGain = makeGain());
  const makeShaper = offline.createWaveShaper.bind(offline);
  offline.createWaveShaper = () => { if (lastGain && variant.preGainDb) lastGain.gain.value = Math.pow(10, variant.preGainDb / 20); return makeShaper(); };
  eng.useAudioContextForBench(offline);
  snd.freezeJitterForBench(true);
  // The tile sample must be decoded or the clack is silently missing (a failed decode is cached as null, so clear and retry).
  let sample = null;
  for (let attempt = 0; attempt < 8 && !sample; attempt += 1) {
    if (attempt) { await new Promise((r) => setTimeout(r, 400)); eng.useAudioContextForBench(offline); }
    sample = await eng.loadSample(mp3.default);
  }
  if (!sample) throw new Error('the tile sample did not decode');
  snd.playTileSound('standard', false);
  offline.suspend(0.08).then(() => { snd.playScoreSound(scenario.score, false); offline.resume(); });
  if (scenario.handWin) offline.suspend(0.32).then(() => { snd.playHandWinSound(false); offline.resume(); });
  const buf = await offline.startRendering();
  snd.freezeJitterForBench(false); eng.useAudioContextForBench(null);
  eng.BUS.kneeLinear = saved.knee; eng.BUS.ceilingLinear = saved.ceiling;
  const toB64 = (f) => { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  return { l: toB64(buf.getChannelData(0)), r: toB64(buf.getChannelData(1)) };
}
`;

const fromB64 = (s) => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); };
const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

/** 4x oversampled peak (windowed sinc, 16 taps each side): an estimate of the inter-sample (true) peak. */
function truePeak(x) {
  const taps = 16; const kernel = [];
  for (let phase = 1; phase < 4; phase += 1) {
    const k = [];
    for (let t = -taps + 1; t <= taps; t += 1) {
      const d = t - phase / 4; const s = Math.abs(d) < 1e-9 ? 1 : Math.sin(Math.PI * d) / (Math.PI * d);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / taps);
      k.push(s * w);
    }
    kernel.push(k);
  }
  let peak = 0;
  for (let i = 0; i < x.length; i += 1) {
    peak = Math.max(peak, Math.abs(x[i]));
    if (i % 1 === 0 && i + taps < x.length && i - taps > 0) {
      for (const k of kernel) {
        let acc = 0;
        for (let t = 0; t < k.length; t += 1) acc += x[i - taps + 1 + t] * k[t];
        peak = Math.max(peak, Math.abs(acc));
      }
    }
  }
  return peak;
}

function measure(l, r, linL, linR) {
  const peak = Math.max(...[l, r].map((c) => c.reduce((m, v) => Math.max(m, Math.abs(v)), 0)));
  const tp = Math.max(truePeak(l), truePeak(r));
  let clipped = 0; let aboveKnee = 0;
  for (const c of [l, r]) for (const v of c) { if (Math.abs(v) >= 0.999) clipped += 1; if (Math.abs(v) > 0.5) aboveKnee += 1; }
  let e = 0; let d = 0; let linE = 0;
  for (let i = 0; i < l.length; i += 1) {
    e += l[i] * l[i] + r[i] * r[i];
    linE += linL[i] * linL[i] + linR[i] * linR[i];
    const dl = l[i] - linL[i]; const dr = r[i] - linR[i];
    d += dl * dl + dr * dr;
  }
  return { peakDbfs: db(peak), truePeakDbfs: db(tp), clippedSamples: clipped, samplesOverMinus6dB: aboveKnee, rmsDbfs: db(Math.sqrt(e / (2 * l.length))), limiterDistortionDb: linE > 0 ? db(Math.sqrt(d / linE)) : -120 };
}

function wav16(l, r) {
  const n = l.length; const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i += 1) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))), 46 + i * 4);
  }
  return buf;
}

const browser = await (BROWSER === 'webkit' ? webkit : chromium).launch();
const page = await (await browser.newContext()).newPage();
await page.goto(BASE, { waitUntil: 'load' });
// A string, not a callback: the runner would compile a dynamic import() in a callback into require().
const run = (variant, scenario, linear) => page.evaluate(`(async () => { ${PAGE_FN} return render(${JSON.stringify(variant)}, ${JSON.stringify(scenario)}, ${linear}); })()`);

const letters = ['A', 'B', 'C', 'D'];
const order = [...VARIANTS].map((v) => ({ v, k: crypto.randomInt(1e9) })).sort((a, b) => a.k - b.k).map((x) => x.v);
const key = []; const report = [];
fs.mkdirSync(path.join(OUT, 'key'), { recursive: true });
for (const [i, variant] of order.entries()) {
  key.push(`${letters[i]} = ${variant.id}  (bus input ${variant.preGainDb} dB, limiter knee ${(20 * Math.log10(variant.knee)).toFixed(1)} dBFS, ceiling ${(20 * Math.log10(variant.ceiling)).toFixed(1)} dBFS)`);
  for (const scenario of SCENARIOS) {
    const wet = await run(variant, scenario, false);
    const dry = await run(variant, scenario, true);
    const [l, r, ll, lr] = [fromB64(wet.l), fromB64(wet.r), fromB64(dry.l), fromB64(dry.r)];
    fs.writeFileSync(path.join(OUT, `${scenario.id}_${letters[i]}.wav`), wav16(l, r));
    report.push({ file: `${scenario.id}_${letters[i]}.wav`, variant: variant.id, scenario: scenario.id, ...measure(l, r, ll, lr) });
  }
}
fs.writeFileSync(path.join(OUT, 'key', 'KEY.txt'), `${key.join('\n')}\n\nListen blind first (scoring_A..D, then roundend_A..D); open this file after you have noted which ones have static.\n`);
const num = (x) => (Math.round(x * 10) / 10).toFixed(1);
const rows = report.map((m) => `| ${m.file} | ${num(m.peakDbfs)} | ${num(m.truePeakDbfs)} | ${m.clippedSamples} | ${m.samplesOverMinus6dB} | ${num(m.rmsDbfs)} | ${num(m.limiterDistortionDb)} |`);
fs.writeFileSync(path.join(OUT, 'key', 'MEASUREMENTS.md'), [`# Measurements (${BROWSER}, ${SR} Hz, ${SECONDS} s)`, '', '| file | peak dBFS | true peak dBFS (4x) | clipped samples (>=0.999) | samples over -6 dBFS | RMS dBFS | limiter distortion (dB re signal; lower is cleaner) |', '|---|---|---|---|---|---|---|', ...rows, '', 'Which file is which variant is in KEY.txt (this file lists variants too, so open it after listening).', ...report.map((m) => `- ${m.file}: ${m.variant}`)].join('\n'));
console.log(fs.readFileSync(path.join(OUT, 'key', 'MEASUREMENTS.md'), 'utf8').split('\n').slice(0, 14).join('\n'));
await browser.close();
