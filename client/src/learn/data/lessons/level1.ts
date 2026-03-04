import type { LearnBoardState, LearnLesson } from '../../engine/types';

const boardOpenEnds36: LearnBoardState = {
  mainLine: [
    { tile: [3, 4], orientation: 'horizontal-normal' },
    { tile: [4, 6], orientation: 'horizontal-normal' },
  ],
  leftEnd: 3,
  rightEnd: 6,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardOpenEnds25: LearnBoardState = {
  mainLine: [
    { tile: [2, 2], orientation: 'vertical-normal' },
    { tile: [2, 5], orientation: 'horizontal-normal' },
  ],
  leftEnd: 2,
  rightEnd: 5,
  leftEndIsDouble: true,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardScoreSetup: LearnBoardState = {
  mainLine: [
    { tile: [5, 0], orientation: 'horizontal-normal' },
    { tile: [0, 4], orientation: 'horizontal-normal' },
  ],
  leftEnd: 5,
  rightEnd: 4,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
  openEndsSum: 9,
};

const boardScoringFirstFeel: LearnBoardState = {
  mainLine: [
    { tile: [1, 4], orientation: 'horizontal-normal' },
    { tile: [4, 5], orientation: 'horizontal-normal' },
  ],
  leftEnd: 1,
  rightEnd: 5,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardScoringTenPoints: LearnBoardState = {
  mainLine: [
    { tile: [4, 3], orientation: 'horizontal-normal' },
    { tile: [3, 6], orientation: 'horizontal-normal' },
  ],
  leftEnd: 4,
  rightEnd: 6,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardScoringPredictionYes: LearnBoardState = {
  mainLine: [
    { tile: [3, 5], orientation: 'horizontal-normal' },
    { tile: [5, 2], orientation: 'horizontal-normal' },
  ],
  leftEnd: 3,
  rightEnd: 2,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardScoringPredictionNo: LearnBoardState = {
  mainLine: [
    { tile: [4, 6], orientation: 'horizontal-normal' },
    { tile: [6, 3], orientation: 'horizontal-normal' },
  ],
  leftEnd: 4,
  rightEnd: 3,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardLegalMove21: LearnBoardState = {
  mainLine: [
    { tile: [2, 3], orientation: 'horizontal-normal' },
    { tile: [3, 1], orientation: 'horizontal-normal' },
  ],
  leftEnd: 2,
  rightEnd: 1,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardOpeningStrategyDouble4: LearnBoardState = {
  mainLine: [
    { tile: [4, 4], orientation: 'vertical-normal' },
    { tile: [4, 6], orientation: 'horizontal-normal' },
  ],
  leftEnd: 4,
  rightEnd: 6,
  leftEndIsDouble: true,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardTurnContinuation: LearnBoardState = {
  mainLine: [
    { tile: [3, 5], orientation: 'horizontal-normal' },
    { tile: [5, 0], orientation: 'horizontal-normal' },
  ],
  leftEnd: 3,
  rightEnd: 0,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardDoubleHub: LearnBoardState = {
  mainLine: [
    { tile: [6, 6], orientation: 'vertical-normal' },
    { tile: [6, 2], orientation: 'horizontal-normal' },
  ],
  leftEnd: 6,
  rightEnd: 2,
  leftEndIsDouble: true,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardDoubleUncrossed: LearnBoardState = {
  mainLine: [
    { tile: [3, 3], orientation: 'vertical-normal' },
    { tile: [3, 2], orientation: 'horizontal-normal' },
  ],
  leftEnd: 3,
  rightEnd: 2,
  leftEndIsDouble: true,
  rightEndIsDouble: false,
  hubDoubles: [],
};

const boardDoubleCrossed: LearnBoardState = {
  mainLine: [
    { tile: [5, 3], orientation: 'horizontal-normal' },
    { tile: [3, 3], orientation: 'vertical-normal' },
    { tile: [3, 2], orientation: 'horizontal-normal' },
  ],
  leftEnd: 5,
  rightEnd: 2,
  leftEndIsDouble: false,
  rightEndIsDouble: false,
  hubDoubles: [],
};

export const level1Lessons: LearnLesson[] = [
  {
    id: 'l1-open-ends',
    moduleId: 'level-1',
    title: 'Open Ends',
    description: 'Identify which numbers are playable on the board right now.',
    estMinutes: 2,
    steps: [
      {
        id: 'open-ends-explain',
        type: 'explain',
        body: 'Two numbers run every turn. Left end of the chain, right end of the chain. Those are your open ends. Every legal play must match one of them. The tiles in the middle? Frozen. Irrelevant. Dead.',
        tip: 'You only need to scan the two outer ends first.',
      },
      {
        id: 'open-ends-demo-1',
        type: 'demo',
        body: 'Open ends: 3 on the left, 6 on the right. The two tiles in the middle are locked forever. Only these two numbers matter right now.',
        board: boardOpenEnds36,
        highlights: [
          { kind: 'open_end', key: 'left', label: '3' },
          { kind: 'open_end', key: 'right', label: '6' },
        ],
      },
      {
        id: 'open-ends-quiz-1',
        type: 'guided_play',
        board: boardOpenEnds36,
        hand: [
          [3, 5],
          [2, 4],
          [1, 1],
        ],
        targetTile: [3, 5],
        targetEnd: 'left',
        coachText: 'One tile in your hand connects to an open end. Tap it.',
        successText: "The 5 side is now exposed. That's your new left open end.",
      },
      {
        id: 'open-ends-summary',
        type: 'summary',
        body: "Every turn starts the same way: find the two open ends, scan your hand for a match. Do it in that order. Speed comes from the habit.",
        nextLessonId: 'l1-legal-move',
      },
    ],
  },
  {
    id: 'l1-legal-move',
    moduleId: 'level-1',
    title: 'Legal Move',
    description: 'Quickly spot what can be played now and what cannot.',
    estMinutes: 2,
    steps: [
      {
        id: 'legal-explain',
        type: 'explain',
        body: "Legal move: one side of your tile must match one open end. That's the entire rule. One side, one end. You can rotate any tile. If nothing matches, you draw. No voluntary passing — ever.",
      },
      {
        id: 'legal-guided-1',
        type: 'guided_play',
        board: boardScoreSetup,
        hand: [
          [4, 6],
          [3, 5],
          [2, 1],
        ],
        targetTile: [4, 6],
        targetEnd: 'right',
        coachText: 'Open ends are 5 and 4. One tile connects. Find it.',
        successText: '4 matched the right end. The 6 is now exposed. Legal move.',
      },
      {
        id: 'legal-guided-2',
        type: 'guided_play',
        board: boardLegalMove21,
        hand: [
          [1, 5],
          [2, 6],
          [4, 4],
        ],
        targetTile: [1, 5],
        targetEnd: 'right',
        coachText: 'New board, new ends. Two and one. Which tile connects?',
        successText: '1 matched. New right end is 5. That is a legal move.',
      },
      {
        id: 'legal-explain-draw',
        type: 'explain',
        body: "No match in your hand? You draw from the boneyard. Important: the boneyard locks when 2 tiles remain — those are gone forever, never seen. This hidden information matters late-game.",
      },
      {
        id: 'legal-summary',
        type: 'summary',
        body: "No legal move → draw. If you draw a playable tile → you must play it immediately. You cannot voluntarily pass unless the boneyard is locked and you still can't play.",
        nextLessonId: 'l1-scoring-basics',
      },
    ],
  },
  {
    id: 'l1-scoring-basics',
    moduleId: 'level-1',
    title: 'Scoring Basics',
    description: 'Understand how open-end totals create scoring opportunities.',
    estMinutes: 3,
    steps: [
      {
        id: 'scoring-explain',
        type: 'explain',
        body: "Every single tile placement either scores or it doesn't. No partial credit. No rounding. The open ends must sum to an exact multiple of 5 — 5, 10, 15, 20. That's the engine this entire game runs on. Miss by 1 and you get nothing. Let's feel what scoring actually means.",
      },
      {
        id: 'scoring-first-feel',
        type: 'guided_play',
        board: boardScoringFirstFeel,
        hand: [
          [5, 4],
          [5, 5],
          [1, 2],
        ],
        targetTile: [5, 4],
        targetEnd: 'right',
        coachText: 'Board shows open ends 1 and 5. One tile in your hand makes the sum hit a multiple of 5. The glowing tile is your move. Tap it.',
        successText: 'New open ends: 1 + 4 = 5. Exactly divisible by 5. That\'s 1 point — and your turn continues.',
        scoreFlash: 1,
        chainContinues: false,
      },
      {
        id: 'scoring-explain-2',
        type: 'explain',
        body: "5 ÷ 5 = 1 point. 10 ÷ 5 = 2 points. 15 ÷ 5 = 3 points. 20 ÷ 5 = 4 points. That's every score you'll ever see in a single play. The math takes 1 second once you've trained it. Let's go bigger.",
      },
      {
        id: 'scoring-ten-points',
        type: 'guided_play',
        board: boardScoringTenPoints,
        hand: [
          [6, 1],
          [6, 4],
          [3, 0],
        ],
        targetTile: [6, 1],
        targetEnd: 'right',
        coachText: "Open ends 4 and 6 already sum to 10 — your opponent just scored. Now find the tile that scores for YOU.",
        successText:
          'New ends: 4 + 1 = 5. Another point. See how fast the chain moves?',
        scoreFlash: 1,
        chainContinues: false,
      },
      {
        id: 'scoring-prediction-1',
        type: 'prediction',
        board: boardScoringPredictionYes,
        question: 'Open ends are 3 and 2. Sum = 5. Your opponent just placed the [5|2] tile you see here. Did they score, and does their turn continue?',
        tileToConsider: [5, 2],
        targetEnd: 'right',
        correctAnswer: 'yes',
        correctFeedback:
          'Correct. 3+2=5 is exactly 1 point — and since they scored, they MUST keep playing if a legal move exists. Scoring plays never end your turn automatically.',
        wrongFeedback:
          '3 + 2 = 5. That\'s exactly divisible by 5 — 1 point. And the rule is: score or double means your turn continues.',
      },
      {
        id: 'scoring-prediction-2',
        type: 'prediction',
        board: boardScoringPredictionNo,
        question: 'Open ends 4 and 3. Sum = 7. Does this board score?',
        tileToConsider: [6, 3],
        targetEnd: 'right',
        correctAnswer: 'no',
        correctFeedback:
          "Right. 7 isn't divisible by 5. Zero points, turn ends. One pip away from scoring — that gap matters. This is why you calculate BEFORE you place.",
        wrongFeedback:
          '7 ÷ 5 = 1.4. Not a whole number. Only exact multiples count: 5, 10, 15, 20. One off = nothing.',
      },
      {
        id: 'scoring-summary',
        type: 'summary',
        body: "Sum the open ends. Divide by 5. Only exact multiples score. 5=1pt, 10=2pts, 15=3pts, 20=4pts. The player who calculates this before every move — automatically, without thinking — controls the game. That's what you're building right now.",
        nextLessonId: 'l1-doubles-crossing',
      },
    ],
  },
  {
    id: 'l1-doubles-crossing',
    moduleId: 'level-1',
    title: 'Doubles & Branching',
    description: 'See how doubles score before crossing, then stop counting after crossing.',
    estMinutes: 3,
    steps: [
      {
        id: 'double-explain',
        type: 'explain',
        body: 'Doubles change everything. Play a double and it sits sideways — creating two new branches. The board now has 3 or 4 open ends. More ends means more plays and more scoring combinations.',
      },
      {
        id: 'double-demo-uncrossed',
        type: 'demo',
        body: 'Double-3 is uncrossed here. It contributes 6 to the scoring sum, not 3 — both halves count until something is played off each branch. Right end is 2. Total sum: 8. No score yet.',
        board: boardDoubleUncrossed,
        highlights: [
          { kind: 'double', key: 'double-3-3', label: 'Uncrossed double' },
          { kind: 'open_end', key: 'left', label: '3' },
          { kind: 'open_end', key: 'right', label: '2' },
        ],
      },
      {
        id: 'double-explain-uncrossed',
        type: 'explain',
        body: 'Uncrossed double = both halves count toward scoring sum. Double-3 uncrossed contributes 6. Play off one branch and that tip becomes live. Play off both branches and the double goes dark.',
      },
      {
        id: 'double-prediction-before-cross',
        type: 'prediction',
        board: boardDoubleUncrossed,
        question: 'Double-3 uncrossed counts as 6, plus right end 2 makes 8. Does this board score?',
        tileToConsider: [3, 3],
        targetEnd: 'left',
        correctAnswer: 'no',
        correctFeedback: 'Right — 8 is not divisible by 5. No score. Only exact multiples count.',
        wrongFeedback: '6 + 2 = 8. Not divisible by 5 exactly. No score. Only 5, 10, 15, 20 count.',
      },
      {
        id: 'double-demo-crossed',
        type: 'demo',
        body: 'Now both branches of the double are crossed. The double-3 is dead — contributes 0. Only the tips of each branch count. Left end: 5. Right end: 2. Sum: 7. No score.',
        board: boardDoubleCrossed,
        highlights: [
          { kind: 'double', key: 'double-3-3-crossed', label: 'Crossed double' },
          { kind: 'open_end', key: 'left', label: '5' },
          { kind: 'open_end', key: 'right', label: '2' },
        ],
      },
      {
        id: 'double-summary',
        type: 'summary',
        body: "Uncrossed = counts double. One side crossed = that tip is live, other half still counts. Both crossed = double is invisible. See this in one glance and you'll never miscalculate again.",
        nextLessonId: 'l1-opening-strategy',
      },
    ],
  },
  {
    id: 'l1-opening-strategy',
    moduleId: 'level-1',
    title: 'Opening Strategy',
    description: 'See why the first move shapes the whole hand.',
    estMinutes: 4,
    steps: [
      {
        id: 'opening-rule',
        type: 'explain',
        body: "The opening move is not random. You MUST open with a tile that either scores immediately or is a double. No exceptions. This one rule forces every opening to mean something — there's no safe throwaway first move in Racehorse.",
      },
      {
        id: 'opening-scoring-path',
        type: 'explain',
        body: 'Path one: open with a scoring tile. If you hold [5|0], [2|3], [4|6], or any tile whose pips sum to 5 or a multiple — play it. You score immediately and your turn continues. You are already building a chain on move one.',
      },
      {
        id: 'opening-double-path',
        type: 'explain',
        body: 'Path two — the elite move: open with a double you have NO backup for. You hold [4|4] but no other 4s. Play it. It sends you straight to the boneyard. You will draw 1, 2, maybe 3 tiles. More tiles = more scoring chains = more power. This ONLY works as an opening move — mid-game, a lonely double is a liability.',
      },
      {
        id: 'opening-dont-cross',
        type: 'explain',
        body: "Once a double is on the board, there are two live branches. Pro rule: don't cross your opponent's opening double. When someone opens with a double, they almost always have more of that number. Crossing it opens both branches — giving every [4|x] tile in their hand two new places to chain. You just handed them the board.",
      },
      {
        id: 'opening-prediction',
        type: 'prediction',
        board: boardOpeningStrategyDouble4,
        question: "Your opponent opened with double-4, then played [4|6] off one branch. The double-4 is still uncrossed — it counts as 8. Right end is 6. You hold [4|2]. Playing it crosses the double and opens both branches. Is this a good play?",
        tileToConsider: [4, 2],
        targetEnd: 'left',
        correctAnswer: 'no',
        correctFeedback: "Smart. Crossing opens both double-4 branches. If they have [4|3], [4|5], [4|1] in their hand — and they probably do since they opened with the double — you just gave each of those tiles two new homes. Hold back unless you're forced.",
        wrongFeedback: "Crossing it opens BOTH double-4 branches. They opened with that double for a reason — they likely have more 4s. Now every [4|x] they hold can chain off two new lines. That one play could cost you the hand.",
      },
      {
        id: 'opening-summary',
        type: 'summary',
        body: "Open with a scoring tile or a strategic double to draw. Don't cross your opponent's opening double — it probably feeds their hand. These two decisions happen in the first 3 moves of every hand. Get them right consistently and you'll win more than you lose.",
        nextLessonId: 'l1-turn-continuation',
      },
    ],
  },
  {
    id: 'l1-turn-continuation',
    moduleId: 'level-1',
    title: 'Turn Continuation',
    description: 'Understand how scoring and doubles keep your turn alive.',
    estMinutes: 3,
    steps: [
      {
        id: 'continuation-rule',
        type: 'explain',
        body: "Here's the rule that separates Racehorse from every other domino game: score or play a double and your turn doesn't end. You keep going. You must keep going if a legal move exists. Turn only ends when you play something that neither scores nor is a double — or when you have no legal move and nothing left to draw.",
      },
      {
        id: 'continuation-chain',
        type: 'explain',
        body: 'What this means in practice: a single hand can chain 5, 6, 7 tiles in one turn. Score → play again. Score again → play again. Each tile sets up the next open end. The board is constantly changing and your hand is your ammunition. More tiles = more potential chains.',
      },
      {
        id: 'continuation-draw',
        type: 'explain',
        body: "Drawing is often the RIGHT move. If you can't score but you can draw — draw. Each tile you add to your hand is another potential chain link. The player holding 12 tiles with good scoring reads will destroy the player who tried to go out with 4 tiles. Don't treat drawing as failure. Treat it as loading your weapon.",
      },
      {
        id: 'continuation-prediction-1',
        type: 'prediction',
        board: boardTurnContinuation,
        question: "You just played [5|0]. Open ends are now 3 and 0. Sum = 3. [5|0] is not a double. Does your turn continue?",
        tileToConsider: [5, 0],
        targetEnd: 'right',
        correctAnswer: 'no',
        correctFeedback: "Correct. Sum is 3 — not a multiple of 5, no score. And [5|0] isn't a double. Both conditions for continuation failed. Turn ends. Your opponent plays.",
        wrongFeedback: "Check both: did it score? 3+0=3, not divisible by 5 — no. Is it a double? [5|0] has different pips — no. Neither condition = turn ends.",
      },
      {
        id: 'continuation-prediction-2',
        type: 'prediction',
        board: boardLegalMove21,
        question: "You just played [3|2]. Open ends are 2 and 2. Sum = 4. Not a score. But wait — you still have [2|5] in your hand. What happens next?",
        tileToConsider: [3, 2],
        targetEnd: 'right',
        correctAnswer: 'no',
        correctFeedback: "Right — sum 4 doesn't score and [3|2] isn't a double, so your turn ends regardless of what's in your hand. Turn continuation is triggered by the RESULT of the play, not by what you're holding.",
        wrongFeedback: "Having a playable tile doesn't extend your turn — only scoring or playing a double does. Sum was 4 (not a multiple of 5) and the tile wasn't a double. Turn ends.",
      },
      {
        id: 'continuation-summary',
        type: 'summary',
        body: "Score or double → keep playing. No legal move → draw one tile and play it if you can. Boneyard locked AND no move → only then do you pass. This is the entire turn flow. Chain it together and you'll understand why 10-point turns aren't just possible — they're the goal.",
        nextLessonId: 'l1-speed-drill',
      },
    ],
  },
  {
    id: 'l1-speed-drill',
    moduleId: 'level-1',
    title: 'Speed Drill: Legal Moves',
    description: 'Build speed by snapping to any playable tile before time runs out.',
    estMinutes: 3,
    steps: [
      {
        id: 'speed-drill-explain',
        type: 'explain',
        body: 'You know the rules. Now build the reflexes. Spot the legal tile before the timer hits zero. Three rounds. Go.',
        tip: 'You only need one legal tile per round.',
      },
      {
        id: 'speed-drill-main',
        type: 'drill_tile_speed',
        prompt: "Speed round. Find the legal play before time runs out. Open ends are live — don't think, just read.",
        board: boardOpenEnds25,
        rounds: 8,
        secondsPerRound: 5,
        hands: [
          [
            { low: 1, high: 1 },
            { low: 0, high: 2 },
            { low: 3, high: 4 },
            { low: 6, high: 6 },
            { low: 1, high: 4 },
            { low: 0, high: 0 },
          ],
          [
            { low: 2, high: 3 },
            { low: 1, high: 6 },
            { low: 0, high: 4 },
            { low: 3, high: 3 },
            { low: 4, high: 6 },
            { low: 0, high: 1 },
          ],
          [
            { low: 1, high: 3 },
            { low: 4, high: 4 },
            { low: 5, high: 6 },
            { low: 0, high: 0 },
            { low: 1, high: 1 },
            { low: 3, high: 6 },
          ],
          [
            { low: 0, high: 6 },
            { low: 2, high: 2 },
            { low: 1, high: 4 },
            { low: 3, high: 3 },
            { low: 0, high: 1 },
            { low: 4, high: 6 },
          ],
          [
            { low: 1, high: 6 },
            { low: 3, high: 4 },
            { low: 5, high: 5 },
            { low: 0, high: 3 },
            { low: 1, high: 2 },
            { low: 4, high: 4 },
          ],
          [
            { low: 0, high: 1 },
            { low: 3, high: 3 },
            { low: 2, high: 6 },
            { low: 4, high: 6 },
            { low: 1, high: 1 },
            { low: 0, high: 4 },
          ],
          [
            { low: 0, high: 0 },
            { low: 1, high: 3 },
            { low: 4, high: 5 },
            { low: 6, high: 6 },
            { low: 3, high: 4 },
            { low: 1, high: 1 },
          ],
          [
            { low: 0, high: 6 },
            { low: 1, high: 4 },
            { low: 2, high: 4 },
            { low: 3, high: 6 },
            { low: 0, high: 1 },
            { low: 4, high: 4 },
          ],
        ],
        hints: {
          level1: 'Match open ends quickly: look for 2 or 5.',
        },
      },
      {
        id: 'speed-drill-summary',
        type: 'summary',
        body: 'That is how speed is built: ends first, hand second, no hesitation.',
        nextLessonId: 'l1-final-challenge',
      },
    ],
  },
  {
    id: 'l1-final-challenge',
    moduleId: 'level-1',
    title: 'Level 1 Final Challenge',
    description: 'Prove you understand the fundamentals.',
    estMinutes: 4,
    steps: [
      {
        id: 'final-score-check',
        type: 'quiz_score_sum',
        prompt: "Final test. Mixed board — doubles, branches, multiple open ends. What's the correct play and does it score?",
        board: boardDoubleUncrossed,
        choices: [6, 7, 8, 10],
        correct: 8,
        correctFeedback: "Sharp. You're reading the board like a player now.",
        wrongFeedback: 'Count every open end — including uncrossed double halves. Add them all. Divide by 5.',
        hints: {
          level1: 'This double is not crossed yet, so it still counts.',
          level2: 'highlightOpenEnds',
          level3: 'revealAnswer',
        },
      },
      {
        id: 'final-legal-move-check',
        type: 'quiz_tile',
        prompt: 'Pressure is on. Pick any tile that plays right now.',
        board: boardOpenEnds36,
        hand: [
          { low: 1, high: 1 },
          { low: 3, high: 5 },
          { low: 2, high: 2 },
          { low: 0, high: 6 },
          { low: 4, high: 4 },
          { low: 1, high: 2 },
        ],
        correctMode: 'anyPlayable',
        correctFeedback: 'Correct. Only tiles touching 3 or 6 are playable here.',
        wrongFeedback: 'That tile does not match either open end (3 or 6).',
        hints: {
          level1: 'Read the two open ends first.',
          level2: 'highlightPlayable',
          level3: 'revealAnswer',
        },
      },
      {
        id: 'final-crossed-double-reminder',
        type: 'demo',
        body: 'Remember: crossed doubles no longer count toward score.',
        board: boardDoubleCrossed,
        highlights: [
          { kind: 'double', key: 'final-crossed-double', label: 'Crossed double' },
          { kind: 'open_end', key: 'left', label: '5' },
          { kind: 'open_end', key: 'right', label: '2' },
        ],
      },
      {
        id: 'final-speed-drill',
        type: 'drill_tile_speed',
        prompt: 'Final speed round: click any playable tile before time runs out.',
        board: boardOpenEnds36,
        rounds: 4,
        secondsPerRound: 4,
        hands: [
          [
            { low: 1, high: 1 },
            { low: 3, high: 5 },
            { low: 2, high: 4 },
            { low: 0, high: 1 },
            { low: 4, high: 5 },
            { low: 6, high: 6 },
          ],
          [
            { low: 2, high: 2 },
            { low: 0, high: 3 },
            { low: 1, high: 4 },
            { low: 5, high: 5 },
            { low: 0, high: 1 },
            { low: 4, high: 4 },
          ],
          [
            { low: 6, high: 2 },
            { low: 1, high: 1 },
            { low: 0, high: 4 },
            { low: 5, high: 5 },
            { low: 2, high: 4 },
            { low: 0, high: 0 },
          ],
          [
            { low: 1, high: 2 },
            { low: 3, high: 4 },
            { low: 2, high: 5 },
            { low: 0, high: 1 },
            { low: 4, high: 4 },
            { low: 6, high: 1 },
          ],
        ],
        hints: {
          level1: 'Look for 3 or 6 immediately.',
        },
      },
      {
        id: 'final-level1-complete',
        type: 'summary',
        body: "You know how open ends work. You know how scoring works. You know how doubles transform the board. That's the foundation. Level 2 is where strategy starts — and you're ready.",
      },
    ],
  },
];
