import { JOURNEY_CHAPTER_1_ID, type JourneyNode } from '../journeyTypes.ts';

export const CH1_FRITZ_TRAIL_CHAPTER_TITLE = 'Chapter 1: The Fritz Trail';

/**
 * Chapter 1 — the approved nine-stage sequence. Node IDs are stable identifiers, NOT positions:
 * `order` drives the trail and the unlock chain. The three lesson IDs (n07/n08/n09) are referenced
 * by the authored lesson definitions and their validators, so they are kept as-is even though the
 * stages they carry now sit at positions 1, 4 and 7. Retired IDs (n01, n03, n06) are not reused.
 *
 *   1 Read the Gate        ch1-n07  lesson (open-end discipline)
 *   2 Dot's Table          ch1-n02  Rookie race to 30
 *   3 Greedy Hands         ch1-n11  lesson — content arrives in Stage 2; honestly unavailable until then
 *   4 Count the Yard       ch1-n08  lesson (counting)
 *   5 Open Book            ch1-n04  Standard, 14-tile deal, race to 40 (provisional)
 *   6 Quick Reads          ch1-n05  puzzle sprint
 *   7 Doubles Aren't Free  ch1-n09  lesson (doubles)
 *   8 Marlow's Table       ch1-n12  Standard race to 40
 *   9 Handicap Stakes      ch1-n10  Elite at 60 with a player head start (boss)
 */
export const CH1_FRITZ_TRAIL_NODES: JourneyNode[] = [
  {
    id: 'ch1-n07',
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterTitle: CH1_FRITZ_TRAIL_CHAPTER_TITLE,
    order: 1,
    title: 'Read the Gate',
    subtitle: 'Learn what the board will actually accept before you play.',
    nodeType: 'checkpoint',
    difficulty: 'intro',
    requirements: ['Begin Chapter 1'],
    rewardText: 'Open Eye',
    badgeText: 'START',
    action: { kind: 'lesson', lessonId: 'open-end-discipline' },
    completionCriteria: 'Pass the open-end discipline lesson.',
  },
  {
    id: 'ch1-n02',
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterTitle: CH1_FRITZ_TRAIL_CHAPTER_TITLE,
    order: 2,
    title: 'Dot’s Table',
    subtitle: 'Dot is unpredictable—sometimes sharp, sometimes not. Win a short race to 30.',
    nodeType: 'match',
    difficulty: 'casual',
    requirements: ['Complete Read the Gate'],
    rewardText: 'First Blood',
    rivalName: 'Dot',
    action: { kind: 'botMatch', fritzTier: 'rookie', dealSize: 7, trialFormat: 'shortRace', winningScore: 30 },
    completionCriteria: 'Win a short race to 30 vs Rookie Fritz.',
  },
  {
    id: 'ch1-n11',
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterTitle: CH1_FRITZ_TRAIL_CHAPTER_TITLE,
    order: 3,
    title: 'Greedy Hands',
    subtitle: 'Three positions where the points on offer are not the whole story.',
    nodeType: 'checkpoint',
    difficulty: 'casual',
    requirements: ['Complete Dot’s Table'],
    rewardText: 'Cool Head',
    action: { kind: 'lesson', lessonId: 'greedy-hands' },
    completionCriteria: 'Pass the Greedy Hands lesson.',
  },
  {
    id: 'ch1-n08',
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterTitle: CH1_FRITZ_TRAIL_CHAPTER_TITLE,
    order: 4,
    title: 'Count the Yard',
    subtitle: 'Every tile you cannot see is in Fritz’s hand or the yard. Learn which.',
    nodeType: 'checkpoint',
    difficulty: 'standard',
    requirements: ['Complete Greedy Hands'],
    rewardText: 'Sharp Count',
    action: { kind: 'lesson', lessonId: 'counting-whats-left' },
    completionCriteria: 'Pass the counting lesson.',
  },
  {
    id: 'ch1-n04',
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterTitle: CH1_FRITZ_TRAIL_CHAPTER_TITLE,
    order: 5,
    title: 'Open Book',
    subtitle: 'All 28 tiles are dealt and nothing is left in the yard. Whatever you cannot see is in Marlow’s hand.',
    nodeType: 'match',
    difficulty: 'standard',
    requirements: ['Complete Count the Yard'],
    rewardText: 'Book Read',
    rivalName: 'Marlow',
    action: { kind: 'botMatchVariant', variantId: 'open-book' },
    completionCriteria: 'Win a race to 40 vs Standard Fritz with all 28 tiles dealt.',
  },
  {
    id: 'ch1-n05',
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterTitle: CH1_FRITZ_TRAIL_CHAPTER_TITLE,
    order: 6,
    title: 'Quick Reads',
    subtitle: 'Three fast reads on one clock.',
    nodeType: 'puzzle',
    difficulty: 'standard',
    requirements: ['Complete Open Book'],
    rewardText: 'Fast Eye',
    badgeText: 'SPRINT',
    action: {
      kind: 'puzzleSprint',
      puzzleIds: ['ch1-n05-sprint-1', 'ch1-n05-sprint-2', 'ch1-n05-sprint-3'],
      timeLimitSec: 60,
    },
    completionCriteria: 'Clear the puzzle sprint—two of three reads correct under one clock.',
  },
  {
    id: 'ch1-n09',
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterTitle: CH1_FRITZ_TRAIL_CHAPTER_TITLE,
    order: 7,
    title: 'Doubles Aren’t Free',
    subtitle: 'A double opens two ends. Know both before you play it.',
    nodeType: 'checkpoint',
    difficulty: 'standard',
    requirements: ['Complete Quick Reads'],
    rewardText: 'Double Sense',
    action: { kind: 'lesson', lessonId: 'doubles-arent-free' },
    completionCriteria: 'Pass the doubles lesson.',
  },
  {
    id: 'ch1-n12',
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterTitle: CH1_FRITZ_TRAIL_CHAPTER_TITLE,
    order: 8,
    title: 'Marlow’s Table',
    subtitle: 'Marlow plays it straight. Normal rules, race to 40.',
    nodeType: 'match',
    difficulty: 'hard',
    requirements: ['Complete Doubles Aren’t Free'],
    rewardText: 'Marlow’s Respect',
    rivalName: 'Marlow',
    action: { kind: 'botMatch', fritzTier: 'standard', dealSize: 7, trialFormat: 'shortRace', winningScore: 40 },
    completionCriteria: 'Win a short race to 40 vs Standard Fritz.',
  },
  {
    id: 'ch1-n10',
    chapterId: JOURNEY_CHAPTER_1_ID,
    chapterTitle: CH1_FRITZ_TRAIL_CHAPTER_TITLE,
    order: 9,
    title: 'Handicap Stakes',
    subtitle: 'Fritz spots you 15 points in a race to 60. Make them count.',
    nodeType: 'boss',
    difficulty: 'boss',
    requirements: ['Complete Marlow’s Table'],
    rewardText: 'Fritz Trail Conqueror',
    badgeText: 'BOSS',
    rivalName: 'Fritz',
    action: { kind: 'botMatchVariant', variantId: 'handicap-stakes' },
    completionCriteria: 'Win a race to 60 vs Elite Fritz with a 15-point head start.',
  },
];
