import type { JourneyPuzzle } from './journeyPuzzles';

/**
 * Puzzle sets for `puzzleSprint` nodes, keyed by the sprint node's own ID.
 * These are a separate registry from `JOURNEY_PUZZLES` on purpose: that
 * registry is 1:1 with a real campaign node (`journeyContentValidation`'s
 * `validateAuxContent` requires every puzzle key to match a node ID), while
 * a sprint bundles several puzzles under one node and none of them need — or
 * get — a node of their own.
 */
export const JOURNEY_PUZZLE_SPRINTS: Record<string, JourneyPuzzle[]> = {
  'ch1-n05': [
    {
      nodeId: 'ch1-n05-sprint-1',
      eyebrow: 'Sprint · Quick Read',
      title: 'No Free Lane',
      scenario:
        'Sprint pace: the board shows open ends of 4 and 6. Read fast—the clock does not wait for a second look.',
      prompt: 'Which tile actually reaches the board?',
      choices: [
        { id: 'a', label: 'Play 4-6—it touches both ends on offer.' },
        { id: 'b', label: 'Play the tile with the most pips.' },
        { id: 'c', label: 'Pass and wait for a cleaner tile.' },
        { id: 'd', label: 'Play whichever tile is in your right hand.' },
      ],
      correctChoiceId: 'a',
      explanation:
        'In a sprint you do not have time to admire a tile that cannot play. 4-6 is the only one that reaches an open end—take it and move to the next read.',
      rewardLabel: 'Fast Eye',
      boardState: {
        ends: [4, 6],
        placedTiles: [
          { high: 4, low: 4 },
          { high: 4, low: 2 },
          { high: 2, low: 2 },
          { high: 2, low: 6 },
          { high: 6, low: 6 },
        ],
      },
      playerHand: [
        { high: 4, low: 6 },
        { high: 2, low: 6 },
      ],
      correctTile: { high: 2, low: 6 },
    },
    {
      nodeId: 'ch1-n05-sprint-2',
      eyebrow: 'Sprint · Quick Read',
      title: 'Split Ends',
      scenario: 'Sprint pace: the board shows open ends of 1 and 4. Two tiles in hand, one clock running.',
      prompt: 'Which tile actually reaches the board?',
      choices: [
        { id: 'a', label: 'Play 1-4—it reaches either open end.' },
        { id: 'b', label: 'Play 5-6—save the connector for later.' },
        { id: 'c', label: 'Pass and wait for a better tile.' },
        { id: 'd', label: 'Play the heaviest tile in hand.' },
      ],
      correctChoiceId: 'a',
      explanation:
        '5-6 touches neither open end—it cannot legally play. 1-4 fits both ends on offer. In a sprint, read what the board accepts before anything else.',
      rewardLabel: 'Fast Eye',
      boardState: {
        ends: [1, 4],
        placedTiles: [
          { high: 1, low: 1 },
          { high: 1, low: 3 },
          { high: 3, low: 3 },
          { high: 3, low: 4 },
        ],
      },
      playerHand: [
        { high: 1, low: 4 },
        { high: 5, low: 6 },
      ],
      correctTile: { high: 1, low: 4 },
    },
    {
      nodeId: 'ch1-n05-sprint-3',
      eyebrow: 'Sprint · Quick Read',
      title: 'Under the Clock',
      scenario:
        'Sprint pace, race to 60: you sit at 52, Fritz at 48. One tile locks a safe line; the other only looks faster.',
      prompt: 'Which tile is the disciplined read?',
      choices: [
        { id: 'a', label: 'Play 5-2—the safe line that still reaches the board.' },
        { id: 'b', label: 'Play 5-3—it is not a legal reply here, but it feels bigger.' },
        { id: 'c', label: 'Pass and let the clock run.' },
        { id: 'd', label: 'Play whichever tile you drew last.' },
      ],
      correctChoiceId: 'a',
      explanation:
        '5-3 does not touch either open end—it cannot play at all. 5-2 does. Under a clock, the fast read is still the correct read, not just the first one.',
      rewardLabel: 'Fast Eye',
      boardState: {
        ends: [2, 5],
        placedTiles: [
          { high: 5, low: 5 },
          { high: 5, low: 6 },
          { high: 6, low: 4 },
          { high: 4, low: 2 },
        ],
      },
      playerHand: [
        { high: 5, low: 2 },
        { high: 5, low: 3 },
      ],
      correctTile: { high: 5, low: 2 },
    },
  ],
};

export function getJourneyPuzzleSprint(nodeId: string): JourneyPuzzle[] | null {
  return JOURNEY_PUZZLE_SPRINTS[nodeId] ?? null;
}

export function hasJourneyPuzzleSprint(nodeId: string): boolean {
  return (JOURNEY_PUZZLE_SPRINTS[nodeId]?.length ?? 0) > 0;
}
