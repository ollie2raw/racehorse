/**
 * Master architecture invariant verifier — Phase Q.
 * Aggregates multiplayer boundary checks, purity audits, and documentation drift detection.
 * Run: npm run check:architecture
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_SOCKET_REGISTRAR_FILES,
  getEnforcedTournamentRegistryEntries,
  GRANDFATHERED_DIRECT_SOCKET_ON,
  SOCKET_EVENT_REGISTRY,
} from '../src/multiplayer/socketEventRegistry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_ROOT = path.resolve(__dirname, '..');
const CLIENT_SRC = path.join(CLIENT_ROOT, 'src');
const REPO_ROOT = path.resolve(CLIENT_ROOT, '..');
const SERVER_SRC = path.join(REPO_ROOT, 'server/src');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs/architecture/architecture-manifest.json');

// ---------------------------------------------------------------------------
// Wave 3 — Invariants guarding the server-authority takeover (dailyFritz.ts,
// useLiveMatchActions.ts, AppRoutes.tsx extraction). These are intentionally
// simple heuristic checks (guardrails, not proofs) per the Wave 3 charter.
// ---------------------------------------------------------------------------

// Files (relative to server/src) that legitimately call socket.on() but do
// not follow the register*Handlers.ts naming convention. This list is a
// closed grandfather set frozen at Wave 3 time — it must not grow. Any new
// file outside this set and outside the register*Handlers.ts pattern that
// calls socket.on() is a regression and fails INV-11.
const SERVER_SOCKET_ON_GRANDFATHER: string[] = [
  'index.ts',
  'matchmaking/index.ts',
  'scheduledTournament/socketHandlers.ts',
  'spectator/spectatorRegistry.ts',
  'legacyTournament/registerLegacyTournamentHandlers.ts',
  'social/registerFriendInviteHandlers.ts',
  'social/registerPresenceHandlers.ts',
];

const LOC_CAPS: Array<{ file: string; cap: number }> = [
  { file: 'server/src/http/routes/dailyFritz.ts', cap: 800 },
  { file: 'client/src/match/session/actions/useLiveMatchActions.ts', cap: 400 },
  { file: 'client/src/AppRoutes.tsx', cap: 500 },
];

/**
 * INV-15 — Guarded floating imports.
 *
 * A dynamic import started as a floating promise (`void import(...)`) has
 * nowhere to report a failure. A failed chunk fetch therefore surfaced as an
 * unhandled rejection, which the global module-import-recovery handler could
 * not distinguish from a chunk the UI actually needs — so a telemetry chunk
 * failing to load could force-reload a working app.
 *
 * Deliberately narrow. It looks only at the floating form: an awaited import
 * is owned by its enclosing try/catch, and `React.lazy` failures reach an
 * ErrorBoundary, which is the path module-import recovery now runs on.
 *
 * Returns the offending `import(...)` expressions, so a failure names them.
 */
export function findUnguardedFloatingImports(source: string): string[] {
  const offenders: string[] = [];
  const floating = /\bvoid\s+import\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = floating.exec(source)) !== null) {
    const importStart = source.indexOf('import', match.index);
    const openParen = source.indexOf('(', importStart);
    const specifierEnd = matchingParen(source, openParen);
    if (specifierEnd < 0) continue;

    const expression = source.slice(importStart, specifierEnd + 1).replace(/\s+/g, '');
    const chainEnd = endOfStatement(source, specifierEnd + 1);
    const chain = source.slice(specifierEnd + 1, chainEnd);
    if (!/\.catch\s*\(/.test(chain)) offenders.push(expression);
  }

  return offenders;
}

/** Index of the `)` closing the `(` at `open`, or -1. */
function matchingParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '(') depth += 1;
    else if (source[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * End of the statement that began at `from`: the first `;` at paren/brace
 * depth zero. Bounded by the source length so an unterminated statement does
 * not swallow the rest of the file and borrow a later statement's `.catch`.
 */
function endOfStatement(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    const char = source[i];
    if (char === '(' || char === '{' || char === '[') depth += 1;
    else if (char === ')' || char === '}' || char === ']') depth -= 1;
    else if (char === ';' && depth <= 0) return i;
  }
  return source.length;
}

type CheckResult = {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn';
  errors: string[];
  warnings: string[];
  metrics?: Record<string, number | string | boolean>;
};

type ArchitectureManifest = {
  runtime: {
    allowedConstructionSites: string[];
    nestedRuntimeFactoriesFile: string;
    singletonGuard: boolean;
  };
  socketRegistry: {
    grandfatheredDirectSocketOn: number;
    approvedRegistrarFiles: number;
  };
  session: {
    pureCoreFiles: string[];
    adapterAllowlist: string[];
  };
  registrar: {
    approvedFiles: string[];
    grandfatheredBusinessLogic: string[];
  };
  projection: {
    pureTransformFiles: string[];
    applyLayerFile: string;
  };
  documentation: {
    canonicalReports: string[];
    stalePatterns: string[];
  };
};

const results: CheckResult[] = [];
const allErrors: string[] = [];
const allWarnings: string[] = [];

function relativeSrcPath(absolutePath: string): string {
  return path.relative(CLIENT_SRC, absolutePath).split(path.sep).join('/');
}

function walkTsFiles(dir: string, results: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walkTsFiles(fullPath, results);
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function readFile(relativePath: string): string {
  const absolute = relativePath.startsWith('multiplayer/') || relativePath.startsWith('tournament/')
    ? path.join(CLIENT_SRC, relativePath)
    : path.join(CLIENT_SRC, relativePath);
  return fs.readFileSync(absolute, 'utf8');
}

function addResult(result: CheckResult): void {
  results.push(result);
  for (const error of result.errors) {
    allErrors.push(`[${result.id}] ${error}`);
  }
  for (const warning of result.warnings) {
    allWarnings.push(`[${result.id}] ${warning}`);
  }
}

function extractImportPaths(content: string): string[] {
  const imports: string[] = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      imports.push(match[1]);
    }
  }
  return imports;
}

function resolvesToForbiddenModule(
  importPath: string,
  file: string,
  forbidden: Array<{ label: string; test: (resolved: string) => boolean }>,
): string[] {
  const violations: string[] = [];
  const fileDir = path.dirname(path.join(CLIENT_SRC, file));
  let resolved = importPath;
  if (importPath.startsWith('.')) {
    resolved = path.normalize(path.relative(CLIENT_SRC, path.join(fileDir, importPath)));
  }
  resolved = resolved.split(path.sep).join('/');

  for (const rule of forbidden) {
    if (rule.test(resolved) || rule.test(importPath)) {
      violations.push(rule.label);
    }
  }
  return violations;
}

function loadManifest(): ArchitectureManifest {
  return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as ArchitectureManifest;
}

// ---------------------------------------------------------------------------
// 1. Runtime Ownership
// ---------------------------------------------------------------------------
function checkRuntimeOwnership(manifest: ArchitectureManifest): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceFiles = walkTsFiles(CLIENT_SRC);
  const allowedSites = new Set(manifest.runtime.allowedConstructionSites);
  const allowedNestedFiles = new Set([
    manifest.runtime.nestedRuntimeFactoriesFile,
    'multiplayer/runtime/createMultiplayerRuntime.ts',
  ]);

  const multiplayerRuntimeCalls: Array<{ file: string; line: number }> = [];
  const nestedRuntimeCalls: Array<{ file: string; line: number; callee: string }> = [];

  for (const absolutePath of sourceFiles) {
    const file = relativeSrcPath(absolutePath);
    if (file.includes('modules/match/')) continue;

    const content = fs.readFileSync(absolutePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (
        /\bcreateMultiplayerRuntime\s*\(/.test(line) &&
        !line.trim().startsWith('//') &&
        !/\bfunction\s+createMultiplayerRuntime\b/.test(line) &&
        !/\bexport\s+function\s+createMultiplayerRuntime\b/.test(line)
      ) {
        multiplayerRuntimeCalls.push({ file, line: i + 1 });
      }
      const nestedMatch = line.match(/\b(create[A-Z]\w*Runtime)\s*\(/);
      if (
        nestedMatch &&
        nestedMatch[1] !== 'createMultiplayerRuntime' &&
        !/\bfunction\s+/.test(line) &&
        !/\bexport\s+function\s+/.test(line)
      ) {
        nestedRuntimeCalls.push({ file, line: i + 1, callee: nestedMatch[1] });
      }
    }

    if (
      file.endsWith('.tsx') &&
      file !== 'App.tsx' &&
      /\bcreateMultiplayerRuntime\s*\(/.test(content)
    ) {
      errors.push(`Component ${file} constructs createMultiplayerRuntime — only App.tsx may construct runtime`);
    }
    if (/^multiplayer\/use/.test(file) && content.includes('createMultiplayerRuntime')) {
      errors.push(`Hook ${file} references createMultiplayerRuntime`);
    }
  }

  for (const call of multiplayerRuntimeCalls) {
    if (!allowedSites.has(call.file)) {
      errors.push(
        `createMultiplayerRuntime() at ${call.file}:${call.line} — allowed only in ${[...allowedSites].join(', ')}`,
      );
    }
  }

  for (const call of nestedRuntimeCalls) {
    if (!allowedNestedFiles.has(call.file)) {
      errors.push(
        `Nested ${call.callee}() at ${call.file}:${call.line} — slice factories only in runtimeComposition.ts / createMultiplayerRuntime.ts`,
      );
    }
  }

  const compositionRoot = readFile('multiplayer/runtime/createMultiplayerRuntime.ts');
  if (!compositionRoot.includes('activeRuntime') || !compositionRoot.includes('called more than once')) {
    errors.push('createMultiplayerRuntime.ts missing singleton guard (activeRuntime)');
  }

  addResult({
    id: 'INV-01',
    name: 'Runtime Ownership',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: {
      createMultiplayerRuntimeCallSites: multiplayerRuntimeCalls.length,
      nestedRuntimeCallSites: nestedRuntimeCalls.length,
      allowedConstructionSites: allowedSites.size,
    },
  });
}

// ---------------------------------------------------------------------------
// 2. Session Purity
// ---------------------------------------------------------------------------
function checkSessionPurity(manifest: ArchitectureManifest): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sessionDir = path.join(CLIENT_SRC, 'multiplayer/session');
  const sessionFiles = walkTsFiles(sessionDir).map(relativeSrcPath);

  const forbiddenForCore = [
    { label: 'React', test: (p: string) => p === 'react' || p.startsWith('react/') },
    { label: 'socket.io', test: (p: string) => p.includes('socket.io') },
    { label: 'projection', test: (p: string) => p.includes('projection/') || p.includes('/projection') },
    { label: 'RecoveryMachine', test: (p: string) => p.includes('recoveryMachine') },
    { label: 'gameplay', test: (p: string) => /gameplay/.test(p) && !p.includes('sessionTypes') },
    { label: 'runtime/', test: (p: string) => p.includes('runtime/') },
  ];

  const adapterAllowlist = new Set(manifest.session.adapterAllowlist);
  const pureCore = new Set(manifest.session.pureCoreFiles);

  for (const file of sessionFiles) {
    if (/\.(test|behaviorTests)\./.test(file)) continue;
    const content = readFile(file);
    const imports = extractImportPaths(content);

    if (pureCore.has(file) || (!adapterAllowlist.has(file) && !file.endsWith('.tsx'))) {
      for (const importPath of imports) {
        const violations = resolvesToForbiddenModule(importPath, file, forbiddenForCore);
        for (const violation of violations) {
          if (adapterAllowlist.has(file) && (violation === 'React' || violation === 'runtime/')) {
            continue;
          }
          if (!adapterAllowlist.has(file)) {
            errors.push(`${file} imports forbidden ${violation} via "${importPath}"`);
          }
        }
      }
    }

    if (adapterAllowlist.has(file)) {
      for (const importPath of imports) {
        const violations = resolvesToForbiddenModule(importPath, file, forbiddenForCore);
        for (const violation of violations) {
          if (violation !== 'React' && violation !== 'runtime/') {
            errors.push(`Session adapter ${file} imports forbidden ${violation} via "${importPath}"`);
          }
        }
      }
    }
  }

  const bridgeInSession = sessionFiles.some((f) => f.endsWith('sessionProjectionBridge.ts'));
  if (bridgeInSession) {
    errors.push('sessionProjectionBridge.ts must live outside multiplayer/session/ (projection bridge is not session core)');
  }

  addResult({
    id: 'INV-02',
    name: 'Session Purity',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: {
      sessionFilesScanned: sessionFiles.length,
      pureCoreFiles: pureCore.size,
      adapterAllowlist: adapterAllowlist.size,
    },
  });
}

// ---------------------------------------------------------------------------
// 3. Registrar Purity
// ---------------------------------------------------------------------------
function checkRegistrarPurity(manifest: ArchitectureManifest): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (manifest.registrar.grandfatheredBusinessLogic.length > 0) {
    errors.push(
      `Manifest registrar.grandfatheredBusinessLogic must be empty (Phase S) — found ${manifest.registrar.grandfatheredBusinessLogic.length}`,
    );
  }

  const hookPatterns = [
    /\buseState\s*\(/,
    /\buseEffect\s*\(/,
    /\buseLayoutEffect\s*\(/,
    /\buseNavigate\s*\(/,
    /\buseCallback\s*\(/,
    /\bnavigate\s*\(/,
  ];

  const businessLogicImports = [
    /from\s+['"]\.\.\/bot\//,
    /from\s+['"]\.\.\/game\//,
    /from\s+['"]\.\.\/utils\/sound/,
    /from\s+['"]\.\/botEngine/,
  ];

  const businessLogicPatterns = [
    /\bplay(?:Blocked|HandWin|HandLose)Sound\s*\(/,
    /\bhandRevealTimerRef\b/,
    /\bhandRevealShownRef\b/,
    /\bwinningScore\b/,
  ];

  const reactTypeImport = /import\s+type\s+[^;]+\sfrom\s+['"]react['"]/;

  for (const file of manifest.registrar.approvedFiles) {
    const content = readFile(file);

    for (const pattern of hookPatterns) {
      if (pattern.test(content)) {
        errors.push(`${file} uses React hooks or navigate — registrars must only register and dispatch delegates`);
      }
    }

    if (reactTypeImport.test(content)) {
      errors.push(`${file} imports React types — use protocol/runtime RefBox types in registrars`);
    }

    if (!content.includes('registerRawSocketEventHandler') && !content.includes('registerNormalizedSocketRouter')) {
      errors.push(`${file} missing socket registration — registrar must register handlers`);
    }

    for (const pattern of businessLogicImports) {
      if (pattern.test(content)) {
        errors.push(`${file} imports business logic directly — registrars must dispatch delegates only`);
      }
    }

    for (const pattern of businessLogicPatterns) {
      if (pattern.test(content)) {
        errors.push(`${file} contains inline business logic — registrars must dispatch delegates only`);
      }
    }
  }

  addResult({
    id: 'INV-03',
    name: 'Registrar Purity',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: { registrarFiles: manifest.registrar.approvedFiles.length },
  });
}

// ---------------------------------------------------------------------------
// 4. Projection Purity
// ---------------------------------------------------------------------------
function checkProjectionPurity(manifest: ArchitectureManifest): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  const forbidden = [
    { label: 'React', test: (p: string) => p === 'react' || p.startsWith('react/') },
    { label: 'navigation', test: (p: string) => p.includes('react-router') || p.includes('navigate') },
    { label: 'socket emit', test: (p: string) => p.includes('socket.io') || p === './socketEventBus' },
    { label: 'session mutation', test: (p: string) => p.includes('sessionReducer') || p.includes('dispatchSession') },
  ];

  const forbiddenPatterns = [
    { label: 'navigate()', pattern: /\bnavigate\s*\(/ },
    { label: 'socket.emit', pattern: /\bsocket\.emit\s*\(/ },
    { label: 'dispatchSession', pattern: /\bdispatchSession\s*\(/ },
    { label: 'reduceSession', pattern: /\breduceSession\s*\(/ },
  ];

  for (const file of manifest.projection.pureTransformFiles) {
    const content = readFile(file);
    const imports = extractImportPaths(content);

    for (const importPath of imports) {
      const violations = resolvesToForbiddenModule(importPath, file, forbidden);
      for (const violation of violations) {
        errors.push(`Projection transform ${file} imports forbidden ${violation} via "${importPath}"`);
      }
    }

    for (const { label, pattern } of forbiddenPatterns) {
      if (pattern.test(content)) {
        errors.push(`Projection transform ${file} contains forbidden ${label}`);
      }
    }
  }

  const applyContent = readFile(manifest.projection.applyLayerFile);
  if (!applyContent.includes('MutableRefObject')) {
    warnings.push(`${manifest.projection.applyLayerFile} expected to bridge React refs — apply layer is not pure projection`);
  }

  addResult({
    id: 'INV-04',
    name: 'Projection Purity',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: { pureTransformFiles: manifest.projection.pureTransformFiles.length },
  });
}

// ---------------------------------------------------------------------------
// 5. Recovery Isolation
// ---------------------------------------------------------------------------
function checkRecoveryIsolation(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const file = 'multiplayer/recoveryMachine.ts';
  const content = readFile(file);
  const imports = extractImportPaths(content);

  const forbidden = [
    { label: 'projection', test: (p: string) => p.includes('projection/') },
    { label: 'gameplay', test: (p: string) => /\/gameplay|gameplayRuntime|boardSnapshot/.test(p) },
    { label: 'React', test: (p: string) => p === 'react' || p.startsWith('react/') },
  ];

  for (const importPath of imports) {
    const violations = resolvesToForbiddenModule(importPath, file, forbidden);
    for (const violation of violations) {
      errors.push(`recoveryMachine.ts imports forbidden ${violation} via "${importPath}"`);
    }
  }

  addResult({
    id: 'INV-05',
    name: 'Recovery Isolation',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// 6. Runtime Dependency Direction (runtime → controllers → UI)
// ---------------------------------------------------------------------------
function checkRuntimeDependencyDirection(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const runtimeDir = path.join(CLIENT_SRC, 'multiplayer/runtime');
  const runtimeFiles = walkTsFiles(runtimeDir).map(relativeSrcPath);

  const controllerPattern = /\/use[A-Z]\w+\.ts$/;
  const uiPattern = /\.tsx$/;

  for (const file of runtimeFiles) {
    if (file.endsWith('runtimeProvider.tsx')) continue;
    const content = readFile(file);
    const imports = extractImportPaths(content);

    for (const importPath of imports) {
      const resolved = importPath.startsWith('.')
        ? path.normalize(path.relative(CLIENT_SRC, path.join(path.dirname(path.join(CLIENT_SRC, file)), importPath))).split(path.sep).join('/')
        : importPath;

      if (controllerPattern.test(resolved) || /^multiplayer\/use/.test(resolved)) {
        errors.push(`Runtime layer ${file} imports controller hook ${resolved} — violates runtime → controllers → UI direction`);
      }
      if (uiPattern.test(resolved) && !resolved.includes('runtimeProvider')) {
        errors.push(`Runtime layer ${file} imports UI ${resolved}`);
      }
      if (resolved.startsWith('components/')) {
        errors.push(`Runtime layer ${file} imports component ${resolved}`);
      }
    }
  }

  const controllerFiles = walkTsFiles(path.join(CLIENT_SRC, 'multiplayer'))
    .map(relativeSrcPath)
    .filter((f) => /^multiplayer\/use/.test(f) && f.endsWith('.ts'));

  for (const file of controllerFiles) {
    const content = readFile(file);
    if (/\bcreateMultiplayerRuntime\s*\(/.test(content)) {
      errors.push(`Controller ${file} constructs runtime — must consume via provider/selectors`);
    }
  }

  addResult({
    id: 'INV-06',
    name: 'Runtime Dependency Direction',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: { runtimeFilesScanned: runtimeFiles.length, controllerHooksScanned: controllerFiles.length },
  });
}

// ---------------------------------------------------------------------------
// 7. Socket Registry Completeness (delegate to existing validator)
// ---------------------------------------------------------------------------
function checkSocketRegistryCompleteness(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    execSync('npx tsx scripts/validateSocketEventRegistry.ts', {
      cwd: CLIENT_ROOT,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    errors.push('Socket registry validator failed — orphan or missing registration path');
    if (output.trim()) {
      for (const line of output.split('\n').filter((l) => l.includes('✗'))) {
        errors.push(line.replace(/^\s*✗\s*/, '').trim());
      }
    }
  }

  const enforcedRaw = SOCKET_EVENT_REGISTRY.filter((e) => e.enforced && e.registrationKind === 'raw').length;
  const enforcedNormalized = SOCKET_EVENT_REGISTRY.filter(
    (e) => e.enforced && e.registrationKind === 'normalized',
  ).length;
  const tournament = getEnforcedTournamentRegistryEntries().length;

  addResult({
    id: 'INV-07',
    name: 'Socket Registry Completeness',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: {
      enforcedRawEvents: enforcedRaw,
      enforcedNormalizedRoutes: enforcedNormalized,
      enforcedTournamentEvents: tournament,
      grandfatheredDirectSocketOn: GRANDFATHERED_DIRECT_SOCKET_ON.length,
      approvedRegistrarFiles: APPROVED_SOCKET_REGISTRAR_FILES.length,
    },
  });
}

// ---------------------------------------------------------------------------
// 8. Singleton Runtime
// ---------------------------------------------------------------------------
function checkSingletonRuntime(manifest: ArchitectureManifest): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const appContent = readFile('App.tsx');

  if (!appContent.includes('multiplayerRuntimeRef.current = createMultiplayerRuntime')) {
    errors.push('App.tsx must assign createMultiplayerRuntime() to a ref exactly once per app session');
  }

  const testContent = readFile('multiplayer/runtime/runtimeBehaviorTests.ts');
  if (!testContent.includes('duplicate createMultiplayerRuntime throws')) {
    warnings.push('runtimeBehaviorTests.ts should assert duplicate construction throws');
  }

  if (!manifest.runtime.singletonGuard) {
    errors.push('architecture-manifest.json must declare singletonGuard: true');
  }

  addResult({
    id: 'INV-08',
    name: 'Singleton Runtime',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: { singletonGuardInManifest: manifest.runtime.singletonGuard },
  });
}

// ---------------------------------------------------------------------------
// 9. React Boundary
// ---------------------------------------------------------------------------
function checkReactBoundary(manifest: ArchitectureManifest): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  const forbiddenZones = [
    ...manifest.session.pureCoreFiles,
    'multiplayer/recoveryMachine.ts',
    'multiplayer/session/sessionReducer.ts',
    ...manifest.registrar.approvedFiles,
    ...manifest.projection.pureTransformFiles,
  ];

  const reactValueImport = /import\s+(?!type\b)[^;]*\sfrom\s+['"]react['"]/;
  const reactHookUsage = /\buse(?:State|Effect|LayoutEffect|Callback|Memo|Ref|Context|Reducer|SyncExternalStore)\s*\(/;

  const runtimeTsFiles = walkTsFiles(path.join(CLIENT_SRC, 'multiplayer/runtime'))
    .map(relativeSrcPath)
    .filter((f) => f.endsWith('.ts'));

  for (const file of runtimeTsFiles) {
    const content = readFile(file);
    if (reactValueImport.test(content) || reactHookUsage.test(content)) {
      errors.push(`Runtime module ${file} uses React values/hooks — React confined to runtimeProvider.tsx and adapters`);
    }
  }

  for (const file of forbiddenZones) {
    const content = readFile(file);
    if (reactValueImport.test(content) || reactHookUsage.test(content)) {
      errors.push(`${file} uses React — reducers, recovery, registrars, and pure projection must stay React-free`);
    }
    if (/import\s+type\s+[^;]+\sfrom\s+['"]react['"]/.test(content) && !manifest.session.adapterAllowlist.includes(file)) {
      if (manifest.registrar.approvedFiles.includes(file)) {
        errors.push(`${file} uses React type-only imports — registrars must use protocol/runtime types`);
      } else if (file.includes('runtime/')) {
        warnings.push(`${file} uses React type-only imports — prefer protocol/runtime types (runtime layer)`);
      }
    }
  }

  addResult({
    id: 'INV-09',
    name: 'React Boundary',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: { forbiddenZonesScanned: forbiddenZones.length },
  });
}

// ---------------------------------------------------------------------------
// 10. Documentation Drift
// ---------------------------------------------------------------------------
function checkDocumentationDrift(manifest: ArchitectureManifest): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  const actualGrandfathered = GRANDFATHERED_DIRECT_SOCKET_ON.length;
  const actualRegistrars = APPROVED_SOCKET_REGISTRAR_FILES.length;

  if (manifest.socketRegistry.grandfatheredDirectSocketOn !== 0) {
    errors.push('Manifest must declare grandfatheredDirectSocketOn: 0 (Phase S zero-tolerance)');
  }
  if (actualGrandfathered !== 0) {
    errors.push(
      `Grandfather list must be empty — found ${actualGrandfathered} entries in GRANDFATHERED_DIRECT_SOCKET_ON`,
    );
  }
  if (actualGrandfathered !== manifest.socketRegistry.grandfatheredDirectSocketOn) {
    errors.push(
      `Manifest grandfathered count ${manifest.socketRegistry.grandfatheredDirectSocketOn} !== source ${actualGrandfathered} — update docs/architecture/architecture-manifest.json`,
    );
  }
  if (actualRegistrars !== manifest.socketRegistry.approvedRegistrarFiles) {
    errors.push(
      `Manifest approved registrar count ${manifest.socketRegistry.approvedRegistrarFiles} !== source ${actualRegistrars}`,
    );
  }

  for (const docPath of manifest.documentation.canonicalReports) {
    const absolute = path.join(REPO_ROOT, docPath);
    if (!fs.existsSync(absolute)) {
      errors.push(`Canonical report missing: ${docPath}`);
      continue;
    }
    const content = fs.readFileSync(absolute, 'utf8');
    for (const stale of manifest.documentation.stalePatterns) {
      if (content.includes(stale)) {
        errors.push(`Stale architecture claim "${stale}" found in ${docPath}`);
      }
    }
  }

  addResult({
    id: 'INV-10',
    name: 'Documentation Drift',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: {
      grandfatheredDirectSocketOn: actualGrandfathered,
      approvedRegistrarFiles: actualRegistrars,
      canonicalReports: manifest.documentation.canonicalReports.length,
    },
  });
}

// ---------------------------------------------------------------------------
// Aggregate: dep-cruiser (existing CI boundaries)
// ---------------------------------------------------------------------------
function checkDependencyCruiser(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  const commands = [
    { label: 'multiplayer-arch', cmd: 'npx depcruise src/multiplayer --config .dependency-cruiser.multiplayer-arch.json --output-type err' },
    { label: 'multiplayer-cycles', cmd: 'npx depcruise src/multiplayer --config .dependency-cruiser.multiplayer-cycles.json --output-type err' },
  ];

  for (const { label, cmd } of commands) {
    try {
      execSync(cmd, { cwd: CLIENT_ROOT, stdio: 'pipe', encoding: 'utf8' });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string };
      errors.push(`depcruise ${label} failed`);
      const output = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim();
      if (output) {
        errors.push(output.split('\n').slice(0, 5).join(' | '));
      }
    }
  }

  addResult({
    id: 'INV-06b',
    name: 'Dependency Cruiser Boundaries',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
  });
}

// ---------------------------------------------------------------------------
// 11. Server Socket Registrar Boundary
// ---------------------------------------------------------------------------
function checkServerSocketRegistrarBoundary(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const registrarPattern = /register[\w]*Handlers\.ts$/;
  const grandfather = new Set(SERVER_SOCKET_ON_GRANDFATHER);

  const serverFiles = walkTsFiles(SERVER_SRC)
    .map((abs) => path.relative(SERVER_SRC, abs).split(path.sep).join('/'))
    .filter((f) => !/\.test\.ts$/.test(f));

  let violatingFiles = 0;
  for (const file of serverFiles) {
    if (registrarPattern.test(file) || grandfather.has(file)) continue;
    const content = fs.readFileSync(path.join(SERVER_SRC, file), 'utf8');
    if (/\bsocket\.on\s*\(/.test(content)) {
      violatingFiles += 1;
      errors.push(
        `server/src/${file} calls socket.on() outside an approved register*Handlers.ts registrar or the frozen grandfather list`,
      );
    }
  }

  addResult({
    id: 'INV-11',
    name: 'Server Socket Registrar Boundary',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: {
      serverFilesScanned: serverFiles.length,
      grandfatheredFiles: grandfather.size,
      violatingFiles,
    },
  });
}

// ---------------------------------------------------------------------------
// 12. No Backup Files
// ---------------------------------------------------------------------------
function checkNoBackupFiles(): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  let output = '';
  try {
    output = execSync(
      "find . -iname '*.bak*' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.worktrees/*' -not -path '*/.claude/*' -not -path '*/dist/*'",
      { cwd: REPO_ROOT, stdio: 'pipe', encoding: 'utf8' },
    );
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    output = err.stdout ?? '';
  }

  const bakFiles = output.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const file of bakFiles) {
    errors.push(`Stray backup file found: ${file} — remove before merge`);
  }

  addResult({
    id: 'INV-12',
    name: 'No Backup Files',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: { bakFilesFound: bakFiles.length },
  });
}

// ---------------------------------------------------------------------------
// 13. Daily Fritz Score Trust (heuristic guardrail, not a proof)
// ---------------------------------------------------------------------------
// Exported so the detection heuristic can be unit-tested directly (see
// checkArchitectureInvariants.test.ts) without spawning the full script.
export const DAILY_FRITZ_VERIFIER_SIGNAL = /verif/i;
export const DAILY_FRITZ_SUSPICIOUS_BODY_ACCESS = /\breq\.body\??\.\[?['"]?\w*(score|result)\w*/i;

export function isSuspiciousDailyFritzScoreAccess(content: string): boolean {
  return (
    DAILY_FRITZ_SUSPICIOUS_BODY_ACCESS.test(content) && !DAILY_FRITZ_VERIFIER_SIGNAL.test(content)
  );
}

function checkDailyFritzScoreTrust(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const routesDir = path.join(SERVER_SRC, 'http/routes');

  const files = fs.existsSync(routesDir)
    ? fs
        .readdirSync(routesDir)
        .filter((f) => /^dailyFritz.*\.ts$/.test(f) && !/\.test\.ts$/.test(f))
    : [];

  let flaggedFiles = 0;
  for (const file of files) {
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
    if (isSuspiciousDailyFritzScoreAccess(content)) {
      flaggedFiles += 1;
      errors.push(
        `server/src/http/routes/${file} reads a client-supplied score/result field from req.body with no verifier reference in the file — this must be verified before being trusted/persisted (INV-13 hard gate)`,
      );
    }
  }

  addResult({
    id: 'INV-13',
    name: 'Daily Fritz Score Trust',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics: { dailyFritzRouteFilesScanned: files.length, flaggedFiles },
  });
}

// ---------------------------------------------------------------------------
// 14. Godfile LOC Caps
// ---------------------------------------------------------------------------
function checkLocCaps(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const metrics: Record<string, number | string | boolean> = {};

  for (const { file, cap } of LOC_CAPS) {
    const absolute = path.join(REPO_ROOT, file);
    if (!fs.existsSync(absolute)) {
      errors.push(`LOC-capped file missing: ${file}`);
      continue;
    }
    const lineCount = fs.readFileSync(absolute, 'utf8').split('\n').length;
    metrics[file] = lineCount;
    if (lineCount > cap) {
      errors.push(`${file} is ${lineCount} lines — exceeds cap of ${cap}`);
    }
  }

  addResult({
    id: 'INV-14',
    name: 'Godfile LOC Caps',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings,
    metrics,
  });
}

// ---------------------------------------------------------------------------
// 15. Guarded floating imports
// ---------------------------------------------------------------------------
function checkFloatingImports(): void {
  const errors: string[] = [];
  const files = walkTsFiles(CLIENT_SRC).filter((f) => !/\.test\.tsx?$/.test(f));

  let flaggedFiles = 0;
  for (const file of files) {
    const offenders = findUnguardedFloatingImports(fs.readFileSync(file, 'utf8'));
    if (offenders.length === 0) continue;
    flaggedFiles += 1;
    for (const offender of offenders) {
      errors.push(
        `${relativeSrcPath(file)} starts ${offender} as a floating promise with no .catch — ` +
        `a failed chunk fetch becomes an unhandled rejection (INV-15)`,
      );
    }
  }

  addResult({
    id: 'INV-15',
    name: 'Guarded Floating Imports',
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
    warnings: [],
    metrics: { clientFilesScanned: files.length, flaggedFiles },
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
function printReport(manifest: ArchitectureManifest): void {
  const passCount = results.filter((r) => r.status === 'pass').length;
  const failCount = results.filter((r) => r.status === 'fail').length;

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  Racehorse Multiplayer — Architecture Invariant Certification');
  console.log('  Phase Q — Principal Engineer Production Gate');
  console.log('══════════════════════════════════════════════════════════════\n');

  console.log('## Invariant Matrix\n');
  console.log('| ID | Invariant | Status |');
  console.log('|----|-----------|--------|');
  for (const r of results) {
    const icon = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'WARN';
    console.log(`| ${r.id} | ${r.name} | ${icon} |`);
  }

  console.log('\n## Enforcement Matrix\n');
  console.log('| Check | Mechanism | CI Script |');
  console.log('|-------|-----------|-----------|');
  const enforcement = [
    ['Runtime Ownership', 'AST scan + allowlist', 'check:architecture'],
    ['Session Purity', 'Import graph on session/', 'check:architecture'],
    ['Registrar Purity', 'Pattern scan on registrars', 'check:architecture'],
    ['Projection Purity', 'Import graph on project*.ts', 'check:architecture'],
    ['Recovery Isolation', 'Import graph on recoveryMachine', 'check:architecture'],
    ['Runtime Dependency', 'Layer import scan + depcruise', 'check:architecture + check:multiplayer-arch'],
    ['Socket Registry', 'Registry validator', 'check:socket-registry (aggregated)'],
    ['Singleton Runtime', 'Construction site audit', 'check:architecture'],
    ['React Boundary', 'Hook/value import scan', 'check:architecture'],
    ['Documentation Drift', 'Manifest vs source', 'check:architecture'],
    ['Server Socket Registrar Boundary', 'socket.on() scan + frozen grandfather list', 'check:architecture'],
    ['No Backup Files', 'repo-wide *.bak* find', 'check:architecture'],
    ['Daily Fritz Score Trust', 'req.body score/result heuristic (guardrail)', 'check:architecture'],
    ['Godfile LOC Caps', 'line count vs cap', 'check:architecture'],
  ];
  for (const [name, mech, script] of enforcement) {
    console.log(`| ${name} | ${mech} | ${script} |`);
  }

  console.log('\n## Dependency Graph (enforced direction)\n');
  console.log('```');
  console.log('runtime/ (composition root)');
  console.log('  ↓');
  console.log('controllers/ (use* hooks, joinAck, room sync)');
  console.log('  ↓');
  console.log('UI (.tsx screens, shells, providers)');
  console.log('```');

  console.log('\n## CI Graph\n');
  console.log('```');
  console.log('client-ci.yml');
  console.log('  ├─ check:deps');
  console.log('  ├─ check:multiplayer-arch');
  console.log('  ├─ check:multiplayer-cycles');
  console.log('  ├─ check:socket-registry');
  console.log('  └─ check:architecture  ← master verifier (aggregates above + purity audits)');
  console.log('```');

  if (allWarnings.length > 0) {
    console.log('\n## Warnings (non-blocking)\n');
    for (const w of allWarnings) {
      console.log(`  ⚠ ${w}`);
    }
  }

  if (allErrors.length > 0) {
    console.log('\n## Violations\n');
    for (const e of allErrors) {
      console.log(`  ✗ ${e}`);
    }
  }

  console.log('\n## Metrics\n');
  for (const r of results) {
    if (r.metrics) {
      console.log(`  ${r.id} ${r.name}:`, JSON.stringify(r.metrics));
    }
  }

  console.log('\n## Principal Engineer Certification\n');
  if (failCount === 0) {
    console.log(`  CERTIFIED — ${passCount}/${results.length} invariant checks passed.`);
    console.log('  Architecture enforcement active; regressions will fail CI before production.');
  } else {
    console.log(`  NOT CERTIFIED — ${failCount} invariant check(s) failed.`);
    process.exit(1);
  }
}

function main(): void {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Missing architecture manifest: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  const manifest = loadManifest();

  checkRuntimeOwnership(manifest);
  checkSessionPurity(manifest);
  checkRegistrarPurity(manifest);
  checkProjectionPurity(manifest);
  checkRecoveryIsolation();
  checkRuntimeDependencyDirection();
  checkSocketRegistryCompleteness();
  checkSingletonRuntime(manifest);
  checkReactBoundary(manifest);
  checkDocumentationDrift(manifest);
  checkDependencyCruiser();
  checkServerSocketRegistrarBoundary();
  checkNoBackupFiles();
  checkDailyFritzScoreTrust();
  checkLocCaps();
  checkFloatingImports();

  printReport(manifest);
}

// Only run the full check when this file is executed directly (e.g. via
// `npm run check:architecture`), not when imported by a test file that wants
// to exercise an individual check's exported helper functions.
const isDirectExecution = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === `file://${entry}` || import.meta.url === entry;
})();

if (isDirectExecution) {
  main();
}