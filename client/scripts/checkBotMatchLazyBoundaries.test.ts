import { describe, expect, it } from 'vitest';
import {
  chunkHasForbiddenStaticImport,
  isAnalyzerChunkRequest,
  isForbiddenRuntimeModule,
  isLessonV2ChunkRequest,
} from './checkBotMatchLazyBoundaries.mjs';

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

  it('matches lesson-v2 and analyzer network URLs for dev and prod', () => {
    expect(isLessonV2ChunkRequest('http://localhost:5173/src/learn/lessonV2.ts')).toBe(true);
    expect(isLessonV2ChunkRequest('http://localhost:5173/assets/lesson-v2-ABC.js')).toBe(true);
    expect(isLessonV2ChunkRequest('http://localhost:5173/src/modules/match/bootstrap/lessonV2LazyRegistry.ts')).toBe(false);

    expect(isAnalyzerChunkRequest('http://localhost:5173/assets/analyzer-BBq.js')).toBe(true);
    expect(isAnalyzerChunkRequest('http://localhost:5173/src/analyzer/moveAnalyzer.ts')).toBe(true);
    expect(isAnalyzerChunkRequest('http://localhost:5173/assets/game-reviewer-Dn1.js')).toBe(false);
  });
});