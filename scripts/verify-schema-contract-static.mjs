import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (path) => JSON.parse(readFileSync(join(repoRoot, path), 'utf8'));
const ledger = readJson('supabase/migration-ledger.json');
const contract = readJson('supabase/application-schema-contract.json');
const orderedPaths = [...ledger.base, ...ledger.migrations].map((entry) => entry.path);
const orderedSql = orderedPaths
  .map((path, index) => `\n-- ledger-entry:${index}:${path}\n${readFileSync(join(repoRoot, path), 'utf8')}`)
  .join('\n');
const verifierSql = readFileSync(join(repoRoot, 'supabase/verify-application-schema.sql'), 'utf8');
const normalized = orderedSql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
const failures = [];

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasCreate = (kind, name) => new RegExp(
  `create\\s+(?:or\\s+replace\\s+)?${kind}\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${escapeRegex(name)}\\b`,
  'i',
).test(normalized);

function relationColumns(name) {
  const columns = new Set();
  const table = escapeRegex(name);
  const createPattern = new RegExp(
    `create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\s*\\(([\\s\\S]*?)\\);`,
    'gi',
  );
  for (const match of normalized.matchAll(createPattern)) {
    for (const segment of match[1].split(',')) {
      const column = segment.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+/i)?.[1]?.toLowerCase();
      if (column && !['constraint', 'primary', 'unique', 'check', 'foreign'].includes(column)) columns.add(column);
    }
  }
  const alterPattern = new RegExp(
    `alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?${table}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?"?([a-z_][a-z0-9_]*)"?`,
    'gi',
  );
  for (const match of normalized.matchAll(alterPattern)) columns.add(match[1].toLowerCase());
  return columns;
}

for (const [relation, requiredColumns] of Object.entries(contract.relations)) {
  if (!hasCreate('table', relation)) {
    failures.push(`missing table declaration: public.${relation}`);
    continue;
  }
  const declaredColumns = relationColumns(relation);
  for (const column of requiredColumns) {
    if (!declaredColumns.has(column)) failures.push(`public.${relation}: missing required column ${column}`);
  }
  if (!verifierSql.includes(`'${relation}'`)) failures.push(`runtime verifier omits relation: ${relation}`);
}

for (const view of contract.views) {
  if (!hasCreate('view', view)) failures.push(`missing view declaration: public.${view}`);
  if (!verifierSql.includes(`'${view}'`)) failures.push(`runtime verifier omits view: ${view}`);
}

for (const fn of contract.functions) {
  if (!hasCreate('function', fn)) failures.push(`missing function declaration: public.${fn}()`);
  if (!verifierSql.includes(`'${fn}'`)) failures.push(`runtime verifier omits function: ${fn}()`);
}

const constraintDefinitions = [...normalized.matchAll(
  /(?:constraint\s+daily_puzzle_attempts_puzzles_completed_check\s+check|add\s+constraint\s+daily_puzzle_attempts_puzzles_completed_check\s+check)\s*\(([^)]*)\)/gi,
)].map((match) => match[1]);
const finalCompletionConstraint = constraintDefinitions.at(-1) ?? '';
if (!/puzzles_completed\s+between\s+0\s+and\s+5/i.test(finalCompletionConstraint)) {
  failures.push('final Daily Puzzle completion constraint is not 0..5');
}

if (failures.length) {
  console.error('Static application schema contract failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

const columnCount = Object.values(contract.relations).reduce((sum, columns) => sum + columns.length, 0);
console.log(
  `Static schema contract verified: ${Object.keys(contract.relations).length} relations, `
  + `${contract.views.length} views, ${contract.functions.length} functions, ${columnCount} critical columns.`,
);
