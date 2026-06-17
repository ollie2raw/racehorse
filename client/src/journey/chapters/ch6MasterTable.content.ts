import type { JourneyBriefing } from '../journeyBriefings.ts';
import type { JourneyPuzzle } from '../journeyPuzzles.ts';

export const CHAPTER_6_BRIEFINGS: Record<string, JourneyBriefing> = {
  'ch6-n01': {
    nodeId: 'ch6-n01',
    eyebrow: 'Master Table Briefing',
    title: 'Master Table Briefing',
    intro:
      'Chapter 6 is sixteen seats at the Master Table. You have marched through iron miles and pressure circuits—now every node is Master Fritz, and every puzzle asks for patience over flash.',
    trailNotes: [
      'No gifts. Fritz gets nothing for free at this table.',
      'Count the safe road before you touch the board.',
      'Patience wins mid-table—hero tiles lose miles.',
      'Clean hands before the final seat and boss trial.',
      'The Master Table Crest closes Chapter 6. Racehorse Journey continues beyond it.',
    ],
    rewardLabel: 'Table Marker',
  },
  'ch6-n07': {
    nodeId: 'ch6-n07',
    eyebrow: 'Checkpoint · Patience',
    title: 'Patience Wins',
    intro:
      'You are halfway through the Master Table. The players who survive repeated Master pressure do not chase every point—they deny, close lanes, and let Fritz break first.',
    trailNotes: [
      'Quiet control beats loud scores that hand Fritz the reply.',
      'Trap or tempo reads appear in the second half of the table.',
      'The last five tiles decide more races than the first five.',
      'Three nodes remain after this checkpoint—including the boss gate.',
      'Flash play loses tables. Discipline keeps them.',
    ],
    rewardLabel: 'Patience Crest',
  },
  'ch6-n13': {
    nodeId: 'ch6-n13',
    eyebrow: 'Final Table Briefing',
    title: 'Final Table Briefing',
    intro:
      'Three nodes to the Master Table boss. You have cleared four Master seats and the patience checkpoint. The boss is Master Fritz with no margin for a free end—but this is still only Chapter 6.',
    trailNotes: [
      'Clear the clean-hands gate before the final seat.',
      'Win the final-seat trial, then the boss—not the end of Racehorse Journey.',
      'Review earlier seats if a read feels uncertain. Speed is not the goal.',
      'Many more chapters lie beyond this crest.',
      'Finish under pressure, not over it.',
    ],
    rewardLabel: 'Final Brief',
  },
};

export const CHAPTER_6_PUZZLES: Record<string, JourneyPuzzle> = {
  "ch6-n02": {
    nodeId: "ch6-n02",
    eyebrow: "Puzzle · No Gifts",
    title: "No Gifts",
    scenario:
      "You can score six and open Fritz’s preferred end—or take two and keep the lane closed.",
    prompt: "What is the no-gifts line at the Master Table?",
    choices: [
      { id: "a", label: "Take the six—Master tables reward aggression." },
      { id: "b", label: "Pass and force Fritz to break first." },
      { id: "c", label: "Open a fresh end to accelerate the race to 60." },
      { id: "d", label: "Take the modest score and deny Fritz the end he is counting on." },
    ],
    correctChoiceId: "d",
    explanation:
      "No gifts means Fritz gets nothing for free. Six points that hand him the reply is how Master tables flip in one hand.",
    rewardLabel: "No Gifts",
  },
  "ch6-n04": {
    nodeId: "ch6-n04",
    eyebrow: "Puzzle · Safe Road",
    title: "Count the Safe Road",
    scenario:
      "Two lines score: one for five and one for two. The five leaves Fritz a live reply on both ends. The two keeps one lane closed.",
    prompt: "Which is the safe road?",
    choices: [
      { id: "a", label: "Take the two and preserve the closed lane Fritz cannot exploit." },
      { id: "b", label: "Take the five—Master Fritz respects bold scoring." },
      { id: "c", label: "Pass—both lines are too risky against Master Fritz." },
      { id: "d", label: "Play whichever tile leaves the board longest." },
    ],
    correctChoiceId: "a",
    explanation:
      "Count the safe road before you commit. Five points that hand Master Fritz both ends is how disciplined leads evaporate.",
    rewardLabel: "Safe Road",
  },
  "ch6-n05": {
    nodeId: "ch6-n05",
    eyebrow: "Puzzle · Denial",
    title: "Hold Back the Score",
    scenario:
      "You lead 46–44. Fritz sits one tile from an eight-point swing if you open the 3 end.",
    prompt: "How do you hold back the score?",
    choices: [
      { id: "a", label: "Score now and accept the swing—offense protects leads." },
      { id: "b", label: "Close the 3 end first, even if it costs this turn’s points." },
      { id: "c", label: "Pass and hope Fritz breaks first." },
      { id: "d", label: "Open a new end to race to 60 before Fritz replies." },
    ],
    correctChoiceId: "b",
    explanation:
      "Hold back the score means denial before addition. Eight points Fritz can take in one reply is worth more than six you score now.",
    rewardLabel: "Score Held",
  },
  "ch6-n08": {
    nodeId: "ch6-n08",
    eyebrow: "Puzzle · Control",
    title: "Quiet Control",
    scenario:
      "You hold one tile that scores seven and opens both ends. Another scores two and keeps control.",
    prompt: "Which line shows quiet control?",
    choices: [
      { id: "a", label: "Play the seven—Master tables reward decisive strikes." },
      { id: "b", label: "Pass until Fritz is forced to open." },
      { id: "c", label: "Play the two and preserve the closed lane." },
      { id: "d", label: "Dump the heaviest tile regardless of the reply." },
    ],
    correctChoiceId: "c",
    explanation:
      "Quiet control is the boring line Master Fritz cannot punish. Seven points that hand him both ends is how tables turn.",
    rewardLabel: "Quiet Control",
  },
  "ch6-n10": {
    nodeId: "ch6-n10",
    eyebrow: "Puzzle · Trap or Tempo",
    title: "Trap or Tempo",
    scenario:
      "Fritz just played a line that scores modestly for you—but hands him tempo on the end he has been holding.",
    prompt: "When is feeding the line a trap?",
    choices: [
      { id: "a", label: "Never—modest scores are always safe against Master Fritz." },
      { id: "b", label: "Only when you are ahead in the race." },
      { id: "c", label: "When the tile is a low pip double." },
      { id: "d", label: "When Fritz owns the next reply that converts your score into his swing." },
    ],
    correctChoiceId: "d",
    explanation:
      "Trap or tempo: Fritz offers a small score to buy the reply that flips the table. Lock or redirect—not charity.",
    rewardLabel: "Tempo Read",
  },
  "ch6-n11": {
    nodeId: "ch6-n11",
    eyebrow: "Puzzle · Endgame",
    title: "The Last Five",
    scenario:
      "Race at 57–55. You hold tiles that reach 60—but one order opens Fritz’s winning reply.",
    prompt: "What does the last five demand?",
    choices: [
      { id: "a", label: "Plan the final tiles in order before you touch the board." },
      { id: "b", label: "Play the highest-scoring tile first—finish lines reward speed." },
      { id: "c", label: "Pass and let Fritz open the winning lane." },
      { id: "d", label: "Play whichever tile is heaviest to lighten the rack." },
    ],
    correctChoiceId: "a",
    explanation:
      "The last five is sequencing against Master Fritz’s likely reply. One wrong order at 57–55 loses the seat—not just the hand.",
    rewardLabel: "Five Saved",
  },
  "ch6-n14": {
    nodeId: "ch6-n14",
    eyebrow: "Puzzle · Boss Gate",
    title: "Clean Hands",
    scenario:
      "Final-table gate: you lead 59–57. Fritz holds one tile and one live end. Master discipline—not hero tiles—opens the final seat.",
    prompt: "What line enters the final seat with clean hands?",
    choices: [
      { id: "a", label: "Max score now—enter the seat ahead by ten." },
      { id: "b", label: "Seal the safe two to 60, deny the reply, and leave Fritz nothing—enter the final seat with clean hands." },
      { id: "c", label: "Pass twice and force Fritz to open." },
      { id: "d", label: "Feed the open end for speed—final seats reward aggression." },
    ],
    correctChoiceId: "b",
    explanation:
      "Clean hands at the Master Table means no gifts: close the swing lane, take the modest line, and enter the final seat with a lead Fritz cannot punish in one reply.",
    rewardLabel: "Clean Hands",
  },
};

