import {
  GUIDED_MATCH_CANONICAL_VERSION,
  type GuidedMatchLesson,
} from './guidedMatchTypes';

/**
 * Phase 1 scaffold only.
 *
 * This file establishes the durable in-repo source location for the future
 * canonical Guided Match lesson. It is intentionally not wired into runtime
 * playback yet, and it is intentionally incomplete until the recorder exports
 * the real authored game.
 */
export const canonicalGuidedMatchStandardV1: GuidedMatchLesson = {
  version: GUIDED_MATCH_CANONICAL_VERSION,
  lessonId: 'guided-match-standard-v1',
  title: 'Guided Match · First to 60',
  opponent: 'standard-fritz',
  dealSize: 7,
  targetScore: 60,
  rootSeed: 'guided-match-standard-v1',
  createdAt: '2026-05-19T00:00:00.000Z',
  updatedAt: '2026-05-19T00:00:00.000Z',
  initialMatchSnapshot: '',
  finalMatchSnapshot: '',
  events: [],
};

