import { describe, expect, it } from 'vitest';

// The app tsconfig has no node types, and a literal `node:fs` import breaks `tsc -b` (and so the production build);
// load node's fs/path through non-literal dynamic imports tsc does not resolve (same idiom as nativeHomeFit.test.ts).
const nodeFsId = 'node:fs';
const nodePathId = 'node:path';
const fs = (await import(/* @vite-ignore */ nodeFsId)) as {
  existsSync: (file: string) => boolean;
  statSync: (file: string) => { isFile: () => boolean };
  readFileSync: (file: string, encoding: 'utf8') => string;
};
const path = (await import(/* @vite-ignore */ nodePathId)) as {
  resolve: (...parts: string[]) => string;
  dirname: (file: string) => string;
  join: (...parts: string[]) => string;
  relative: (from: string, to: string) => string;
};

/**
 * The ordinary match routes (`AppRoutes` → `soloPlayRoutes` → `journeyMatchOutcome`) are in the initial bundle.
 * Journey lesson content, the lesson controller, the content registry (which validates itself when imported) and
 * sprint data belong on the lazy Journey screen path. This walks STATIC import/export-from edges only (dynamic
 * `import()` / `React.lazy` are lazy by definition) and fails if a forbidden module becomes reachable.
 *
 * It is a source-graph check, like the source mode of `check:bot-match-lazy`; Rollup chunk assignment is covered
 * by running that guard with `--dist` against a real build.
 */

const SRC = path.resolve('src'); // vitest runs from client/
const STATIC_EDGE = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/gm;

function resolveModule(from: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), base.replace(/\.js$/, '.ts')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function staticClosure(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [path.join(SRC, entry)];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(STATIC_EDGE)) {
      const resolved = resolveModule(file, match[1]);
      if (resolved) stack.push(resolved);
    }
  }
  return [...seen].map((file) => path.relative(SRC, file));
}

const FORBIDDEN = [
  /journey\/journeyContentResolver\./,
  /journey\/journeyLessonController\./,
  /journey\/journeyPuzzleSprints\./,
  /journey\/journeyStageCompletion\./,
  /journey\/journeyCompletionRecovery\./,
  /journey\/journeyAuthoredLessonRegistry\./,
  /journey\/lessons\//,
  /journey\/lessonHost\//,
];
const forbiddenIn = (files: string[]) => files.filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));

describe('Journey module boundary: ordinary match routing stays free of lesson and content modules', () => {
  it('the walker is not vacuous: it follows real edges, and recovery (the lazy side) does reach the content', () => {
    const match = staticClosure('journey/journeyMatchOutcome.ts');
    expect(match).toContain('journey/journeyCompletionCore.ts');
    expect(match).toContain('journey/journeyStorage.ts');
    const recovery = staticClosure('journey/journeyCompletionRecovery.ts');
    expect(forbiddenIn(recovery).length).toBeGreaterThan(10);
    expect(recovery).toContain('journey/journeyContentResolver.ts');
  });

  it('journeyMatchOutcome reaches none of them', () => {
    expect(forbiddenIn(staticClosure('journey/journeyMatchOutcome.ts'))).toEqual([]);
  });

  it('the shared completion core reaches none of them', () => {
    expect(forbiddenIn(staticClosure('journey/journeyCompletionCore.ts'))).toEqual([]);
  });

  it('the live-match challenge lifecycle hook reaches none of them', () => {
    expect(forbiddenIn(staticClosure('journey/useJourneyChallengeLifecycle.ts'))).toEqual([]);
  });

  it('soloPlayRoutes — the statically imported route module — reaches none of them', () => {
    expect(forbiddenIn(staticClosure('routes/soloPlayRoutes.tsx'))).toEqual([]);
  });

  it('the lazy Journey progress hook is where recovery is wired', () => {
    expect(staticClosure('journey/useJourneyProgress.ts')).toContain('journey/journeyCompletionRecovery.ts');
  });
});
