import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function findBehaviorTests(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      results.push(...findBehaviorTests(fullPath));
      continue;
    }
    if (entry.endsWith('.behaviorTests.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = findBehaviorTests(path.join(rootDir, 'src')).sort();

if (files.length === 0) {
  console.error('[run-behavior-tests] no *.behaviorTests.ts files found');
  process.exit(1);
}

for (const file of files) {
  const relativePath = path.relative(rootDir, file);
  console.log(`\n>>> ${relativePath}`);
  const result = spawnSync('npx', ['tsx', relativePath], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`\n[run-behavior-tests] ${files.length} files passed`);
