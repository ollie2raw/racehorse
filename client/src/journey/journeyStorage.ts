import {
  createEmptyChapterProgress,
  getAllJourneyNodeIds,
  getJourneyChapterById,
  getJourneyChapterForNode,
  getChapterProgressRecord,
  isChapterFullyComplete,
  isPlayableChapterId,
} from './journeyChapters';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';
import type {
  JourneyChapterProgress,
  JourneyNode,
  JourneyNodeStatus,
  JourneyProgress,
  JourneyProgressV1,
} from './journeyTypes';

export const JOURNEY_PROGRESS_KEY = 'rh_journey_progress_v1';

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
  };
}

function sanitizeProgress(value: unknown): JourneyProgress {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_PROGRESS, updatedAt: new Date().toISOString() };
  }

  const parsed = value as Partial<JourneyProgress> | JourneyProgressV1;
  if (parsed.version === 1) {
    return migrateV1Progress(parsed as JourneyProgressV1);
  }

  const validIds = new Set(getAllJourneyNodeIds());
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
    const raw = window.localStorage.getItem(JOURNEY_PROGRESS_KEY);
    if (!raw) return { ...DEFAULT_PROGRESS, updatedAt: new Date().toISOString() };
    const parsed = JSON.parse(raw) as Partial<JourneyProgress> | JourneyProgressV1;
    const migrated = sanitizeProgress(parsed);
    if (parsed.version !== 2) {
      saveJourneyProgress(migrated);
    }
    return migrated;
  } catch {
    return { ...DEFAULT_PROGRESS, updatedAt: new Date().toISOString() };
  }
}

export function saveJourneyProgress(progress: JourneyProgress): JourneyProgress {
  const next = sanitizeProgress({ ...progress, updatedAt: new Date().toISOString() });
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(JOURNEY_PROGRESS_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota / private mode errors during render paths.
    }
  }
  return next;
}

export function resetJourneyProgress(): JourneyProgress {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(JOURNEY_PROGRESS_KEY);
    } catch {
      // Ignore storage errors.
    }
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
