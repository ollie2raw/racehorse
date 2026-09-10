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

// `tsx`, not `ts-node --esm`: this codebase's extensionless / `.ts`-suffixed
// relative imports don't resolve under ts-node's ESM loader (it threw
// ERR_MODULE_NOT_FOUND on src/utils/logger). `tsx` handles them, and is what
// the other script runners here already use (check:architecture, test:analyzer).
const result = spawnSync(
  'npx',
  [
    'tsx',
    path.join(scriptDir, 'validateJourneyContentRunner.ts'),
    ...process.argv.slice(2),
  ],
  { cwd: clientRoot, stdio: 'inherit', shell: false },
);

process.exit(result.status === 0 ? 0 : 1);
