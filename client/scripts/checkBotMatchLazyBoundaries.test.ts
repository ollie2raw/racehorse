import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chunkHasForbiddenStaticImport,
  isAnalyzerChunkRequest,
  isForbiddenRuntimeModule,
  isLessonV2ChunkRequest,
  newestMtime,
} from './checkBotMatchLazyBoundaries.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

describe('checkBotMatchLazyBoundaries helpers', () => {
  it('detects forbidden runtime module paths', () => {
    expect(isForbiddenRuntimeModule('/app/src/learn/lessonV2.ts')).toBe('lesson-v2');
    expect(isForbiddenRuntimeModule('/app/src/analyzer/moveAnalyzer.ts')).toBe('analyzer');
    expect(isForbiddenRuntimeModule('/app/src/modules/match/bootstrap/lessonV2LazyRegistry.ts')).toBeNull();
  });

  it('flags static dist imports but allows lazy metadata', () => {
    const eager = 'import{a}from"./analyzer-BBq.js";import{b}from"./bot-engine.js";';
    expect(chunkHasForbiddenStaticImport(eager)).toEqual(['analyzer']);

    const lazy = 'const d=(i,m,d=(m.f||(m.f=["assets/analyzer-BBq.js"])))=>i.map(i=>d[i]);import("./game-reviewer.js");';
    expect(chunkHasForbiddenStaticImport(lazy)).toEqual([]);
  });

  it('newestMtime: 0 for a missing dir, positive for a real one — the stale-dist guard', () => {
    expect(newestMtime(path.join(scriptsDir, 'does-not-exist'))).toBe(0);
    expect(newestMtime(scriptsDir)).toBeGreaterThan(0);
  });

  it('matches lesson-v2 and analyzer network URLs for dev and prod', () => {
    expect(isLessonV2ChunkRequest('http://localhost:5173/src/learn/lessonV2.ts')).toBe(true);
    expect(isLessonV2ChunkRequest('http://localhost:5173/assets/lesson-v2-ABC.js')).toBe(true);
    expect(isLessonV2ChunkRequest('http://localhost:5173/src/modules/match/bootstrap/lessonV2LazyRegistry.ts')).toBe(false);

    expect(isAnalyzerChunkRequest('http://localhost:5173/assets/analyzer-BBq.js')).toBe(true);
    expect(isAnalyzerChunkRequest('http://localhost:5173/src/analyzer/moveAnalyzer.ts')).toBe(true);
    expect(isAnalyzerChunkRequest('http://localhost:5173/assets/game-reviewer-Dn1.js')).toBe(false);
  });
});