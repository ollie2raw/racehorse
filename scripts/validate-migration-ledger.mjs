import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = join(repoRoot, 'supabase/migration-ledger.json');
const ledgerDocumentPath = join(repoRoot, 'supabase/MIGRATION_LEDGER.md');
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const ledgerDocument = readFileSync(ledgerDocumentPath, 'utf8');
const entries = [...ledger.base, ...ledger.migrations];
const paths = entries.map((entry) => entry.path);
const failures = [];

function walkSql(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) return walkSql(absolute);
    return entry.name.endsWith('.sql') ? [relative(repoRoot, absolute)] : [];
  });
}

for (const entry of entries) {
  const absolute = join(repoRoot, entry.path);
  if (!entry.purpose?.trim()) failures.push(`${entry.path}: missing purpose`);
  try {
    if (!statSync(absolute).isFile()) failures.push(`${entry.path}: not a file`);
  } catch {
    failures.push(`${entry.path}: missing`);
  }
}

for (const path of new Set(paths)) {
  if (paths.filter((candidate) => candidate === path).length > 1) {
    failures.push(`${path}: appears more than once in the ledger`);
  }
}

const migrationFiles = walkSql(join(repoRoot, 'supabase/migrations')).sort();
const ledgerMigrationFiles = ledger.migrations.map((entry) => entry.path).sort();
for (const path of migrationFiles) {
  if (!ledgerMigrationFiles.includes(path)) failures.push(`${path}: migration is not in the ledger`);
}
for (const path of ledgerMigrationFiles) {
  if (!migrationFiles.includes(path)) failures.push(`${path}: ledger references a nonexistent migration`);
}

const documentedPaths = [...ledgerDocument.matchAll(/^\|\s*\d+\s*\|\s*`(supabase\/[^`]+\.sql)`\s*\|/gm)]
  .map((match) => match[1]);
if (documentedPaths.length !== paths.length) {
  failures.push(`supabase/MIGRATION_LEDGER.md: expected ${paths.length} ordered SQL rows, found ${documentedPaths.length}`);
}
for (const [index, path] of paths.entries()) {
  if (documentedPaths[index] !== path) {
    failures.push(`supabase/MIGRATION_LEDGER.md: row ${index + 1} must document ${path}, found ${documentedPaths[index] ?? 'nothing'}`);
  }
}

const requiredOrder = [
  ['supabase/verified_matches.sql', 'supabase/migrations/2026-08-01_daily_fritz_transactional_commands.sql'],
  ['supabase/room_live_sessions.sql', 'supabase/migrations/2026-08-02_multiplayer_live_room_authority.sql'],
  ['supabase/fritz_challenges.sql', 'supabase/migrations/2026-08-02_fritz_challenge_authority_primitives.sql'],
  ['supabase/migrations/2026-08-01_daily_fritz_published_challenges.sql', 'supabase/migrations/2026-08-01_daily_fritz_command_primitives.sql'],
  ['supabase/migrations/2026-08-01_daily_fritz_command_primitives.sql', 'supabase/migrations/2026-08-01_daily_fritz_transactional_commands.sql'],
  ['supabase/migrations/2026-08-01_daily_fritz_transactional_commands.sql', 'supabase/migrations/2026-08-01_daily_fritz_canonical_telemetry.sql'],
  ['supabase/migrations/2026-08-06_daily_puzzle_five_slot_ladder.sql', 'supabase/migrations/2026-08-06_daily_puzzle_five_slot_completion_constraint.sql'],
  ['supabase/migrations/2026-08-06_daily_puzzle_canonical_telemetry.sql', 'supabase/migrations/2026-08-08_daily_puzzle_telemetry_taxonomy_v2.sql'],
];
for (const [before, after] of requiredOrder) {
  if (paths.indexOf(before) >= paths.indexOf(after)) failures.push(`${before}: must run before ${after}`);
}

if (failures.length > 0) {
  console.error('Migration ledger validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Migration ledger valid: ${ledger.base.length} base files, ${ledger.migrations.length} migrations.`);
