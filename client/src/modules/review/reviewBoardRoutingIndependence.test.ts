/**
 * Responsive board routing is presentation. The review LOGIC (position reconstruction inputs, correlation, accounting,
 * classification, presentation record, accuracy) must not depend on it: no module reachable from those entry points may import
 * the board layout / routing / camera code. A transitive import-graph scan, so an indirect dependency is caught too.
 * (GameReviewer.tsx renders the Board for display; it is deliberately not an entry point here.)
 *
 * Sources are read with Vite raw glob imports (no Node `fs`), so the scan runs the same in any test environment.
 */
import { describe, expect, it } from 'vitest';
import reviewContractsSource from '../../../../packages/game-core/src/reviewContracts.ts?raw';
import reviewEngineIndexSource from '../../../../packages/review-engine/src/index.ts?raw';

const sources = import.meta.glob('../../**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const ENTRY_POINTS = [
  'analyzer/moveAnalyzer.ts',
  'analyzer/classifyHeuristicResult.ts',
  'analyzer/gameAccuracyModel.ts',
  'analyzer/reviewPresentationRecord.ts',
  'analyzer/handSegmentation.ts',
  'modules/review/correlateSnapshotsToMoveLog.ts',
  'modules/review/reviewDecisionAccounting.ts',
  'modules/review/captureReviewSnapshotAtDecision.ts',
  'modules/review/ReviewSnapshotRecorder.ts',
];
const FORBIDDEN = /(^|\/)components\/board\/|(^|\/)components\/Board\.tsx$|boardRouting|boardLayout|useBoardRenderLayout|useBoardContainerHeight|useBoardCamera/;

// Keys are relative to this file ("../../analyzer/moveAnalyzer.ts"); normalise everything to "src/<path>".
const toSrcPath = (globKey: string): string => globKey.replace(/^\.\.\/\.\.\//, 'src/');
const byPath = new Map<string, string>(Object.entries(sources).map(([key, text]) => [toSrcPath(key), text]));

function normalise(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function resolveImport(from: string, spec: string): string | null {
  const dir = from.slice(0, from.lastIndexOf('/'));
  const base = normalise(`${dir}/${spec}`);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (byPath.has(candidate)) return candidate;
  }
  return null;
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [`src/${entry}`];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = byPath.get(file);
    if (text === undefined) continue;
    // Runtime dependencies only: `import type` / `export type` statements are erased and cannot carry behaviour.
    for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)(\s+type\b)?\s[^'";]*?from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
      if (match[1]) continue;
      const next = resolveImport(file, (match[2] ?? match[3])!);
      if (next && !seen.has(next)) stack.push(next);
    }
  }
  return seen;
}

describe('review logic does not depend on board routing', () => {
  it('the scan can see the sources (it would be vacuous otherwise)', () => {
    expect(byPath.has('src/analyzer/moveAnalyzer.ts')).toBe(true);
    expect(byPath.has('src/components/board/boardRouting.ts')).toBe(true);
    // and it does follow real imports: GameReviewer renders the board
    expect([...reachable('analyzer/GameReviewer.tsx')].some((f) => FORBIDDEN.test(f))).toBe(true);
  });

  for (const entry of ENTRY_POINTS) {
    it(`${entry}: nothing reachable imports board layout, routing or camera code`, () => {
      const files = [...reachable(entry)];
      expect(files.length, 'the scan found the entry module').toBeGreaterThanOrEqual(1);
      const offenders = files.filter((f) => FORBIDDEN.test(f));
      expect(offenders, `${entry} reaches board code through: ${offenders.join(', ')}`).toEqual([]);
    });
  }

  it('the engine-side review packages never reference client board code', () => {
    for (const text of [reviewEngineIndexSource, reviewContractsSource]) {
      expect(text).not.toMatch(/components\/board|boardLayout|boardRouting/);
    }
  });
});
