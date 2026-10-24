// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  JOURNEY_PROGRESS_KEY,
  getJourneyProgressStorageKey,
  loadJourneyProgress,
  markJourneyNodeCompleted,
  resetJourneyProgress,
} from './journeyStorage';
import { getJourneyStorageScopeId, setJourneyStorageUser } from './journeyStorageScope';

beforeEach(() => {
  window.localStorage.clear();
  setJourneyStorageUser(null);
});

describe('journey progress storage scoping', () => {
  it('keeps the legacy un-suffixed key for guests so existing data and E2E fixtures stay valid', () => {
    expect(getJourneyProgressStorageKey()).toBe(JOURNEY_PROGRESS_KEY);
    expect(getJourneyProgressStorageKey()).toBe('rh_journey_progress_v1');
  });

  it('seeded guest progress (the E2E fixture shape) is read exactly as before', () => {
    window.localStorage.setItem(
      'rh_journey_progress_v1',
      JSON.stringify({
        version: 2,
        activeChapterId: 'ch1-fritz-trail',
        chapters: { 'ch1-fritz-trail': { layoutVersion: 2, completedNodeIds: ['ch1-n07', 'ch1-n02'], lastVisitedNodeId: 'ch1-n11', completedAt: null, completionCelebrated: false } },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    expect(loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds).toEqual(['ch1-n07', 'ch1-n02']);
  });

  it('keeps guest and each signed-in user in separate stores', () => {
    markJourneyNodeCompleted('ch1-n07'); // guest

    setJourneyStorageUser('user-a');
    expect(getJourneyStorageScopeId()).toBe('u:user-a');
    expect(loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds).toEqual([]);
    markJourneyNodeCompleted('ch1-n07');
    markJourneyNodeCompleted('ch1-n02');

    setJourneyStorageUser('user-b');
    expect(loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds).toEqual([]);

    setJourneyStorageUser('user-a');
    expect(loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds).toEqual(['ch1-n07', 'ch1-n02']);

    setJourneyStorageUser(null);
    expect(loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds).toEqual(['ch1-n07']);
  });

  it('resetting one namespace leaves the others alone', () => {
    markJourneyNodeCompleted('ch1-n07');
    setJourneyStorageUser('user-a');
    markJourneyNodeCompleted('ch1-n07');
    resetJourneyProgress();
    expect(loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds).toEqual([]);
    setJourneyStorageUser(null);
    expect(loadJourneyProgress().chapters['ch1-fritz-trail'].completedNodeIds).toEqual(['ch1-n07']);
  });

  it('with the layout stamp present, drops unknown/retired node ids without touching the rest', () => {
    window.localStorage.setItem(
      'rh_journey_progress_v1',
      JSON.stringify({
        version: 2,
        activeChapterId: 'ch1-fritz-trail',
        chapters: { 'ch1-fritz-trail': { layoutVersion: 2, completedNodeIds: ['ch1-n01', 'ch1-n03', 'ch1-n06', 'ch1-n07'], lastVisitedNodeId: 'ch1-n01', completedAt: null, completionCelebrated: false } },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const chapter = loadJourneyProgress().chapters['ch1-fritz-trail'];
    expect(chapter.completedNodeIds).toEqual(['ch1-n07']);
    expect(chapter.lastVisitedNodeId).toBeNull();
  });
});
