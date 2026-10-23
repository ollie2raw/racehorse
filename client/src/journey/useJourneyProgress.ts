import { useCallback, useMemo, useState } from 'react';
import {
  getChapterRuntimeStatus,
  getJourneyChapterById,
  getJourneyNodeById,
  getVisibleJourneyChapterDefinitions,
} from './journeyChapters';
import {
  acknowledgeChapterCompletion,
  canMarkJourneyNodeComplete,
  getJourneyCompletionSummary,
  getJourneyNodeStatus,
  isChapterFullyComplete,
  loadJourneyProgress,
  markJourneyNodeCompleted,
  resetJourneyProgress,
  setJourneyActiveChapter,
  setJourneyLastVisited,
  shouldCelebrateChapterCompletion,
} from './journeyStorage';
import { JOURNEY_CHAPTER_1_ID } from './journeyTypes';
import type { JourneyChapterWithStatus, JourneyNodeWithStatus } from './journeyTypes';
import { getAllJourneyContentDescriptors } from './journeyContentResolver';
import { projectLegacyJourneyProgressToEvidence } from './journeyLegacyEvidenceAdapter';
import { recoverPendingJourneyCompletions } from './journeyCompletionRecovery';

export function useJourneyProgress() {
  const [progress, setProgress] = useState(() => {
    // Finish any win whose stage completion a crash, reload or lost race left owed — BEFORE progress is read
    // for display, so the trail never renders a recorded win as an unfinished stage.
    recoverPendingJourneyCompletions();
    return loadJourneyProgress();
  });

  const activeChapter = useMemo(
    () => getJourneyChapterById(progress.activeChapterId) ?? getJourneyChapterById(JOURNEY_CHAPTER_1_ID)!,
    [progress.activeChapterId],
  );

  const chaptersWithStatus = useMemo<JourneyChapterWithStatus[]>(
    () =>
      getVisibleJourneyChapterDefinitions().map((chapter) => {
        const summary = getJourneyCompletionSummary(chapter.chapterId, progress);
        return {
          ...chapter,
          runtimeStatus: getChapterRuntimeStatus(chapter, progress),
          completedNodes: summary.completed,
        };
      }),
    [progress],
  );

  const nodesWithStatus = useMemo<JourneyNodeWithStatus[]>(
    () =>
      activeChapter.nodes.map((node) => ({
        ...node,
        status: getJourneyNodeStatus(node, progress, activeChapter.nodes),
      })),
    [activeChapter.nodes, progress],
  );

  const summary = useMemo(
    () => getJourneyCompletionSummary(activeChapter.chapterId, progress),
    [activeChapter.chapterId, progress],
  );

  const activeChapterComplete = useMemo(
    () => isChapterFullyComplete(activeChapter.chapterId, progress),
    [activeChapter.chapterId, progress],
  );

  const shouldShowChapterCompleteCelebration = useMemo(
    () => shouldCelebrateChapterCompletion(activeChapter.chapterId, progress),
    [activeChapter.chapterId, progress],
  );

  const learningEvidence = useMemo(
    () => projectLegacyJourneyProgressToEvidence({
      legacyProgress: progress,
      activeDescriptors: getAllJourneyContentDescriptors(),
    }),
    [progress],
  );

  const selectNode = useCallback((nodeId: string) => {
    setProgress((current) => setJourneyLastVisited(nodeId, current));
  }, []);

  const completeNode = useCallback((nodeId: string) => {
    setProgress((current) => {
      const node = getJourneyNodeById(nodeId);
      if (!node || !canMarkJourneyNodeComplete(node, current)) return current;
      return markJourneyNodeCompleted(nodeId, current);
    });
  }, []);

  /**
   * Re-reads progress after a completion was written straight to storage by the shared durable sequence
   * (`recordJourneyLessonCompletion` / `recordJourneySprintResult`). Also finishes any obligation still owed.
   */
  const syncProgressFromStorage = useCallback(() => {
    recoverPendingJourneyCompletions();
    setProgress(loadJourneyProgress());
  }, []);

  const celebrateChapterCompletion = useCallback((chapterId: string) => {
    setProgress((current) => acknowledgeChapterCompletion(chapterId, current));
  }, []);

  const resetProgress = useCallback(() => {
    setProgress(resetJourneyProgress());
  }, []);

  const selectChapter = useCallback((chapterId: string) => {
    setProgress((current) => setJourneyActiveChapter(chapterId, current));
  }, []);

  return {
    progress,
    activeChapter,
    chaptersWithStatus,
    nodesWithStatus,
    summary,
    activeChapterComplete,
    shouldShowChapterCompleteCelebration,
    learningEvidence,
    selectNode,
    selectChapter,
    completeNode,
    syncProgressFromStorage,
    celebrateChapterCompletion,
    resetProgress,
  };
}
