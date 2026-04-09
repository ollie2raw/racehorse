import type { LessonScenario } from '../types';
import type { Tile, Move } from '../../types';

function tileEquals(a: Tile, b: Tile): boolean {
  return (a.high === b.high && a.low === b.low) || (a.high === b.low && a.low === b.high);
}

export const LESSONS: LessonScenario[] = [
  {
    id: 'matching-basics',
    title: 'Matching a Tile',
    type: 'guided_tutorial',
    concepts: ['matching'],
    setup: {
      boardTiles: [
        { tile: { high: 6, low: 4 }, position: 'left' }
      ],
      playerHand: [
        { high: 4, low: 2 },
        { high: 1, low: 1 },
        { high: 0, low: 0 }
      ],
      botHand: [],
      boneyard: [],
      currentPlayer: 'you'
    },
    script: [
      {
        expectedMove: {
          tile: { high: 4, low: 2 },
          position: 'right'
        },
        instructionText: "Look at the board. There is a 6-4 tile. To play, you must match one of the ends. You have a 4-2 in your hand. Try matching the 4!",
        successText: "Great job! You matched the 4. Now the board ends are 6 and 2.",
        highlightHandTile: { high: 4, low: 2 },
        highlightBoardEnds: [4],
        actionCue: "Tap the 4-2 tile",
        mistakeHandlers: [
          {
            condition: (move: Move) => move.tile ? !tileEquals(move.tile, { high: 4, low: 2 }) : false,
            feedbackText: "That tile doesn't match the 4. Look for the tile with 4 dots on one side."
          },
          {
            condition: (move: Move) => move.position === 'left',
            feedbackText: "Try playing it on the right side to match the 4. The left side is a 6!"
          }
        ]
      }
    ]
  },
  {
    id: 'scoring-first-5',
    title: 'Your First Score',
    type: 'guided_tutorial',
    concepts: ['scoring_5'],
    setup: {
      boardTiles: [
        { tile: { high: 3, low: 2 }, position: 'left' }
      ],
      playerHand: [
        { high: 3, low: 3 },
        { high: 5, low: 2 },
        { high: 1, low: 2 }
      ],
      botHand: [],
      boneyard: [],
      currentPlayer: 'you'
    },
    script: [
      {
        expectedMove: {
          tile: { high: 3, low: 3 },
          position: 'left'
        },
        instructionText: "In this game, you score points if the ends of the board add up to a multiple of 5. Right now the ends are 3 and 2 (Sum: 5). If you play the 3-3 double on the 3, the ends will be 3 and 2... wait, that's still 5! Try playing the 3-3 double on the left.",
        successText: "Exactly! 3 + 2 = 5. You just scored 5 points! (Doubles count as their total value if they are the only tile, but here it just matches the end).",
        mistakeHandlers: [
          {
            condition: (move: Move) => move.tile ? tileEquals(move.tile, { high: 5, low: 2 }) : false,
            feedbackText: "The 5-2 is a good tile, but it won't score right now. Try the 3-3 instead."
          }
        ]
      }
    ]
  },
  {
    id: 'doubles-intro',
    title: 'The Power of Doubles',
    type: 'guided_tutorial',
    concepts: ['doubles'],
    setup: {
      boardTiles: [
        { tile: { high: 5, low: 0 }, position: 'left' }
      ],
      playerHand: [
        { high: 5, low: 5 },
        { high: 2, low: 2 },
        { high: 1, low: 3 }
      ],
      botHand: [],
      boneyard: [],
      currentPlayer: 'you'
    },
    script: [
      {
        expectedMove: {
          tile: { high: 5, low: 5 },
          position: 'left'
        },
        instructionText: "Doubles are special. They are played crosswise and count as their total value for scoring. Right now, the ends are 5 and 0 (Sum: 5). If you play the 5-5 double on the 5, the ends will be 10 and 0. That's a score of 10! Try playing the 5-5 double on the left.",
        successText: "Excellent! 5+5 = 10. Doubles count as their full value when they are at the end of a line. They also allow you to start new branches later!",
        mistakeHandlers: []
      }
    ]
  },
  {
    id: 'scoring-drill-1',
    title: 'Scoring Practice 1',
    type: 'practice_drill',
    concepts: ['scoring_5'],
    setup: {
      boardTiles: [
        { tile: { high: 5, low: 3 }, position: 'left' }
      ],
      playerHand: [
        { high: 3, low: 2 },
        { high: 6, low: 0 },
        { high: 4, low: 4 }
      ],
      botHand: [],
      boneyard: [],
      currentPlayer: 'you'
    },
    drillGoal: 'max_score'
  },
  {
    id: 'scoring-drill-2',
    title: 'Scoring Practice 2',
    type: 'practice_drill',
    concepts: ['scoring_5'],
    setup: {
      boardTiles: [
        { tile: { high: 4, low: 1 }, position: 'left' }
      ],
      playerHand: [
        { high: 1, low: 4 },
        { high: 6, low: 4 },
        { high: 3, low: 3 }
      ],
      botHand: [],
      boneyard: [],
      currentPlayer: 'you'
    },
    drillGoal: 'max_score'
  }
];
