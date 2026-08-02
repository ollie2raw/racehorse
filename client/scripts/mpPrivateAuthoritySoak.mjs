#!/usr/bin/env node
/**
 * Private-match authority soak — repeated socket-protocol waves.
 *
 * Usage (server must already be running, same as socket smoke):
 *   MP_PRIVATE_CERT_MODE=1 SMOKE_REQUIRE_CERT=1 SMOKE_REPEAT=10 npm run soak:mp-private-authority --prefix client
 *
 * This is the MP twin of Daily Fritz authority soak: prove create/join/start/move/
 * reconnect/takeover/leave/rematch scenarios remain green under repeated waves.
 * Set MP_PRIVATE_CERT_MODE=1 on the server so winningScore=5 is accepted for rematch cert.
 * Set SMOKE_REQUIRE_CERT=1 so rematch does not soft-skip when cert mode is missing.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const smokeScript = path.join(__dirname, 'socketSmoke.mjs');
const waves = Math.max(1, Number(process.env.MP_SOAK_WAVES ?? process.env.SMOKE_REPEAT ?? 10));
const scenarios =
  process.env.MP_SOAK_SCENARIOS ??
  [
    'private-create-join-start-move',
    'private-midmatch-leave-forfeit',
    'private-rematch-after-short-match',
    'concurrent-action-serialization',
    'lifecycle-reconnect',
    'mid-hand-action-reliability',
    'guest-seat-reconnect',
    'same-user-active-seat-takeover',
    'hand-ended-replay',
  ].join(',');

function runWave(wave) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [smokeScript], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        SMOKE_REPEAT: '1',
        SMOKE_ONLY: scenarios,
        // Fail closed on rematch soft-skip unless explicitly overridden.
        SMOKE_REQUIRE_CERT: process.env.SMOKE_REQUIRE_CERT ?? '1',
      },
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`MP soak wave ${wave} failed with exit ${code}`));
    });
  });
}

async function main() {
  console.log(
    JSON.stringify({
      channel: 'mp.soak',
      event: 'start',
      waves,
      scenarios: scenarios.split(',').map((s) => s.trim()),
    }),
  );
  const started = Date.now();
  for (let wave = 1; wave <= waves; wave += 1) {
    const waveStarted = Date.now();
    await runWave(wave);
    console.log(
      JSON.stringify({
        channel: 'mp.soak',
        event: 'wave_ok',
        wave,
        durationMs: Date.now() - waveStarted,
      }),
    );
  }
  console.log(
    JSON.stringify({
      channel: 'mp.soak',
      event: 'complete',
      waves,
      durationMs: Date.now() - started,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
