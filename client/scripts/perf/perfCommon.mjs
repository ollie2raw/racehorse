// Shared helpers for perfBudgetsTier1.mjs and perfTimingTier2.mjs: start and stop local services, wait for them, read the stub's timeline.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = path.dirname(fileURLToPath(import.meta.url));
export const clientDir = path.resolve(here, '..', '..');
export const repoDir = path.resolve(clientDir, '..');

export function spawnService(label, command, args, { env = {}, cwd = repoDir } = {}) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', (d) => { log += d; if (log.length > 20000) log = log.slice(-10000); });
  child.stderr.on('data', (d) => { log += d; if (log.length > 20000) log = log.slice(-10000); });
  child.label = label;
  child.tail = () => log.slice(-3000);
  return child;
}

export async function waitForHttp(url, { timeoutMs = 90_000, child } = {}) {
  const start = Date.now();
  for (;;) {
    if (child && child.exitCode !== null) throw new Error(`${child.label} exited early:\n${child.tail()}`);
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${url}${child ? `\n${child.tail()}` : ''}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function stop(...children) {
  for (const child of children) {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise((r) => { const t = setTimeout(() => { child.kill('SIGKILL'); r(); }, 3000); child.once('exit', () => { clearTimeout(t); r(); }); });
    }
  }
}

export function readTimeline(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export const isRoomWrite = (w) => /room_live_sessions|persist_room_live_session/.test(w.key) && w.key.startsWith('POST');

export function median(values) {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return NaN;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** The server the multiplayer and Daily checks run against: the built server (node server/dist/index.js) on the stub Supabase. */
export function serverEnv({ stubPort, port, fastFlag }) {
  return {
    NODE_ENV: 'development',
    PORT: String(port),
    SUPABASE_URL: `http://127.0.0.1:${stubPort}`,
    SUPABASE_SERVICE_KEY: 'stub',
    E2E_AUTH_SHIM: '1',
    E2E_INSPECT: '1',
    DAILY_FRITZ_MEMORY_STORE: '1',
    DAILY_FRITZ_TEST_FIXTURES_ENABLED: 'true',
    MP_PRIVATE_CERT_MODE: '1',
    REVIEW_SWEEP_ENABLED: 'false',
    ...(fastFlag ? { MP_HAND_BOUNDARY_FAST: 'true' } : {}),
  };
}

/** Joins the driver's boundary results with the stub's timeline: writes awaited by the second player, and room-session bytes. */
export function boundaryWrites(boundary, timeline) {
  const writes = timeline.filter(isRoomWrite);
  // The writes the second player was waiting on: still in flight (or started) after its tap, and begun before its ack.
  const awaited = writes.filter((w) => w.tOut > boundary.tSecond - 5 && w.tIn <= boundary.tSecondAck);
  // Everything room-session written for this boundary, from the first tap to the new hand dealt.
  const all = writes.filter((w) => w.tIn >= boundary.tFirst - 20 && w.tIn <= boundary.tDealt + 5);
  const bytes = all.reduce((sum, w) => sum + w.bytes, 0);
  const seq = Math.max(0, ...all.map((w) => w.seq ?? 0));
  return { awaited: awaited.length, bytes, seq, bytesPerStep: seq > 0 ? bytes / seq : NaN, writes: all.map((w) => ({ ev: w.ev, bytes: w.bytes, seq: w.seq })) };
}
