import { analyzeMoveLogDeferred } from '../analyzer/moveAnalyzer.ts';
import { selectPivotalTurnsFromAnalysis } from '../training/pivotalReview/pivotalTurnSelector.ts';
import { usePostGamePivotalReview } from './usePostGamePivotalReview.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[usePostGamePivotalReview.behaviorTests] ${msg}`);
}

function testHookExported(): void {
  assert(typeof usePostGamePivotalReview === 'function', 'usePostGamePivotalReview is exported');
}

function testDeferredAnalysisImport(): void {
  assert(typeof analyzeMoveLogDeferred === 'function', 'analyzeMoveLogDeferred import is a function');
}

function testPivotalSelectionImport(): void {
  assert(typeof selectPivotalTurnsFromAnalysis === 'function', 'selectPivotalTurnsFromAnalysis import is a function');
}

function testHookOwnsDocumentedConcerns(): void {
  const source = usePostGamePivotalReview.toString();
  assert(source.includes('analyzeMoveLogDeferred'), 'hook uses deferred move log analysis');
  assert(source.includes('selectPivotalTurnsFromAnalysis'), 'hook derives pivotal selection from analysis');
  assert(source.includes('setAnalyzerOpen'), 'hook owns game reviewer open state');
  assert(source.includes('setPostGameReviewDismissed'), 'hook owns post-game review prompt dismissal');
}

function run(): void {
  testHookExported();
  testDeferredAnalysisImport();
  testPivotalSelectionImport();
  testHookOwnsDocumentedConcerns();
  console.log('usePostGamePivotalReview.behaviorTests: all passed');
}

run();
