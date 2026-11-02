import { beforeEach, describe, expect, it } from 'vitest';
import { JOURNEY_CHAPTER_ONE_LAYOUT_VERSION, getJourneyChapterById } from './journeyChapters';
import {
  applySyncedToLocal,
  mergeSynced,
  readSyncedProgress,
  syncedEqual,
  toSyncedProgress,
  type SyncedChapter,
  type SyncedProgress,
} from './journeyProgressSync';
import { loadJourneyProgress, markJourneyNodeCompleted, saveJourneyProgress } from './journeyStorage';
import { setJourneyStorageUser } from './journeyStorageScope';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';

const chapter = (ids: string[], extra: Partial<SyncedChapter> = {}): SyncedChapter => ({
  completedNodeIds: [...ids].sort(),
  completedAt: null,
  completionCelebrated: false,
  ...extra,
});
const synced = (chapters: Record<string, SyncedChapter>): SyncedProgress => ({ chapters });

/**
 * The same vectors as server/src/playerProgress.test.ts ("merge vectors shared with the client"). The server cannot import this file, so the merge rule exists
 * twice; running identical vectors through both is what keeps the two from drifting apart.
 */
const SHARED_VECTORS: Array<{ name: string; a: SyncedProgress; b: SyncedProgress; expected: SyncedProgress }> = [
  {
    name: 'union, earliest completion, celebrated OR',
    a: synced({ c1: chapter(['n1', 'n2'], { completedAt: '2026-11-02T12:00:00.000Z' }) }),
    b: synced({ c1: chapter(['n2', 'n3'], { completedAt: '2026-11-01T09:00:00.000Z', completionCelebrated: true }) }),
    expected: synced({ c1: chapter(['n1', 'n2', 'n3'], { completedAt: '2026-11-01T09:00:00.000Z', completionCelebrated: true }) }),
  },
  {
    name: 'chapters only one side has are kept',
    a: synced({ c1: chapter(['n1']) }),
    b: synced({ c2: chapter(['x1']) }),
    expected: synced({ c1: chapter(['n1']), c2: chapter(['x1']) }),
  },
  {
    name: 'a higher layout replaces a lower one wholesale',
    a: synced({ c1: chapter(['n1', 'n2', 'n3']) }),
    b: synced({ c1: chapter(['n1'], { layoutVersion: 2 }) }),
    expected: synced({ c1: chapter(['n1'], { layoutVersion: 2 }) }),
  },
  {
    name: 'a missing layout counts as 1',
    a: synced({ c1: chapter(['n1']) }),
    b: synced({ c1: chapter(['n2'], { layoutVersion: 1 }) }),
    expected: synced({ c1: chapter(['n1', 'n2'], { layoutVersion: 1 }) }),
  },
  {
    name: 'identical copies merge to themselves',
    a: synced({ c1: chapter(['n1', 'n2'], { layoutVersion: 2 }) }),
    b: synced({ c1: chapter(['n1', 'n2'], { layoutVersion: 2 }) }),
    expected: synced({ c1: chapter(['n1', 'n2'], { layoutVersion: 2 }) }),
  },
];

describe('mergeSynced (the rule shared with the server)', () => {
  it.each(SHARED_VECTORS)('$name', ({ a, b, expected }) => {
    expect(mergeSynced(a, b)).toEqual(expected);
    expect(mergeSynced(b, a)).toEqual(expected);
  });
});

const ch1 = getJourneyChapterById(JOURNEY_CHAPTER_1_ID)!;
const ids = ch1.nodes.map((node) => node.id);

beforeEach(() => {
  window.localStorage.clear();
  setJourneyStorageUser('user-a');
});

describe('toSyncedProgress', () => {
  it('sends only chapters with something completed, ids sorted, and not the per-device fields', () => {
    expect(toSyncedProgress(loadJourneyProgress())).toEqual({ chapters: {} });
    markJourneyNodeCompleted(ids[0]!);
    const out = toSyncedProgress(loadJourneyProgress());
    expect(out.chapters[JOURNEY_CHAPTER_1_ID]).toEqual({
      completedNodeIds: [ids[0]],
      layoutVersion: JOURNEY_CHAPTER_ONE_LAYOUT_VERSION,
      completedAt: null,
      completionCelebrated: false,
    });
    expect(JSON.stringify(out)).not.toContain('lastVisitedNodeId');
    expect(JSON.stringify(out)).not.toContain('activeChapterId');
  });

  it('leaves out ids the server would refuse, so one odd id cannot make every request fail', () => {
    const local = loadJourneyProgress();
    const odd = { ...local, chapters: { ...local.chapters, [JOURNEY_CHAPTER_1_ID]: { ...local.chapters[JOURNEY_CHAPTER_1_ID]!, completedNodeIds: [ids[0]!, 'has a space'] } } };
    expect(toSyncedProgress(odd).chapters[JOURNEY_CHAPTER_1_ID]!.completedNodeIds).toEqual([ids[0]]);
  });
});

describe('readSyncedProgress', () => {
  it('reads what the server sent defensively', () => {
    expect(readSyncedProgress(null)).toEqual({ chapters: {} });
    expect(readSyncedProgress('x')).toEqual({ chapters: {} });
    expect(readSyncedProgress({ chapters: { c1: { completedNodeIds: ['n2', 'n1', 3], completedAt: 'nope', layoutVersion: 0, completionCelebrated: 'yes' }, c2: 'junk', c3: {} } })).toEqual({
      chapters: { c1: { completedNodeIds: ['n1', 'n2'], completedAt: null, completionCelebrated: false } },
    });
  });
});

describe('applySyncedToLocal', () => {
  const remoteWith = (completed: string[], extra: Partial<SyncedChapter> = {}): SyncedProgress =>
    synced({ [JOURNEY_CHAPTER_1_ID]: chapter(completed, { layoutVersion: JOURNEY_CHAPTER_ONE_LAYOUT_VERSION, ...extra }) });

  it('adds the stages another device completed, and keeps the ones this one has', () => {
    markJourneyNodeCompleted(ids[0]!);
    const next = applySyncedToLocal(loadJourneyProgress(), remoteWith([ids[1]!]));
    expect(next!.chapters[JOURNEY_CHAPTER_1_ID]!.completedNodeIds).toEqual([ids[0], ids[1]]);
  });

  it('returns null when the incoming copy adds nothing', () => {
    markJourneyNodeCompleted(ids[0]!);
    expect(applySyncedToLocal(loadJourneyProgress(), remoteWith([ids[0]!]))).toBeNull();
    expect(applySyncedToLocal(loadJourneyProgress(), { chapters: {} })).toBeNull();
  });

  it('never removes a stage: an empty or smaller remote leaves local as it is', () => {
    markJourneyNodeCompleted(ids[0]!);
    expect(applySyncedToLocal(loadJourneyProgress(), remoteWith([]))).toBeNull();
  });

  it('drops stage ids this build does not define, and chapters it does not know', () => {
    const next = applySyncedToLocal(loadJourneyProgress(), synced({
      [JOURNEY_CHAPTER_1_ID]: chapter([ids[0]!, 'not-a-real-stage'], { layoutVersion: JOURNEY_CHAPTER_ONE_LAYOUT_VERSION }),
      'chX-unknown': chapter(['n1']),
    }));
    expect(next!.chapters[JOURNEY_CHAPTER_1_ID]!.completedNodeIds).toEqual([ids[0]]);
    expect(next!.chapters['chX-unknown']).toBeUndefined();
  });

  it('ignores a copy recorded against an OLDER layout (its stage ids mean something else now)', () => {
    markJourneyNodeCompleted(ids[0]!);
    expect(applySyncedToLocal(loadJourneyProgress(), synced({ [JOURNEY_CHAPTER_1_ID]: chapter([ids[1]!, ids[2]!]) }))).toBeNull();
  });

  it('ignores a copy recorded against a NEWER layout than this build understands', () => {
    markJourneyNodeCompleted(ids[0]!);
    expect(applySyncedToLocal(loadJourneyProgress(), remoteWith([ids[1]!], { layoutVersion: JOURNEY_CHAPTER_ONE_LAYOUT_VERSION + 1 }))).toBeNull();
  });

  it('stamps a chapter complete, with the earliest time and the celebrated flag, only when every stage is done', () => {
    const partial = applySyncedToLocal(loadJourneyProgress(), remoteWith(ids.slice(0, -1), { completedAt: '2026-11-01T09:00:00.000Z', completionCelebrated: true }));
    expect(partial!.chapters[JOURNEY_CHAPTER_1_ID]!.completedAt).toBeNull();
    expect(partial!.chapters[JOURNEY_CHAPTER_1_ID]!.completionCelebrated).toBe(false);

    const full = applySyncedToLocal(loadJourneyProgress(), remoteWith(ids, { completedAt: '2026-11-01T09:00:00.000Z', completionCelebrated: true }));
    expect(full!.chapters[JOURNEY_CHAPTER_1_ID]!.completedAt).toBe('2026-11-01T09:00:00.000Z');
    expect(full!.chapters[JOURNEY_CHAPTER_1_ID]!.completionCelebrated).toBe(true);
  });

  it('does not touch this device\'s last-visited stage or active chapter', () => {
    markJourneyNodeCompleted(ids[0]!);
    const before = loadJourneyProgress();
    const next = applySyncedToLocal(before, remoteWith([ids[1]!]))!;
    expect(next.activeChapterId).toBe(before.activeChapterId);
    expect(next.chapters[JOURNEY_CHAPTER_1_ID]!.lastVisitedNodeId).toBe(before.chapters[JOURNEY_CHAPTER_1_ID]!.lastVisitedNodeId);
  });

  it('what is applied and saved reads back the same, and projects to what the server holds', () => {
    const remote = remoteWith([ids[0]!, ids[1]!]);
    saveJourneyProgress(applySyncedToLocal(loadJourneyProgress(), remote)!);
    expect(syncedEqual(toSyncedProgress(loadJourneyProgress()), remote)).toBe(true);
  });
});
