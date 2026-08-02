import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { waitForGameServerReady } from './helpers/multiplayerMatch';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(clientDir, '..');

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async () => {
  await waitForGameServerReady();
});

/**
 * Rematch vertical proof against the Playwright-managed server.
 * UI play-to-target is too slow/flaky for CI; protocol smoke covers rematch
 * once MP_PRIVATE_CERT_MODE unlocks winningScore=5 on the E2E server.
 */
test('private rematch after short match (protocol, cert mode)', async () => {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(clientRoot, 'scripts/socketSmoke.mjs')], {
      cwd: clientRoot,
      env: {
        ...process.env,
        SMOKE_ONLY: 'private-rematch-after-short-match',
        SMOKE_REPEAT: '1',
        SMOKE_REQUIRE_CERT: '1',
        SMOKE_SERVER_URL: process.env.SMOKE_SERVER_URL ?? 'http://127.0.0.1:3001',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      const combined = `${stdout}\n${stderr}`;
      if (code !== 0) {
        reject(new Error(`rematch smoke failed (exit ${code}):\n${combined}`));
        return;
      }
      resolve(combined);
    });
  });

  expect(output).toContain('"ok": true');
  expect(output).toContain('private-rematch-after-short-match');
  expect(output).toContain('"rematchStarted": true');
  expect(output).not.toContain('skippedWithoutCertMode');
});
