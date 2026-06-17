import {
  getJourneyChapterById,
  getPlayableChapterDefinitions,
  isChapterFullyComplete,
  isPlayableChapterId,
} from './journeyChapters.ts';
import { getJourneyCompletionSummary, loadJourneyProgress } from './journeyStorage.ts';
import type { JourneyChapterDefinition, JourneyProgress } from './journeyTypes.ts';

export type JourneyHomeSummary = {
  playableChapterCount: number;
  totalNodes: number;
  totalCompleted: number;
  activeChapter: JourneyChapterDefinition;
  activeChapterCompleted: number;
  activeChapterTotal: number;
  allChaptersComplete: boolean;
  hasAnyProgress: boolean;
  ctaLabel: 'Start Journey' | 'Continue Journey';
  progressLine: string;
  hintLine: string | null;
};

function resolveActiveChapter(progress: JourneyProgress): JourneyChapterDefinition {
  const playable = getPlayableChapterDefinitions();
  const stored = getJourneyChapterById(progress.activeChapterId);
  if (
    stored &&
    isPlayableChapterId(stored.chapterId) &&
    !isChapterFullyComplete(stored.chapterId, progress)
  ) {
    return stored;
  }

  const firstIncomplete = playable.find((chapter) => !isChapterFullyComplete(chapter.chapterId, progress));
  return firstIncomplete ?? playable[playable.length - 1];
}

export function getJourneyHomeSummary(progress: JourneyProgress = loadJourneyProgress()): JourneyHomeSummary {
  const playable = getPlayableChapterDefinitions();
  const totalNodes = playable.reduce((count, chapter) => count + chapter.nodes.length, 0);
  const totalCompleted = playable.reduce((count, chapter) => {
    const summary = getJourneyCompletionSummary(chapter.chapterId, progress);
    return count + summary.completed;
  }, 0);

  const allChaptersComplete = playable.every((chapter) =>
    isChapterFullyComplete(chapter.chapterId, progress),
  );
  const activeChapter = resolveActiveChapter(progress);
  const activeSummary = getJourneyCompletionSummary(activeChapter.chapterId, progress);
  const hasAnyProgress = totalCompleted > 0;
  const ctaLabel = hasAnyProgress ? 'Continue Journey' : 'Start Journey';

  let progressLine: string;
  if (allChaptersComplete) {
    progressLine = `${totalCompleted} / ${totalNodes} nodes complete · All six chapters cleared`;
  } else {
    progressLine = `Chapter ${activeChapter.chapterNumber}: ${activeChapter.title} · ${activeSummary.completed} / ${activeSummary.total} · ${totalCompleted} / ${totalNodes} overall`;
  }

  let hintLine: string | null = null;
  if (allChaptersComplete) {
    hintLine = 'More Journey chapters ahead.';
  } else if (isChapterFullyComplete(activeChapter.chapterId, progress)) {
    const nextChapter = playable.find(
      (chapter) => chapter.chapterNumber === activeChapter.chapterNumber + 1,
    );
    if (nextChapter) {
      hintLine = `Next chapter unlocked: ${nextChapter.title}`;
    }
  } else if (activeSummary.completed === 0 && activeChapter.chapterNumber > 1) {
    hintLine = `Chapter ${activeChapter.chapterNumber} unlocked — ${activeChapter.subtitle}`;
  } else if (activeChapter.nextChapterCopy) {
    hintLine = activeChapter.nextChapterCopy;
  }

  return {
    playableChapterCount: playable.length,
    totalNodes,
    totalCompleted,
    activeChapter,
    activeChapterCompleted: activeSummary.completed,
    activeChapterTotal: activeSummary.total,
    allChaptersComplete,
    hasAnyProgress,
    ctaLabel,
    progressLine,
    hintLine,
  };
}
