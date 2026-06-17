/**
 * EXAMPLE ONLY — not registered in journeyChapters.ts or chapters/index.ts.
 *
 * Copy this file when authoring a new chapter (e.g. ch4YourChapter.nodes.ts).
 * Do not import this module into production Journey runtime.
 *
 * Validator and smoke tests only count chapters in JOURNEY_CHAPTER_DEFINITIONS.
 */
import type { JourneyNode } from '../journeyTypes.ts';

/** Example chapter slug — replace with a real id like `ch4-iron-pass`. */
export const EXAMPLE_CHAPTER_ID = 'ch9-template-example';

export const EXAMPLE_CHAPTER_TITLE = 'Chapter 9: Template Example';

/** Three-node mini chapter demonstrating every required node pattern. */
export const EXAMPLE_CHAPTER_NODES: JourneyNode[] = [
  {
    id: 'ch9-n01',
    chapterId: EXAMPLE_CHAPTER_ID,
    chapterTitle: EXAMPLE_CHAPTER_TITLE,
    order: 1,
    title: 'Template Briefing',
    subtitle: 'Opening checkpoint for a new chapter.',
    nodeType: 'checkpoint',
    difficulty: 'intro',
    requirements: ['Complete the previous chapter'],
    rewardText: 'Template Marker',
    badgeText: 'START',
    action: { kind: 'placeholder' },
    completionCriteria: 'Complete the template briefing.',
  },
  {
    id: 'ch9-n02',
    chapterId: EXAMPLE_CHAPTER_ID,
    chapterTitle: EXAMPLE_CHAPTER_TITLE,
    order: 2,
    title: 'Template Puzzle',
    subtitle: 'Local MCQ challenge — content lives in journeyPuzzles.ts.',
    nodeType: 'puzzle',
    difficulty: 'standard',
    requirements: ['Complete Template Briefing'],
    rewardText: 'Template Read',
    action: { kind: 'puzzle', puzzleId: 'ch9-template-puzzle' },
    completionCriteria: 'Solve the template puzzle.',
  },
  {
    id: 'ch9-n03',
    chapterId: EXAMPLE_CHAPTER_ID,
    chapterTitle: EXAMPLE_CHAPTER_TITLE,
    order: 3,
    title: 'Template Boss',
    subtitle: 'Boss trial — use existing Fritz tiers only.',
    nodeType: 'boss',
    difficulty: 'boss',
    requirements: ['Complete Template Puzzle'],
    rewardText: 'Template Seal',
    badgeText: 'BOSS',
    action: { kind: 'botMatch', fritzTier: 'master', dealSize: 7, winningScore: 60 },
    completionCriteria: 'Win the template boss trial.',
  },
];
