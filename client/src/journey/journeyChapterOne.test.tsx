// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  JOURNEY_CHAPTER_DEFINITIONS,
  getJourneyChapterById,
  getPlayableChapterDefinitions,
  getVisibleJourneyChapterDefinitions,
  isPlayableChapterId,
} from './journeyChapters';
import { getJourneyContentDescriptor } from './journeyContentResolver';
import { buildJourneyBotTrial } from './journeyLaunch';
import { buildJourneyMatchContext, formatJourneyHeadStart } from './journeyMatchContext';
import { getJourneyHomeSummary } from './journeyHomeSummary';
import { getJourneyMatchVariant } from './journeyMatchVariants';
import { setJourneyStorageUser } from './journeyStorageScope';
import { useJourneyProgress } from './useJourneyProgress';
import { validateJourneyContent } from './journeyContentValidation';
import type { JourneyNodeWithStatus } from './journeyTypes';

const chapterOne = () => getJourneyChapterById('ch1-fritz-trail')!;
const byOrder = () => [...chapterOne().nodes].sort((a, b) => a.order - b.order);

beforeEach(() => {
  window.localStorage.clear();
  setJourneyStorageUser(null);
});

describe('Chapter One: the approved nine-stage trail', () => {
  it('has exactly the nine stages, in the approved order, with truthful titles', () => {
    expect(byOrder().map((node) => node.title)).toEqual([
      'Read the Gate',
      'Dot’s Table',
      'Greedy Hands',
      'Count the Yard',
      'Open Book',
      'Quick Reads',
      'Doubles Aren’t Free',
      'Marlow’s Table',
      'Handicap Stakes',
    ]);
    expect(chapterOne().totalNodes).toBe(9);
    expect(chapterOne().nodes.map((node) => node.order).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('keeps stable ids: the three lesson ids are untouched, retired ids are gone and not reused', () => {
    const ids = byOrder().map((node) => node.id);
    expect(ids).toEqual(['ch1-n07', 'ch1-n02', 'ch1-n11', 'ch1-n08', 'ch1-n04', 'ch1-n05', 'ch1-n09', 'ch1-n12', 'ch1-n10']);
    for (const retired of ['ch1-n01', 'ch1-n03', 'ch1-n06']) expect(ids).not.toContain(retired);
    expect(getJourneyContentDescriptor('ch1-n01')).toBeNull();
    expect(getJourneyContentDescriptor('ch1-n03')).toBeNull();
    expect(getJourneyContentDescriptor('ch1-n06')).toBeNull();
  });

  it('keeps the lesson ids resolving to their premium lessons, at their new positions', () => {
    const lessons = [
      ['ch1-n07', 1, 'journey:ch1:open-end-discipline'],
      ['ch1-n08', 4, 'journey:ch1:counting-whats-left'],
      ['ch1-n09', 7, 'journey:ch1:doubles-arent-free'],
    ] as const;
    for (const [nodeId, order, contentId] of lessons) {
      expect(getJourneyChapterById('ch1-fritz-trail')!.nodes.find((node) => node.id === nodeId)?.order).toBe(order);
      const descriptor = getJourneyContentDescriptor(nodeId);
      expect(descriptor?.migrationClass).toBe('premium');
      expect(String(descriptor?.contentId)).toBe(contentId);
      expect(descriptor?.runtime.kind).toBe('lesson_sequence');
      expect(descriptor?.runtimeAvailability).toBe('available');
    }
  });

  it('resolves every stage to the runtime its title promises — Greedy Hands is a real lesson, not a placeholder', () => {
    const runtime = (id: string) => getJourneyContentDescriptor(id)?.runtime.kind;
    expect(runtime('ch1-n02')).toBe('bot_match');
    expect(runtime('ch1-n04')).toBe('bot_match');
    expect(runtime('ch1-n05')).toBe('puzzle_sprint');
    expect(runtime('ch1-n12')).toBe('bot_match');
    expect(runtime('ch1-n10')).toBe('boss_match');
    const greedy = getJourneyContentDescriptor('ch1-n11');
    expect(greedy?.runtime.kind).toBe('lesson_sequence');
    expect(greedy?.runtimeAvailability).toBe('available');
    expect(greedy?.supportStatus).toBe('supported');
  });

  it('no Chapter One stage is an acknowledgement-only placeholder', () => {
    for (const node of chapterOne().nodes) {
      expect(getJourneyContentDescriptor(node.id)?.runtime.kind).not.toBe('briefing_acknowledgement');
    }
  });

  it('configures each match from node data: rivals, targets, and the boss head start', () => {
    const trialFor = (id: string) => buildJourneyBotTrial({ ...chapterOne().nodes.find((node) => node.id === id)!, status: 'unlocked' } as JourneyNodeWithStatus)!;
    expect(trialFor('ch1-n02')).toMatchObject({ rivalName: 'Dot', fritzTier: 'rookie', winningScore: 30, dealSize: 7 });
    expect(trialFor('ch1-n04')).toMatchObject({ rivalName: 'Marlow', fritzTier: 'standard', winningScore: 40, dealSize: 14 });
    expect(trialFor('ch1-n12')).toMatchObject({ rivalName: 'Marlow', fritzTier: 'standard', winningScore: 40, dealSize: 7 });
    expect(trialFor('ch1-n10')).toMatchObject({ rivalName: 'Fritz', fritzTier: 'elite', winningScore: 60, scoreHandicap: { you: 15, bot: 0 } });
    expect(getJourneyMatchVariant('handicap-stakes')?.scoreHandicap).toEqual({ you: 15, bot: 0 });
    expect(getJourneyMatchVariant('open-book')).toMatchObject({ dealSize: 14, winningScore: 40, fritzTier: 'standard' });
  });

  it('the whole production content registry still validates', () => {
    const result = validateJourneyContent();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('Chapters 2–6 are hidden in the Chapter One slice (content kept)', () => {
  it('keeps their content in the registry but surfaces only Chapter One', () => {
    expect(JOURNEY_CHAPTER_DEFINITIONS.map((chapter) => chapter.chapterNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(JOURNEY_CHAPTER_DEFINITIONS.slice(1).every((chapter) => chapter.nodes.length > 0)).toBe(true);
    expect(getVisibleJourneyChapterDefinitions().map((chapter) => chapter.chapterNumber)).toEqual([1]);
    expect(getPlayableChapterDefinitions().map((chapter) => chapter.chapterNumber)).toEqual([1]);
    expect(isPlayableChapterId('ch1-fritz-trail')).toBe(true);
    for (const hidden of ['ch2-high-line', 'ch3-long-march', 'ch4-pressure-circuit', 'ch5-iron-mile', 'ch6-master-table']) {
      expect(isPlayableChapterId(hidden)).toBe(false);
    }
  });

  it('the trail screen\'s chapter list (tabs and next-chapter teaser) contains only Chapter One', () => {
    const { result } = renderHook(() => useJourneyProgress());
    expect(result.current.chaptersWithStatus.map((chapter) => chapter.chapterNumber)).toEqual([1]);
    expect(result.current.activeChapter.chapterId).toBe('ch1-fritz-trail');
  });

  it('cannot select a hidden chapter, even programmatically', () => {
    const { result } = renderHook(() => useJourneyProgress());
    result.current.selectChapter('ch2-high-line');
    expect(result.current.progress.activeChapterId).toBe('ch1-fritz-trail');
  });

  it('progress summaries count only the visible chapter', () => {
    const summary = getJourneyHomeSummary();
    expect(summary.playableChapterCount).toBe(1);
    expect(summary.totalNodes).toBe(9);
  });
});

describe('stage unlock chain follows the new order', () => {
  const seed = (completedNodeIds: string[]) =>
    window.localStorage.setItem(
      'rh_journey_progress_v1',
      JSON.stringify({
        version: 2,
        activeChapterId: 'ch1-fritz-trail',
        chapters: { 'ch1-fritz-trail': { layoutVersion: 2, completedNodeIds, lastVisitedNodeId: null, completedAt: null, completionCelebrated: false } },
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
  const statuses = (nodes: JourneyNodeWithStatus[]) => Object.fromEntries(nodes.map((node) => [node.title, node.status]));

  it('starts at Read the Gate with everything else locked', () => {
    const { result } = renderHook(() => useJourneyProgress());
    const current = statuses(result.current.nodesWithStatus);
    expect(current['Read the Gate']).toBe('current');
    expect(Object.entries(current).filter(([, status]) => status === 'locked')).toHaveLength(8);
  });

  it('unlocks one stage at a time in trail order: after Dot\'s Table the current stage is Greedy Hands', () => {
    seed(['ch1-n07', 'ch1-n02']);
    const { result } = renderHook(() => useJourneyProgress());
    const current = statuses(result.current.nodesWithStatus);
    expect(current['Read the Gate']).toBe('completed');
    expect(current['Dot’s Table']).toBe('completed');
    expect(current['Greedy Hands']).toBe('current');
    expect(current['Count the Yard']).toBe('locked');
  });

  it('a fixture that completes Greedy Hands unlocks Count the Yard (how the premium E2E specs seed their state)', () => {
    seed(['ch1-n07', 'ch1-n02', 'ch1-n11']);
    const { result } = renderHook(() => useJourneyProgress());
    expect(statuses(result.current.nodesWithStatus)['Count the Yard']).toBe('current');
  });
});

describe('journey match context', () => {
  it('formats a player head start, an opponent head start, and no head start', () => {
    expect(formatJourneyHeadStart({ you: 15, bot: 0 })).toBe('You start +15');
    expect(formatJourneyHeadStart({ you: 20, bot: 5 })).toBe('You start +15');
    expect(formatJourneyHeadStart({ you: 0, bot: 15 }, 'Fritz')).toBe('Fritz starts +15');
    expect(formatJourneyHeadStart({ you: 0, bot: 0 })).toBeNull();
    expect(formatJourneyHeadStart(undefined)).toBeNull();
  });

  it('builds stage, rival, target and head-start context from the launched challenge', () => {
    const challenge = buildJourneyBotTrial({ ...chapterOne().nodes.find((node) => node.id === 'ch1-n10')!, status: 'unlocked' } as JourneyNodeWithStatus)!;
    expect(buildJourneyMatchContext(challenge)).toEqual({
      stageTitle: 'Handicap Stakes',
      rivalName: 'Fritz',
      targetScore: 60,
      headStartLabel: 'You start +15',
    });
    const dot = buildJourneyBotTrial({ ...chapterOne().nodes.find((node) => node.id === 'ch1-n02')!, status: 'unlocked' } as JourneyNodeWithStatus)!;
    expect(buildJourneyMatchContext(dot)).toEqual({ stageTitle: 'Dot’s Table', rivalName: 'Dot', targetScore: 30, headStartLabel: null });
  });

  it('falls back to Fritz when a stage names no rival', () => {
    const challenge = buildJourneyBotTrial({ ...chapterOne().nodes.find((node) => node.id === 'ch1-n02')!, rivalName: undefined, status: 'unlocked' } as JourneyNodeWithStatus)!;
    expect(buildJourneyMatchContext(challenge).rivalName).toBe('Fritz');
  });

  it('shows a configured head start for any node-driven value, not just +15', () => {
    const challenge = buildJourneyBotTrial({ ...chapterOne().nodes.find((node) => node.id === 'ch1-n10')!, status: 'unlocked' } as JourneyNodeWithStatus)!;
    expect(buildJourneyMatchContext({ ...challenge, scoreHandicap: { you: 20, bot: 0 } }).headStartLabel).toBe('You start +20');
  });
});
