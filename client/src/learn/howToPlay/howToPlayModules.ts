export type HowToPlayVisualType =
  | 'intro-beats'
  | 'turn-flow'
  | 'scoring-open-count'
  | 'doubles-compare'
  | 'win-guided';

export type HowToPlayModule = {
  id: string;
  stepLabel: string;
  title: string;
  lede: string;
  beats: string[];
  takeaway?: string;
  visual: HowToPlayVisualType;
  runNote?: string;
  isFinal?: boolean;
};

export const HOW_TO_PLAY_MATCH_TARGET = 60;

export const HOW_TO_PLAY_MODULES: HowToPlayModule[] = [
  {
    id: 'what-racehorse-is',
    stepLabel: 'Racehorse',
    title: 'What Racehorse is',
    lede: 'Fast, forced, scoring-focused dominoes built for the race to 60.',
    beats: [
      'If you can play, you must play.',
      'Score or play a double — keep your turn.',
      'Blocked? Racehorse draws for you.',
      `First to ${HOW_TO_PLAY_MATCH_TARGET} wins the match.`,
    ],
    runNote:
      'Racehorse has momentum swings. One player can go on a run, score in bursts, and take control. All it takes is one good hand to flip the race around. Always think of how you can chain moves together.',
    takeaway: 'Every hand matters. One run can flip the match.',
    visual: 'intro-beats',
  },
  {
    id: 'turn-flow',
    stepLabel: 'Turn Flow',
    title: 'Your turn flow',
    lede: 'Same rhythm every turn. Learn it once and the table stays readable.',
    beats: [
      'Can you play? If yes, you must play.',
      'Score or play a double? Your turn continues.',
      'Blocked? Racehorse draws until you can play or the pile locks.',
      'Still blocked when the pile locks? Auto-pass.',
    ],
    runNote:
      'To end the hand by going out, your final tile has to be a “dead” play. It cannot be a double, and it cannot score.',
    takeaway: 'The game handles draw and pass. You handle tempo.',
    visual: 'turn-flow',
  },
  {
    id: 'scoring-open-count',
    stepLabel: 'Scoring',
    title: 'Scoring and open count',
    lede: 'Points come from the board total — not from guessing.',
    beats: [
      'Open ends are the exposed pips still active on the chain.',
      'Add those active ends together to get the open count.',
      'If the count lands on a non-zero multiple of five, you score race points.',
      'Scoring keeps your turn alive — one good count can start a run.',
    ],
    runNote:
      'When a player goes out and ends that hand, they score the total pips left in their opponent’s hand.',
    takeaway: 'Read the board total before you commit a tile.',
    visual: 'scoring-open-count',
  },
  {
    id: 'doubles-tempo',
    stepLabel: 'Doubles',
    title: 'Doubles and tempo',
    lede: 'Doubles keep your turn alive — and change which ends count.',
    beats: [
      'An open double counts its full value in the open count.',
      'Once a double is crossed on both sides, the double itself drops out.',
      'Crossing the double opens new branches.',
      'When you play on a branch, that new open end joins the count.',
    ],
    takeaway: 'Doubles create control. Use them to keep the table yours.',
    visual: 'doubles-compare',
  },
  {
    id: 'win-guided',
    stepLabel: 'Ready',
    title: "You're ready",
    lede: "You've seen the core rules. Guided Match puts them on a real board.",
    beats: [
      'Nothing new here — just a quick checklist of what you already learned.',
      `First to ${HOW_TO_PLAY_MATCH_TARGET} race points wins the match.`,
    ],
    takeaway: 'Play Guided Match — coach prompts on every move.',
    visual: 'win-guided',
    isFinal: true,
  },
];

export const HOW_TO_PLAY_MODULE_COUNT = HOW_TO_PLAY_MODULES.length;
