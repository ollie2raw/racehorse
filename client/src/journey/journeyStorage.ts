import {
  JOURNEY_CHAPTER_ONE_LAYOUT_VERSION,
  createEmptyChapterProgress,
  getAllJourneyNodeIds,
  getJourneyChapterById,
  getJourneyChapterForNode,
  getChapterProgressRecord,
  isChapterFullyComplete,
  isPlayableChapterId,
} from './journeyChapters';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';
import { journeyLegacyKeySuffix } from './journeyStorageScope';
import { clearPendingCompletions } from './journeyPendingCompletions';
import type {
  JourneyChapterProgress,
  JourneyNode,
  JourneyNodeStatus,
  JourneyProgress,
  JourneyProgressV1,
} from './journeyTypes';

/**
 * Base key. Guests use it as-is (unchanged from before user scoping); signed-in users get a `:u:<id>` suffix.
 *
 * Isolation, not merging: progress made as a guest is NOT imported when the player signs in - a signed-in
 * user starts from their own (initially empty) namespace, and the guest data stays where it was. Data that
 * was saved under this bare key before user scoping existed is treated as guest data, whoever wrote it.
 */
export const JOURNEY_PROGRESS_KEY = 'rh_journey_progress_v1';

export function getJourneyProgressStorageKey(): string {
  return `${JOURNEY_PROGRESS_KEY}${journeyLegacyKeySuffix()}`;
}

const DEFAULT_PROGRESS: JourneyProgress = {
  version: 2,
  activeChapterId: JOURNEY_CHAPTER_1_ID,
  chapters: {
    [JOURNEY_CHAPTER_1_ID]: createEmptyChapterProgress(),
  },
  updatedAt: new Date(0).toISOString(),
};

function migrateV1Progress(parsed: JourneyProgressV1): JourneyProgress {
  const chapterId = parsed.chapterId || JOURNEY_CHAPTER_1_ID;
  const validIds = new Set(getAllJourneyNodeIds());
  const completedNodeIds = Array.from(
    new Set((parsed.completedNodeIds ?? []).filter((id) => validIds.has(id))),
  );
  const lastVisitedNodeId =
    typeof parsed.lastVisitedNodeId === 'string' && validIds.has(parsed.lastVisitedNodeId)
      ? parsed.lastVisitedNodeId
      : null;
  const chapter = getJourneyChapterById(chapterId);
  const completedAt =
    chapter && chapter.nodes.every((node) => completedNodeIds.includes(node.id))
      ? parsed.updatedAt ?? new Date().toISOString()
      : null;

  return {
    version: 2,
    activeChapterId: chapterId,
    chapters: {
      [chapterId]: {
        completedNodeIds,
        lastVisitedNodeId,
        completedAt,
        completionCelebrated: completedAt != null,
      },
    },
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
  };
}

function sanitizeChapterProgress(value: unknown, validIds: Set<string>): JourneyChapterProgress {
  if (!value || typeof value !== 'object') return createEmptyChapterProgress();
  const parsed = value as Partial<JourneyChapterProgress>;
  const completedNodeIds = Array.from(
    new Set(
      (Array.isArray(parsed.completedNodeIds)
        ? parsed.completedNodeIds.filter((id): id is string => typeof id === 'string')
        : []
      ).filter((id) => validIds.has(id)),
    ),
  );
  return {
    completedNodeIds,
    lastVisitedNodeId:
      typeof parsed.lastVisitedNodeId === 'string' && validIds.has(parsed.lastVisitedNodeId)
        ? parsed.lastVisitedNodeId
        : null,
    completedAt: typeof parsed.completedAt === 'string' ? parsed.completedAt : null,
    completionCelebrated: parsed.completionCelebrated === true,
    ...(typeof parsed.layoutVersion === 'number' && Number.isInteger(parsed.layoutVersion) && parsed.layoutVersion >= 1
      ? { layoutVersion: parsed.layoutVersion }
      : {}),
  };
}

/**
 * Chapter One layout versioning (see `JOURNEY_CHAPTER_ONE_LAYOUT_VERSION`).
 *
 * `migrate: true` is for data read from storage. Progress with no `layoutVersion`, or an older one, was
 * recorded against an earlier layout whose reused IDs now mean different stages, so Chapter One's entry -
 * and only that entry - is reset to empty and stamped with the current version:
 *
 *   invalidated (Chapter One only):  completedNodeIds, lastVisitedNodeId, completedAt, completionCelebrated
 *   preserved:                       every other chapter's entry, activeChapterId, the attempt log (a
 *                                    separate key) and anything outside this store
 *
 * `completedAt` and `completionCelebrated` are reset deliberately: a chapter-complete timestamp left from
 * the old layout would otherwise make `isChapterFullyComplete` report the new sequence as finished.
 *
 * Idempotent: once stamped, the stored version equals the current one and nothing is reset again. Progress
 * stamped with a NEWER version (written by a newer build) is left untouched rather than reset.
 *
 * `migrate: false` is for progress the current code is saving (it is, by construction, in the current
 * layout), so an unstamped entry is just stamped - never reset.
 */
function applyChapterOneLayout(chapters: Record<string, JourneyChapterProgress>, migrate: boolean): void {
  const chapterOne = chapters[JOURNEY_CHAPTER_1_ID];
  if (!chapterOne) return;
  const stored = chapterOne.layoutVersion ?? 1;
  if (stored >= JOURNEY_CHAPTER_ONE_LAYOUT_VERSION) return;
  chapters[JOURNEY_CHAPTER_1_ID] = migrate
    ? { ...createEmptyChapterProgress(), layoutVersion: JOURNEY_CHAPTER_ONE_LAYOUT_VERSION }
    : { ...chapterOne, layoutVersion: JOURNEY_CHAPTER_ONE_LAYOUT_VERSION };
}

function sanitizeProgress(value: unknown, migrate = false): JourneyProgress {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PROGRESS, updatedAt: new Date().toISOString() };
  }

  const parsed = value as Partial<JourneyProgress> | JourneyProgressV1;
  if (parsed.version === 1) {
    const upgraded = migrateV1Progress(parsed as JourneyProgressV1);
    applyChapterOneLayout(upgraded.chapters, migrate); // v1 predates layout versioning: it is the original layout
    return upgraded;
  }

  const chaptersRaw =
    parsed.chapters && typeof parsed.chapters === 'object'
      ? (parsed.chapters as Record<string, unknown>)
      : {};
  const chapters: Record<string, JourneyChapterProgress> = {};

  for (const [chapterId, chapterValue] of Object.entries(chaptersRaw)) {
    const chapter = getJourneyChapterById(chapterId);
    if (!chapter) continue;
    const chapterValidIds = new Set(chapter.nodes.map((node) => node.id));
    chapters[chapterId] = sanitizeChapterProgress(chapterValue, chapterValidIds);
  }

  if (!chapters[JOURNEY_CHAPTER_1_ID]) {
    chapters[JOURNEY_CHAPTER_1_ID] = createEmptyChapterProgress();
  }
  // Before the all-complete check below, so invalidated completions cannot be re-derived into a completedAt.
  applyChapterOneLayout(chapters, migrate);

  for (const [chapterId, chapterProgress] of Object.entries(chapters)) {
    const chapter = getJourneyChapterById(chapterId);
    if (!chapter || chapter.nodes.length === 0) continue;
    const allComplete = chapter.nodes.every((node) =>
      chapterProgress.completedNodeIds.includes(node.id),
    );
    if (allComplete && !chapterProgress.completedAt) {
      chapterProgress.completedAt = new Date().toISOString();
    }
  }

  const activeChapterId =
    typeof parsed.activeChapterId === 'string' && isPlayableChapterId(parsed.activeChapterId)
      ? parsed.activeChapterId
      : JOURNEY_CHAPTER_1_ID;

  return {
    version: 2,
    activeChapterId,
    chapters,
    updatedAt:
      typeof parsed.updatedAt === 'string' && parsed.updatedAt.length > 0
        ? parsed.updatedAt
        : new Date().toISOString(),
  };
}

export function loadJourneyProgress(): JourneyProgress {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_PROGRESS, updatedAt: new Date().toISOString() };
  }
  try {
    const raw = window.localStorage.getItem(getJourneyProgressStorageKey());
    if (!raw) return { ...DEFAULT_PROGRESS, updatedAt: new Date().toISOString() };
    const parsed = JSON.parse(raw) as Partial<JourneyProgress> | JourneyProgressV1;
    // `migrate: true` — this is stored data, possibly recorded against an older Chapter One layout.
    const migrated = sanitizeProgress(parsed, true);
    // Persist a v1->v2 upgrade, or the layout stamp (and any invalidation it caused) exactly once: after
    // this the stored version is current, so later loads neither reset nor rewrite anything.
    const storedLayout = (parsed as Partial<JourneyProgress>).chapters?.[JOURNEY_CHAPTER_1_ID]?.layoutVersion;
    const layoutCurrent = typeof storedLayout === 'number' && storedLayout >= JOURNEY_CHAPTER_ONE_LAYOUT_VERSION;
    if (parsed.version !== 2 || !layoutCurrent) {
      saveJourneyProgress(migrated);
    }
    return migrated;
  } catch {
    return { ...DEFAULT_PROGRESS, updatedAt: new Date().toISOString() };
  }
}

export function saveJourneyProgress(progress: JourneyProgress): JourneyProgress {
  // Saving never resets: progress handed to us by current code is, by construction, in the current layout.
  const next = sanitizeProgress({ ...progress, updatedAt: new Date().toISOString() });
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(getJourneyProgressStorageKey(), JSON.stringify(next));
    } catch {
      // Ignore quota / private mode errors during render paths.
    }
  }
  return next;
}

export function resetJourneyProgress(): JourneyProgress {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(getJourneyProgressStorageKey());
    } catch {
      // Ignore storage errors.
    }
    // Win obligations owed to the progress being discarded are void with it (this namespace only): otherwise
    // recovery would restore the reset stage once its prerequisite was replayed. The attempt log is history
    // and is deliberately left alone.
    clearPendingCompletions();
  }
  return { ...DEFAULT_PROGRESS, updatedAt: new Date().toISOString() };
}

function getNodesForChapter(chapterId: string): JourneyNode[] {
  return getJourneyChapterById(chapterId)?.nodes ?? [];
}

export function setJourneyActiveChapter(
  chapterId: string,
  progress = loadJourneyProgress(),
): JourneyProgress {
  if (!isPlayableChapterId(chapterId)) return progress;
  const chapter = getJourneyChapterById(chapterId);
  if (!chapter) return progress;
  if (
    chapter.unlockRequiresChapterId &&
    !isChapterFullyComplete(chapter.unlockRequiresChapterId, progress)
  ) {
    return progress;
  }
  return saveJourneyProgress({
    ...progress,
    activeChapterId: chapterId,
  });
}

export function markJourneyNodeCompleted(
  nodeId: string,
  progress = loadJourneyProgress(),
): JourneyProgress {
  const chapter = getJourneyChapterForNode(nodeId);
  if (!chapter) return progress;

  const chapterProgress = getChapterProgressRecord(progress, chapter.chapterId);
  if (!chapter.nodes.some((node) => node.id === nodeId)) return progress;

  const completedNodeIds = chapterProgress.completedNodeIds.includes(nodeId)
    ? chapterProgress.completedNodeIds
    : [...chapterProgress.completedNodeIds, nodeId];

  const allComplete = chapter.nodes.every((node) => completedNodeIds.includes(node.id));
  const nextChapterProgress: JourneyChapterProgress = {
    ...chapterProgress,
    completedNodeIds,
    lastVisitedNodeId: nodeId,
    completedAt: allComplete ? chapterProgress.completedAt ?? new Date().toISOString() : null,
    completionCelebrated: allComplete ? chapterProgress.completionCelebrated : false,
  };

  return saveJourneyProgress({
    ...progress,
    activeChapterId: chapter.chapterId,
    chapters: {
      ...progress.chapters,
      [chapter.chapterId]: nextChapterProgress,
    },
  });
}

export function setJourneyLastVisited(
  nodeId: string,
  progress = loadJourneyProgress(),
): JourneyProgress {
  const chapter = getJourneyChapterForNode(nodeId);
  if (!chapter || !chapter.nodes.some((node) => node.id === nodeId)) return progress;

  const chapterProgress = getChapterProgressRecord(progress, chapter.chapterId);
  return saveJourneyProgress({
    ...progress,
    activeChapterId: chapter.chapterId,
    chapters: {
      ...progress.chapters,
      [chapter.chapterId]: {
        ...chapterProgress,
        lastVisitedNodeId: nodeId,
      },
    },
  });
}

export function acknowledgeChapterCompletion(
  chapterId: string,
  progress = loadJourneyProgress(),
): JourneyProgress {
  const chapterProgress = getChapterProgressRecord(progress, chapterId);
  return saveJourneyProgress({
    ...progress,
    chapters: {
      ...progress.chapters,
      [chapterId]: {
        ...chapterProgress,
        completionCelebrated: true,
      },
    },
  });
}

function isNodeUnlocked(
  node: JourneyNode,
  chapterProgress: JourneyChapterProgress,
  nodes: JourneyNode[],
): boolean {
  if (node.order === 1) return true;
  const previous = nodes.find((entry) => entry.order === node.order - 1);
  if (!previous) return false;
  return chapterProgress.completedNodeIds.includes(previous.id);
}

export function getJourneyNodeStatus(
  node: JourneyNode,
  progress: JourneyProgress,
  nodes: JourneyNode[] = getNodesForChapter(node.chapterId),
): JourneyNodeStatus {
  const chapterProgress = getChapterProgressRecord(progress, node.chapterId);
  if (chapterProgress.completedNodeIds.includes(node.id)) return 'completed';
  if (!isNodeUnlocked(node, chapterProgress, nodes)) return 'locked';

  const currentNode = nodes
    .filter(
      (entry) =>
        isNodeUnlocked(entry, chapterProgress, nodes) &&
        !chapterProgress.completedNodeIds.includes(entry.id),
    )
    .sort((a, b) => a.order - b.order)[0];

  if (currentNode?.id === node.id) return 'current';
  return 'unlocked';
}

export function canMarkJourneyNodeComplete(node: JourneyNode, progress: JourneyProgress): boolean {
  const status = getJourneyNodeStatus(node, progress);
  return status === 'current' || status === 'unlocked';
}

export function getJourneyCompletionSummary(
  chapterId: string,
  progress: JourneyProgress = loadJourneyProgress(),
): { completed: number; total: number } {
  const chapter = getJourneyChapterById(chapterId);
  if (!chapter) return { completed: 0, total: 0 };
  const chapterProgress = getChapterProgressRecord(progress, chapterId);
  const completed = chapter.nodes.filter((node) =>
    chapterProgress.completedNodeIds.includes(node.id),
  ).length;
  return { completed, total: chapter.nodes.length };
}

export function shouldCelebrateChapterCompletion(
  chapterId: string,
  progress: JourneyProgress = loadJourneyProgress(),
): boolean {
  const chapterProgress = getChapterProgressRecord(progress, chapterId);
  return isChapterFullyComplete(chapterId, progress) && !chapterProgress.completionCelebrated;
}

export { isChapterFullyComplete };
