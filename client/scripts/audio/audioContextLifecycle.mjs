#!/usr/bin/env node
/**
 * AudioContext lifecycle in WebKit vs Chromium (needs the dev server: npx vite --port 5199 --strictPort):
 * created while idle with no gesture, then resumed inside the first gesture (src/audio/audioEngine.ts installAudioUnlock).
 *   node scripts/audio/audioContextLifecycle.mjs --base http://localhost:5199
 * Headless browsers do not enforce the autoplay policy a real iPhone does, so "running without a gesture" here proves nothing about iOS.
 */
import { chromium, devices, webkit } from '@playwright/test';
const i = process.argv.indexOf('--base');
const BASE = i > 0 ? process.argv[i + 1] : 'http://localhost:5199';
for (const [name, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  const b = await engine.launch();
  const ctx = await b.newContext(devices['iPhone 14 landscape']);
  const p = await ctx.newPage();
  await p.goto(BASE, { waitUntil: 'load' });
  const r = await p.evaluate(`(async () => {
    const eng = await import('/src/audio/audioEngine.ts');
    const log = [];
    const raw = new AudioContext(); log.push('raw new AudioContext() state before any gesture: ' + raw.state);
    let resumed = 'n/a'; try { await Promise.race([raw.resume(), new Promise((r) => setTimeout(r, 800))]); resumed = raw.state; } catch (e) { resumed = 'error ' + e; }
    log.push('raw resume() without a gesture -> ' + resumed);
    eng.installAudioUnlock(() => log.push('prime() ran (decode starts)'));
    await new Promise((r) => setTimeout(r, 2600)); // WebKit has no requestIdleCallback: the engine falls back to a 2 s timeout
    log.push('requestIdleCallback: ' + typeof requestIdleCallback);
    log.push('engine before gesture: getAudioContext() ' + (eng.getAudioContext() ? 'returned a context' : 'returned null (still suspended)'));
    return log;
  })()`);
  console.log(`\n== ${name}`); for (const l of r) console.log('  ' + l);
  await p.mouse.click(300, 200);
  await p.waitForTimeout(600);
  console.log('  after a tap: ' + await p.evaluate(`(async () => { const eng = await import('/src/audio/audioEngine.ts'); const c = eng.getAudioContext(); return c ? 'context running (state ' + c.state + ')' : 'still null'; })()`));
  await b.close();
}
