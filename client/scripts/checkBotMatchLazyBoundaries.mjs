/**
 * Regression guard — Phase AA Task 6.
 * Ensures standard bot-match entry does not statically depend on lessonV2 or analyzer runtime.
 *
 * Usage:
 *   node scripts/checkBotMatchLazyBoundaries.mjs          # source graph only
 *   node scripts/checkBotMatchLazyBoundaries.mjs --dist   # source + production chunk scan (requires npm run build)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');
const SRC_ROOT = path.join(CLIENT_ROOT, 'src');
const DIST_ASSETS = path.join(CLIENT_ROOT, 'dist', 'assets');

const BOT_MATCH_ENTRY = path.join(SRC_ROOT, 'bot', 'BotMatchScreen.tsx');

const EAGER_DIST_CHUNK_PREFIXES = ['BotMatchScreen', 'bot-guided', 'bot-hand-lifecycle'];

/** Production chunk static import — dynamic import() and mapDeps metadata are allowed. */
const DIST_STATIC_FORBIDDEN = [
  { id: 'lesson-v2', pattern: /from["']\.\/lesson-v2-/ },
  { id: 'analyzer', pattern: /from["']\.\/analyzer-/ },
];

const SOURCE_STATIC_IMPORT_RE =
  /^\s*import\s+(?!type\b)(?:(?:\{[^}]*\}|[\w$]+)\s+from\s+)?['"]([^'"]+)['"]/;

export function isForbiddenRuntimeModule(resolvedPath) {
  const normalized = resolvedPath.split(path.sep).join('/');
  if (normalized.includes('/learn/lessonV2')) return 'lesson-v2';
  if (normalized.includes('/analyzer/')) return 'analyzer';
  return null;
}

export function chunkHasForbiddenStaticImport(chunkSource, forbidden = DIST_STATIC_FORBIDDEN) {
  const hits = [];
  for (const rule of forbidden) {
    if (rule.pattern.test(chunkSource)) {
      hits.push(rule.id);
    }
  }
  return hits;
}

export function isLessonV2ChunkRequest(url) {
  if (/lessonV2LazyRegistry/i.test(url)) return false;
  return /lesson-v2-[^/]+\.js/i.test(url) || /\/learn\/lessonV2(\.ts|\.js)/i.test(url);
}

export function isAnalyzerChunkRequest(url) {
  if (/analyzer\.behaviorTests/i.test(url)) return false;
  return /\/analyzer-[^/]+\.js/i.test(url) || /\/src\/analyzer\/(moveAnalyzer|handSegmentation|consequenceChain|analysisTypes)/i.test(url);
}

function resolveImport(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function collectStaticImports(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const imports = [];
  for (const line of content.split('\n')) {
    if (/import\s*\(/.test(line)) continue;
    const match = line.match(SOURCE_STATIC_IMPORT_RE);
    if (match) imports.push(match[1]);
  }
  return imports;
}

function scanSourceGraph() {
  const violations = [];
  const visited = new Set();
  const queue = [BOT_MATCH_ENTRY];

  if (!fs.existsSync(BOT_MATCH_ENTRY)) {
    throw new Error(`Missing bot match entry: ${BOT_MATCH_ENTRY}`);
  }

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    for (const specifier of collectStaticImports(filePath)) {
      const resolved = resolveImport(filePath, specifier);
      if (!resolved) continue;

      const forbidden = isForbiddenRuntimeModule(resolved);
      if (forbidden) {
        violations.push({
          kind: 'source-static-import',
          chunk: forbidden,
          file: path.relative(CLIENT_ROOT, filePath),
          import: specifier,
          resolved: path.relative(CLIENT_ROOT, resolved),
        });
      }

      if (resolved.startsWith(SRC_ROOT) && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return violations;
}

function scanDistChunks() {
  if (!fs.existsSync(DIST_ASSETS)) {
    throw new Error('dist/assets not found — run npm run build before --dist');
  }

  const violations = [];
  const files = fs.readdirSync(DIST_ASSETS).filter((name) => name.endsWith('.js'));

  for (const prefix of EAGER_DIST_CHUNK_PREFIXES) {
    const chunkFile = files.find((name) => name.startsWith(prefix));
    if (!chunkFile) {
      violations.push({
        kind: 'missing-chunk',
        chunk: prefix,
        message: `Expected production chunk ${prefix}-*.js`,
      });
      continue;
    }

    const source = fs.readFileSync(path.join(DIST_ASSETS, chunkFile), 'utf8');
    for (const hit of chunkHasForbiddenStaticImport(source)) {
      violations.push({
        kind: 'dist-static-import',
        chunk: hit,
        file: `dist/assets/${chunkFile}`,
      });
    }
  }

  return violations;
}

function main() {
  const checkDist = process.argv.includes('--dist');
  const violations = scanSourceGraph();

  if (checkDist) {
    violations.push(...scanDistChunks());
  }

  if (violations.length === 0) {
    console.log('✓ Bot match lazy boundaries: no forbidden lesson-v2 or analyzer static dependencies');
    if (checkDist) {
      console.log(`  dist chunks checked: ${EAGER_DIST_CHUNK_PREFIXES.join(', ')}`);
    }
    console.log('  source graph entry: src/bot/BotMatchScreen.tsx');
    return;
  }

  console.error('❌ Bot match lazy boundary violations:\n');
  for (const v of violations) {
    if (v.kind === 'source-static-import') {
      console.error(
        `  [source] ${v.file} statically imports ${v.import} → ${v.resolved} (${v.chunk} runtime)`,
      );
    } else if (v.kind === 'dist-static-import') {
      console.error(`  [dist] ${v.file} has static import from ./${v.chunk}- chunk`);
    } else {
      console.error(`  [dist] ${v.message}`);
    }
  }
  console.error(
    '\nFix: use dynamic import() / lazy preload for lessonV2 and analyzer on the standard bot path.',
  );
  process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main();
}