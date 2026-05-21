export type HowToPlayVisualType =
  | 'intro-beats'
  | 'turn-flow'
  | 'scoring-open-count'
  | 'doubles-compare'
  | 'chains-runs'
  | 'win-guided';

export type HowToPlayModule = {
  id: string;
  stepLabel: string;
  title: string;
  lede: string;
  beats: string[];
  takeaway: string;
  visual: HowToPlayVisualType;
  runNote?: string;
  isFinal?: boolean;
};

export const HOW_TO_PLAY_MATCH_TARGET = 60;
export const HOW_TO_PLAY_BONEYARD_DRAWABLE = 12;
export const HOW_TO_PLAY_BONEYARD_LOCKED = 2;

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
      'Racehorse has momentum swings. One player can go on a run, score in bursts, and take control. All it takes is one good hand to flip the race around. Think about how you can chain moves together.',
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
    takeaway: 'The game handles draw and pass. You handle tempo.',
    visual: 'turn-flow',
  },
  {
    id: 'scoring-open-count',
    stepLabel: 'Scoring',
    title: 'Scoring and open count',
    lede: 'Points come from the board total — not from guessing.',
    beats: [
      'Open ends are the exposed pips on the chain.',
      'Open count = sum of every active scoring end.',
      'Non-zero multiples of five score race points (÷ 5).',
      'A scoring play often sparks a short burst — mini-runs that swing momentum.',
    ],
    takeaway: 'Read the board total before you commit a tile.',
    visual: 'scoring-open-count',
  },
  {
    id: 'doubles-tempo',
    stepLabel: 'Doubles',
    title: 'Doubles and tempo',
    lede: 'Doubles extend your turn and let you control the table — not just survive it.',
    beats: [
      'Any double keeps your turn going.',
      'Open doubles count fully in open count.',
      'Crossed doubles branch the board; only real tips count.',
      'Tempo beats raw legality — doubles are how you keep the table.',
    ],
    takeaway: 'Doubles create control. Use them to keep the table yours.',
    visual: 'doubles-compare',
  },
  {
    id: 'chains-runs',
    stepLabel: 'Pressure',
    title: 'Draw pressure, chains, and runs',
    lede: 'Racehorse is a momentum game. One hand can erase a deficit.',
    beats: [
      'Forced draws are not always bad — more tiles can mean more power.',
      'Think in chains: what does this tile open next?',
      'Narrow the board and pressure your opponent into narrow draws.',
      'A hot run can score in bunches; the next hand can swing the race back.',
    ],
    runNote:
      'Like basketball: score in bursts, hold the turn, build a run — then one swing hand flips the match.',
    takeaway: 'Think one move ahead. Pressure creates runs.',
    visual: 'chains-runs',
  },
  {
    id: 'win-guided',
    stepLabel: 'Ready',
    title: 'Win the hand',
    lede: 'You can go out or win on leftover pips. Every pip still moves the race.',
    beats: [
      'Go out: play your last tile; opponent pips convert (÷ 5, rounded).',
      'Locked boneyard: small pip swings matter near the target.',
      'Blocked endings still push the score — nothing is wasted.',
      'Guided Match walks you through a full coached hand, move by move.',
    ],
    takeaway: 'You know the rules. Now learn the rhythm in a real hand.',
    visual: 'win-guided',
    isFinal: true,
  },
];

export const HOW_TO_PLAY_MODULE_COUNT = HOW_TO_PLAY_MODULES.length;
