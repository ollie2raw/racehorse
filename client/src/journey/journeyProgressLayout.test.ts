// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { JOURNEY_CHAPTER_ONE_LAYOUT_VERSION, getJourneyChapterById, isChapterFullyComplete } from './journeyChapters';
import { JOURNEY_ATTEMPTS_KEY } from './journeyAttempts';
import {
  getJourneyNodeStatus,
  getJourneyProgressStorageKey,
  loadJourneyProgress,
  markJourneyNodeCompleted,
  saveJourneyProgress,
  shouldCelebrateChapterCompletion,
} from './journeyStorage';
import { setJourneyStorageUser } from './journeyStorageScope';
import type { JourneyProgress } from './journeyTypes';

const CH1 = 'ch1-fritz-trail';
const CH2 = 'ch2-high-line';
const OLD_TEN_NODE_IDS = ['ch1-n01', 'ch1-n02', 'ch1-n03', 'ch1-n04', 'ch1-n05', 'ch1-n06', 'ch1-n07', 'ch1-n08', 'ch1-n09', 'ch1-n10'];

type RawChapter = Record<string, unknown>;
function seed(chapters: Record<string, RawChapter>, extra: Record<string, unknown> = {}, version = 2) {
  window.localStorage.setItem(
    getJourneyProgressStorageKey(),
    JSON.stringify({ version, activeChapterId: CH1, chapters, updatedAt: '2026-01-01T00:00:00.000Z', ...extra }),
  );
}
const oldChapter = (over: RawChapter = {}): RawChapter => ({
  completedNodeIds: ['ch1-n01', 'ch1-n02', 'ch1-n03', 'ch1-n04', 'ch1-n05'],
  lastVisitedNodeId: 'ch1-n05',
  completedAt: null,
  completionCelebrated: false,
  ...over,
});
const raw = () => window.localStorage.getItem(getJourneyProgressStorageKey());
const stored = () => JSON.parse(raw()!).chapters[CH1];
const chapterOne = (progress: JourneyProgress) => progress.chapters[CH1];
const dotsTable = () => getJourneyChapterById(CH1)!.nodes.find((node) => node.id === 'ch1-n02')!;

beforeEach(() => {
  window.localStorage.clear();
  setJourneyStorageUser(null);
});

describe('Chapter One layout version', () => {
  it('is 2 — the nine-stage layout; the original ten-node layout was never stamped', () => {
    expect(JOURNEY_CHAPTER_ONE_LAYOUT_VERSION).toBe(2);
  });

  it('survives the sanitizer: a stamped entry round-trips through save and load', () => {
    markJourneyNodeCompleted('ch1-n07');
    expect(stored().layoutVersion).toBe(2);
    expect(chapterOne(loadJourneyProgress()).layoutVersion).toBe(2);
    expect(stored().completedNodeIds).toEqual(['ch1-n07']);
  });

  it('a fresh player is stamped on their first save and never reset afterwards', () => {
    expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual([]);
    markJourneyNodeCompleted('ch1-n07');
    markJourneyNodeCompleted('ch1-n02');
    expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual(['ch1-n07', 'ch1-n02']);
  });
});

describe('old-layout progress is invalidated, for Chapter One only', () => {
  it('old PARTIAL progress: an old completion for ch1-n02 is not Dot\'s Table, and nothing else carries over', () => {
    seed({ [CH1]: oldChapter() });
    const progress = loadJourneyProgress();
    expect(chapterOne(progress)).toEqual({
      layoutVersion: 2, completedNodeIds: [], lastVisitedNodeId: null, completedAt: null, completionCelebrated: false,
    });
    // The reused ID: ch1-n02 was "First Score" and was completed; it must NOT read as Dot's Table completed.
    expect(getJourneyNodeStatus(dotsTable(), progress)).toBe('locked');
    const gate = getJourneyChapterById(CH1)!.nodes.find((node) => node.id === 'ch1-n07')!;
    expect(getJourneyNodeStatus(gate, progress)).toBe('current');
    for (const id of ['ch1-n04', 'ch1-n05', 'ch1-n08', 'ch1-n09', 'ch1-n10']) {
      const node = getJourneyChapterById(CH1)!.nodes.find((entry) => entry.id === id)!;
      expect(getJourneyNodeStatus(node, progress)).not.toBe('completed');
    }
  });

  it('old FULLY-COMPLETE progress: the chapter-complete timestamp and celebration cannot survive as proof of the new sequence', () => {
    seed({ [CH1]: oldChapter({ completedNodeIds: OLD_TEN_NODE_IDS, lastVisitedNodeId: 'ch1-n10', completedAt: '2026-02-02T00:00:00.000Z', completionCelebrated: true }) });
    const progress = loadJourneyProgress();
    expect(chapterOne(progress).completedAt).toBeNull();
    expect(chapterOne(progress).completionCelebrated).toBe(false);
    expect(chapterOne(progress).completedNodeIds).toEqual([]);
    expect(isChapterFullyComplete(CH1, progress)).toBe(false);
    expect(shouldCelebrateChapterCompletion(CH1, progress)).toBe(false);
    const boss = getJourneyChapterById(CH1)!.nodes.find((node) => node.id === 'ch1-n10')!;
    expect(getJourneyNodeStatus(boss, progress)).toBe('locked'); // Handicap Stakes was never played
  });

  it('an explicit layoutVersion 1 is treated the same as an unstamped entry', () => {
    seed({ [CH1]: oldChapter({ layoutVersion: 1 }) });
    expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual([]);
    expect(stored().layoutVersion).toBe(2);
  });

  it.each([['a string', '2'], ['zero', 0], ['a fraction', 1.5], ['negative', -1], ['null', null]])(
    'an invalid layoutVersion (%s) is ignored and treated as the old layout',
    (_label, bad) => {
      seed({ [CH1]: oldChapter({ layoutVersion: bad }) });
      expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual([]);
    },
  );

  it('a v1-shaped save (version 1, single chapter) is upgraded to v2 and is also treated as the old layout', () => {
    window.localStorage.setItem(
      getJourneyProgressStorageKey(),
      JSON.stringify({ version: 1, chapterId: CH1, completedNodeIds: ['ch1-n01', 'ch1-n02'], lastVisitedNodeId: 'ch1-n02', updatedAt: '2026-01-01T00:00:00.000Z' }),
    );
    const progress = loadJourneyProgress();
    expect(chapterOne(progress)).toMatchObject({ layoutVersion: 2, completedNodeIds: [], completedAt: null });
    expect(JSON.parse(raw()!).version).toBe(2);
  });

  it('persists the invalidation, so it is durable and not recomputed from the stale data', () => {
    seed({ [CH1]: oldChapter() });
    loadJourneyProgress();
    expect(stored()).toMatchObject({ layoutVersion: 2, completedNodeIds: [], completedAt: null, completionCelebrated: false });
  });
});

describe('the migration is idempotent and non-destructive afterwards', () => {
  it('already-migrated progress is left exactly as it is', () => {
    seed({ [CH1]: { layoutVersion: 2, completedNodeIds: ['ch1-n07', 'ch1-n02'], lastVisitedNodeId: 'ch1-n02', completedAt: null, completionCelebrated: false } });
    const before = raw();
    const progress = loadJourneyProgress();
    expect(chapterOne(progress).completedNodeIds).toEqual(['ch1-n07', 'ch1-n02']);
    expect(chapterOne(progress).lastVisitedNodeId).toBe('ch1-n02');
    expect(raw()).toBe(before); // not even rewritten
  });

  it('repeated loads never keep resetting: only the first load of old data writes, and progress made afterwards sticks', () => {
    seed({ [CH1]: oldChapter() });
    loadJourneyProgress(); // migrates and persists
    const afterMigration = raw();
    for (let index = 0; index < 5; index += 1) loadJourneyProgress();
    expect(raw()).toBe(afterMigration); // no rewrites, no loop

    markJourneyNodeCompleted('ch1-n07'); // real progress under the new layout
    markJourneyNodeCompleted('ch1-n02');
    for (let index = 0; index < 3; index += 1) {
      expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual(['ch1-n07', 'ch1-n02']);
    }
  });

  it('progress stamped by a NEWER layout is left untouched rather than reset', () => {
    seed({ [CH1]: { layoutVersion: 3, completedNodeIds: ['ch1-n07'], lastVisitedNodeId: null, completedAt: null, completionCelebrated: false } });
    const before = raw();
    expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual(['ch1-n07']);
    expect(chapterOne(loadJourneyProgress()).layoutVersion).toBe(3);
    expect(raw()).toBe(before);
  });

  it('saving never resets: unstamped progress handed to save is stamped with its completions intact', () => {
    const progress: JourneyProgress = {
      version: 2,
      activeChapterId: CH1,
      chapters: { [CH1]: { completedNodeIds: ['ch1-n07', 'ch1-n02'], lastVisitedNodeId: 'ch1-n02', completedAt: null, completionCelebrated: false } },
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const saved = saveJourneyProgress(progress);
    expect(chapterOne(saved)).toMatchObject({ layoutVersion: 2, completedNodeIds: ['ch1-n07', 'ch1-n02'] });
    expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual(['ch1-n07', 'ch1-n02']);
  });
});

describe('what is preserved', () => {
  it('leaves other chapters, activeChapterId, the attempt log and unrelated storage exactly as they were', () => {
    const attemptsKey = `${JOURNEY_ATTEMPTS_KEY}:guest:a:jat_old`;
    const attemptsJson = JSON.stringify({ attemptId: 'jat_old', nodeId: 'ch1-n02', kind: 'match', outcome: 'won', startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:05:00.000Z', ownerId: null, heartbeatAt: null, detail: { rival: 'old' } });
    window.localStorage.setItem(attemptsKey, attemptsJson);
    window.localStorage.setItem('rh_some_other_setting', '{"keep":true}');
    seed(
      {
        [CH1]: oldChapter({ completedNodeIds: OLD_TEN_NODE_IDS, completedAt: '2026-02-02T00:00:00.000Z', completionCelebrated: true }),
        [CH2]: { completedNodeIds: ['ch2-n01', 'ch2-n02'], lastVisitedNodeId: 'ch2-n02', completedAt: null, completionCelebrated: false },
      },
    );

    const progress = loadJourneyProgress();

    expect(progress.chapters[CH2]).toEqual({ completedNodeIds: ['ch2-n01', 'ch2-n02'], lastVisitedNodeId: 'ch2-n02', completedAt: null, completionCelebrated: false });
    expect(progress.chapters[CH2].layoutVersion).toBeUndefined(); // only Chapter One is versioned
    expect(progress.activeChapterId).toBe(CH1);
    expect(window.localStorage.getItem(attemptsKey)).toBe(attemptsJson);
    expect(window.localStorage.getItem('rh_some_other_setting')).toBe('{"keep":true}');
    expect(chapterOne(progress).completedNodeIds).toEqual([]);
  });

  it('migrates each storage namespace independently: a signed-in user\'s old data resets, the guest\'s own data is untouched', () => {
    // guest has current-layout progress
    seed({ [CH1]: { layoutVersion: 2, completedNodeIds: ['ch1-n07'], lastVisitedNodeId: null, completedAt: null, completionCelebrated: false } });
    // a signed-in user's namespace holds old-layout progress
    setJourneyStorageUser('user-a');
    seed({ [CH1]: oldChapter() });
    expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual([]);

    setJourneyStorageUser(null);
    expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual(['ch1-n07']);
  });

  it('does not import guest progress at sign-in: the signed-in namespace starts empty and the guest data stays put', () => {
    markJourneyNodeCompleted('ch1-n07'); // guest
    setJourneyStorageUser('user-a');
    expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual([]);
    setJourneyStorageUser(null);
    expect(chapterOne(loadJourneyProgress()).completedNodeIds).toEqual(['ch1-n07']);
  });
});
