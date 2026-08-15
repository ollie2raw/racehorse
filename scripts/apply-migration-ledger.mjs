import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required. Use a disposable Postgres/Supabase database, never production by default.');
  process.exit(2);
}
if (process.env.ALLOW_PRODUCTION_MIGRATION !== 'true' && /prod|production/i.test(databaseUrl)) {
  console.error('Refusing a production-looking DATABASE_URL without ALLOW_PRODUCTION_MIGRATION=true.');
  process.exit(2);
}

const ledger = JSON.parse(readFileSync(join(repoRoot, 'supabase/migration-ledger.json'), 'utf8'));
const files = [...ledger.base, ...ledger.migrations];
for (const [index, entry] of files.entries()) {
  console.log(`[${index + 1}/${files.length}] applying ${entry.path}`);
  const result = spawnSync('psql', [databaseUrl, '--set', 'ON_ERROR_STOP=1', '--file', join(repoRoot, entry.path)], {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(`Unable to execute psql: ${result.error.message}`);
    process.exit(2);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const verification = spawnSync(
  'psql',
  [databaseUrl, '--set', 'ON_ERROR_STOP=1', '--file', join(repoRoot, 'supabase/verify-application-schema.sql')],
  { stdio: 'inherit' },
);
if (verification.error) {
  console.error(`Unable to execute schema verification: ${verification.error.message}`);
  process.exit(2);
}
process.exit(verification.status ?? 1);
