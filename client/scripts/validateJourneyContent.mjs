#!/usr/bin/env node
/**
 * Validates Racehorse Journey chapter/node content.
 * Run: npm run qa:journey-content --prefix client
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(scriptDir, '..');

const result = spawnSync(
  'npx',
  [
    'ts-node',
    '--esm',
    path.join(scriptDir, 'validateJourneyContentRunner.ts'),
    ...process.argv.slice(2),
  ],
  { cwd: clientRoot, stdio: 'inherit', shell: false },
);

process.exit(result.status === 0 ? 0 : 1);
