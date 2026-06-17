export interface JourneyPuzzleChoice {
  id: string;
  label: string;
}

export interface JourneyPuzzle {
  nodeId: string;
  eyebrow: string;
  title: string;
  scenario: string;
  prompt: string;
  choices: JourneyPuzzleChoice[];
  correctChoiceId: string;
  explanation: string;
  rewardLabel: string;
}

export const JOURNEY_PUZZLES: Record<string, JourneyPuzzle> = {
  "ch1-n03": {
    nodeId: "ch1-n03",
    eyebrow: "Puzzle · Open Ends",
    title: "Open Ends Trial",
    scenario:
      "The board shows open ends of 3 and 5. You hold 3-4 and 5-6. Fritz leads the race to 60 by eight points, but you still have the lead this hand.",
    prompt: "Before you play, what is the soundest principle?",
    choices: [
      { id: "a", label: "Read both open ends. They are scoring lanes, not just exits." },
      { id: "b", label: "Strike fast on 3-4—one big score closes the gap." },
      { id: "c", label: "Pass and wait for Fritz to open a mistake." },
      { id: "d", label: "Play the tile with the highest pip total." },
    ],
    correctChoiceId: "a",
    explanation:
      "Two live ends mean two ways to score and two ways to be punished. Count both before you commit. The right tile keeps pressure on Fritz without handing him the reply he wants.",
    rewardLabel: "Open Eye",
  },
  "ch1-n08": {
    nodeId: "ch1-n08",
    eyebrow: "Puzzle · Tactical Gate",
    title: "Puzzle Gate",
    scenario:
      "The board is locked on 4s and 6s. You hold 4-6 plus one other playable tile. Fritz has been quiet—likely holding a reply, not offering charity.",
    prompt: "This gate decides whether you enter the late trail with tempo or on your heels. What line do you take?",
    choices: [
      { id: "a", label: "Dump 4-6 now and hope the board stays closed." },
      { id: "b", label: "Feed the line Fritz wants—speed beats caution here." },
      { id: "c", label: "Play the tile that keeps your options and denies Fritz a free end." },
      { id: "d", label: "Pass. A tight board always breaks in your favor." },
    ],
    correctChoiceId: "c",
    explanation:
      "A gate puzzle is about permission, not flash. The best play preserves your reply while limiting what Fritz can snap back. Do not unlock the end he has been waiting for.",
    rewardLabel: "Gate Cleared",
  },
  "ch1-n09": {
    nodeId: "ch1-n09",
    eyebrow: "Puzzle · Pressure Hand",
    title: "Pressure Hand",
    scenario:
      "Race to 60: you sit at 52, Fritz at 48. You can lock a safe two-point line or extend for a larger swing—but give Fritz one more reply.",
    prompt: "With Elite Warmup ahead, how do you handle this pressure hand?",
    choices: [
      { id: "a", label: "Press for the swing. Eight points back is still a fight." },
      { id: "b", label: "Pass and force Fritz to break the board first." },
      { id: "c", label: "Play whichever tile scores fastest, regardless of reply." },
      { id: "d", label: "Lock the safe line. Four points from 60 is not the hand to gamble." },
    ],
    correctChoiceId: "d",
    explanation:
      "Late-race tempo favors the player who needs fewer points. With 52 on the board, variance is the enemy. Secure the line that reaches 60 without handing Fritz a comeback end.",
    rewardLabel: "Ice Veins",
  },
  "ch2-n02": {
    nodeId: "ch2-n02",
    eyebrow: "Puzzle · No Free End",
    title: "No Free End",
    scenario:
      "You lead 44–40 in the race to 60. The board shows open ends of 2 and 6. You can play 2-5 and leave a clean 6 end for Fritz—or play 5-6 and open a fresh 2 end he has been feeding all hand.",
    prompt: "Fritz is one good reply from tying the race. What is the soundest High Line principle?",
    choices: [
      { id: "a", label: "Open the 2 end—speed closes the gap before Fritz can answer." },
      { id: "b", label: "Deny the free end Fritz wants. Play the tile that limits his reply." },
      { id: "c", label: "Pass and let Fritz break the board first." },
      { id: "d", label: "Play whichever tile scores the most pips this turn." },
    ],
    correctChoiceId: "b",
    explanation:
      "On the High Line, a free end is a gift. The winning move closes Fritz’s lane without handing him the initiative he has been setting up. Score denial beats speed when the race is this tight.",
    rewardLabel: "Closed Lane",
  },
  "ch2-n03": {
    nodeId: "ch2-n03",
    eyebrow: "Puzzle · Board Read",
    title: "Count Before Contact",
    scenario:
      "Open ends show 1 and 4. You hold 1-3 and 3-4. Fritz sits at 51, you at 49. One sequence reaches 60; the other feeds him a reply on the 4 end.",
    prompt: "Before you touch the board, what must you do?",
    choices: [
      { id: "a", label: "Play 1-3 immediately—low pips keep the hand safe." },
      { id: "b", label: "Play 3-4 to force a big swing this hand." },
      { id: "c", label: "Count both ends and trace Fritz’s likely reply before you commit." },
      { id: "d", label: "Pass. Tight races always break in your favor." },
    ],
    correctChoiceId: "c",
    explanation:
      "Contact without a count is how free ends appear. Trace both sequences: which end does Fritz need, and which tile leaves him nothing useful? The right read beats the fast play.",
    rewardLabel: "Cold Read",
  },
  "ch2-n05": {
    nodeId: "ch2-n05",
    eyebrow: "Puzzle · Tempo Trade",
    title: "Pressure Exchange",
    scenario:
      "You can lock a safe two-point line or extend for five—but Fritz gets one more reply on the 3 end he has been holding.",
    prompt: "When do you accept the pressure exchange?",
    choices: [
      { id: "a", label: "Always press for the larger swing—five points changes the race." },
      { id: "b", label: "Never trade—safe lines win every High Line hand." },
      { id: "c", label: "Trade whenever you are behind in the race to 60." },
      { id: "d", label: "Trade only when your reply controls the next end after Fritz answers." },
    ],
    correctChoiceId: "d",
    explanation:
      "A pressure exchange is a contract: you give Fritz a reply only when your next move still owns tempo. If his answer opens the end you feared, the trade was a gift.",
    rewardLabel: "Even Trade",
  },
  "ch2-n08": {
    nodeId: "ch2-n08",
    eyebrow: "Puzzle · Double Edge",
    title: "Double-Edge Decision",
    scenario:
      "You hold 4-6. Playing it opens both a 4 end Fritz has been hunting and a 6 end you need to keep closed. Your other tile is playable but scores less this turn.",
    prompt: "Which line respects the double-edge problem?",
    choices: [
      { id: "a", label: "Play the safer tile even if it scores less, if it leaves only one live end." },
      { id: "b", label: "Play 4-6 now—maximum score wins tight boards." },
      { id: "c", label: "Pass and force Fritz to play into the double edge." },
      { id: "d", label: "Always play the highest pip tile when within ten of 60." },
    ],
    correctChoiceId: "a",
    explanation:
      "A double-edge tile opens two threats at once. The High Line rewards the play that leaves a single end you can defend—not the play that scores fastest while handing Fritz two lanes.",
    rewardLabel: "Edge Sense",
  },
  "ch2-n10": {
    nodeId: "ch2-n10",
    eyebrow: "Puzzle · Endgame Gate",
    title: "Endgame Gate",
    scenario:
      "Race to 60: you sit at 57, Fritz at 54. You can reach 60 this turn but leave a 5 end Fritz can hit for the win next reply.",
    prompt: "This gate decides whether you enter the boss trail ahead or on your heels. What do you do?",
    choices: [
      { id: "a", label: "Take 60 now—endgame gates reward aggression." },
      { id: "b", label: "Play the line that reaches 60 without giving Fritz a winning reply." },
      { id: "c", label: "Pass. Fritz will break first under endgame pressure." },
      { id: "d", label: "Score three points and pass the risk to the next hand." },
    ],
    correctChoiceId: "b",
    explanation:
      "An endgame gate is not about reaching 60 first—it is about reaching 60 and still standing. The winning move closes the reply Fritz needs to steal the race on the next turn.",
    rewardLabel: "Gate Key",
  },
  "ch3-n02": {
    nodeId: "ch3-n02",
    eyebrow: "Puzzle · Recovery",
    title: "Bad Deal Recovery",
    scenario:
      "Your opening hand has low connectivity and no strong double. Fritz leads the race 12–8 after two hands. The board is still open.",
    prompt: "What is the soundest recovery principle on a long march?",
    choices: [
      { id: "a", label: "Force the highest score this hand—falling behind demands speed." },
      { id: "b", label: "Pass until the board breaks in your favor." },
      { id: "c", label: "Play for tempo and board control; one bad deal is not the match." },
      { id: "d", label: "Dump heavy tiles fast, even if Fritz gets the reply he wants." },
    ],
    correctChoiceId: "c",
    explanation:
      "Recovery means rebuilding initiative without gifting Fritz a swing. A weak deal is one hand—not permission to unravel the race with desperate scoring.",
    rewardLabel: "Steady Recovery",
  },
  "ch3-n04": {
    nodeId: "ch3-n04",
    eyebrow: "Puzzle · Tempo",
    title: "Tempo or Points",
    scenario:
      "You can score four points now and leave Fritz a live 6 end—or play safe for two and keep the reply.",
    prompt: "On a long march, which line usually wins?",
    choices: [
      { id: "a", label: "Always take the points. The race to 60 rewards speed." },
      { id: "b", label: "Pass. Safe lines always break your way eventually." },
      { id: "c", label: "Pick whichever tile has the highest pip total." },
      { id: "d", label: "Take the line that wins the hand and limits Fritz’s next scoring lane." },
    ],
    correctChoiceId: "d",
    explanation:
      "Tempo and points align on some boards—but not all. The Long March punishes four-point swings that hand Fritz a free reply on the end he has been counting.",
    rewardLabel: "Hand Discipline",
  },
  "ch3-n05": {
    nodeId: "ch3-n05",
    eyebrow: "Puzzle · Draw Discipline",
    title: "No Panic Draw",
    scenario:
      "You cannot play. The boneyard is active and Fritz leads by six. You feel one draw away from a playable tile.",
    prompt: "How do you handle the draw without panic?",
    choices: [
      { id: "a", label: "Draw once, reassess the board, and avoid unlocking Fritz’s best end." },
      { id: "b", label: "Draw aggressively—speed matters more than board shape." },
      { id: "c", label: "Keep passing until Fritz is forced to break." },
      { id: "d", label: "Draw until you can score, regardless of what opens." },
    ],
    correctChoiceId: "a",
    explanation:
      "Each draw changes the pip count and the ends. Panic draws feed Fritz the board he wants. One disciplined pull beats three desperate ones.",
    rewardLabel: "Calm Draw",
  },
  "ch3-n08": {
    nodeId: "ch3-n08",
    eyebrow: "Puzzle · Score Denial",
    title: "Deny the Swing",
    scenario:
      "Fritz sits at 48, you at 44. He can hit a six-point swing if you open the 3 end he has been holding.",
    prompt: "What is the denial play?",
    choices: [
      { id: "a", label: "Score now and accept the swing—offense closes gaps." },
      { id: "b", label: "Play the tile that scores modestly and closes the 3 end Fritz needs." },
      { id: "c", label: "Pass and hope Fritz breaks first." },
      { id: "d", label: "Open a fresh end to accelerate your own race to 60." },
    ],
    correctChoiceId: "b",
    explanation:
      "Denial is subtraction. The swing Fritz needs is often more valuable than the points you want. Close his lane before you chase yours.",
    rewardLabel: "Swing Denied",
  },
  "ch3-n10": {
    nodeId: "ch3-n10",
    eyebrow: "Puzzle · Pip Count",
    title: "Pip Count Discipline",
    scenario:
      "Most 5s and 6s are on the board. Fritz has been quiet—likely holding a high-pip reply. You hold one strong tile and one trap.",
    prompt: "What does pip discipline demand here?",
    choices: [
      { id: "a", label: "Play the trap tile—it scores fast." },
      { id: "b", label: "Ignore pip count; board shape is all that matters." },
      { id: "c", label: "Count what remains, assume Fritz holds the high reply, and play accordingly." },
      { id: "d", label: "Pass until Fritz shows his hand." },
    ],
    correctChoiceId: "c",
    explanation:
      "When heavy tiles are scarce on the board, the ones in hand matter more. Fritz’s silence often means he is waiting for the pip you are about to feed him.",
    rewardLabel: "Pip Ledger",
  },
  "ch3-n11": {
    nodeId: "ch3-n11",
    eyebrow: "Puzzle · Double Trap",
    title: "Double Trap",
    scenario:
      "Fritz just played a double that opens two fresh ends. You can feed it for a quick score—or leave it locked.",
    prompt: "When is feeding the double a trap?",
    choices: [
      { id: "a", label: "Never—doubles always score." },
      { id: "b", label: "Only when you are ahead in the race." },
      { id: "c", label: "When the double is a low pip tile." },
      { id: "d", label: "When Fritz still controls the next reply on both new ends." },
    ],
    correctChoiceId: "d",
    explanation:
      "A double trap is bait. If Fritz owns both replies, feeding the double is how he converts one tile into a swing. Lock or redirect—not charity.",
    rewardLabel: "Trap Avoided",
  },
  "ch3-n14": {
    nodeId: "ch3-n14",
    eyebrow: "Puzzle · Midrace",
    title: "Race to 50",
    scenario:
      "Both players cross 50 in the race to 60. You lead 52–51. One misread can flip the last ten points.",
    prompt: "How do you handle midrace pressure with the finish in sight?",
    choices: [
      { id: "a", label: "Treat each hand as endgame: secure lines that reach 60 without a comeback reply." },
      { id: "b", label: "Press for every point—ten left means aggression." },
      { id: "c", label: "Slow down and pass more—time is on your side." },
      { id: "d", label: "Match Fritz tile for tile until someone breaks." },
    ],
    correctChoiceId: "a",
    explanation:
      "Past 50, every hand is endgame math. The player who needs fewer points should avoid variance. Secure 60 without handing Fritz the reply that steals the race.",
    rewardLabel: "Midrace Read",
  },
  "ch3-n16": {
    nodeId: "ch3-n16",
    eyebrow: "Puzzle · Endgame",
    title: "Save the Five",
    scenario:
      "The 5 end is live. You lead 58–55. One wrong tile lets Fritz score out on the 5 end next reply.",
    prompt: "What is the save?",
    choices: [
      { id: "a", label: "Score two now on the 5 end—reach 60 immediately." },
      { id: "b", label: "Play the tile that reaches 60 or blocks Fritz’s 5-end win—whichever the board allows." },
      { id: "c", label: "Pass. Fritz will not see the 5 end." },
      { id: "d", label: "Open a new end to create more scoring options." },
    ],
    correctChoiceId: "b",
    explanation:
      "Save the Five means reading the winning reply before you play. Reaching 60 is useless if Fritz answers on the live end you left open.",
    rewardLabel: "Five Saved",
  },
  "ch3-n19": {
    nodeId: "ch3-n19",
    eyebrow: "Puzzle · Boss Gate",
    title: "Boss Prep Gate",
    scenario:
      "Final puzzle before the Long March boss: you lead 56–53 after a grueling stretch. Fritz still has tempo. One swing end could end your march.",
    prompt: "What line enters the boss trial with legs left?",
    choices: [
      { id: "a", label: "Max score now—enter the boss ahead by ten." },
      { id: "b", label: "Pass twice and force Fritz to open." },
      { id: "c", label: "Take two points, shut the swing end, and ride out the reply—you need endurance for the boss, not a flash win." },
      { id: "d", label: "Feed the open end for speed—boss trials reward aggression." },
    ],
    correctChoiceId: "c",
    explanation:
      "The Long March boss punishes hero tiles. Enter with a closed lane, a modest race lead, and enough discipline to survive Master Fritz’s pressure.",
    rewardLabel: "Boss Key",
  },
  "ch4-n02": {
    nodeId: "ch4-n02",
    eyebrow: "Puzzle · Hold the Line",
    title: "Hold the Line",
    scenario:
      "You lead 38–36. Fritz has been quiet on the 4 end. You can score five now and open it—or take two and keep the lane closed.",
    prompt: "How do you hold a narrow lead without opening a swing?",
    choices: [
      { id: "a", label: "Take the modest score and deny Fritz the 4 end he is counting on." },
      { id: "b", label: "Press for max score—narrow leads demand aggression." },
      { id: "c", label: "Pass and force Fritz to break first." },
      { id: "d", label: "Open a fresh end to accelerate your race to 60." },
    ],
    correctChoiceId: "a",
    explanation:
      "A narrow lead is fragile when Fritz owns the reply. Hold the line means scoring safely and closing the swing lane—not chasing every point on the board.",
    rewardLabel: "Line Held",
  },
  "ch4-n04": {
    nodeId: "ch4-n04",
    eyebrow: "Puzzle · Score Denial",
    title: "Take Five or Deny Ten",
    scenario:
      "You can score five this turn. Fritz sits one tile away from a ten-point swing if you open the 6 end.",
    prompt: "Which line protects the race?",
    choices: [
      { id: "a", label: "Take the five—five points now beats ten points later on paper." },
      { id: "b", label: "Open the 6 end and race Fritz to 60." },
      { id: "c", label: "Pass twice—Fritz will break before the swing lands." },
      { id: "d", label: "Deny the 6 end first, even if it costs this turn’s score." },
    ],
    correctChoiceId: "d",
    explanation:
      "Take five or deny ten is a race read. Ten points Fritz can take in one reply is worth more than five you score now if the end stays open.",
    rewardLabel: "Denial Read",
  },
  "ch4-n05": {
    nodeId: "ch4-n05",
    eyebrow: "Puzzle · Rack Discipline",
    title: "Bad Rack Discipline",
    scenario:
      "Your rack is heavy and disconnected. Fritz leads by four. Every tile feels like it must score immediately.",
    prompt: "What does bad-rack discipline demand?",
    choices: [
      { id: "a", label: "Force the highest score—falling behind demands speed." },
      { id: "b", label: "Play for board control and tempo; one ugly rack is not the match." },
      { id: "c", label: "Dump heavy tiles fast, even if Fritz gets the reply he wants." },
      { id: "d", label: "Pass until the rack improves on its own." },
    ],
    correctChoiceId: "b",
    explanation:
      "A bad rack is not permission to unravel the board. Discipline means rebuilding initiative without gifting Fritz the swing that resets the circuit.",
    rewardLabel: "Rack Control",
  },
  "ch4-n08": {
    nodeId: "ch4-n08",
    eyebrow: "Puzzle · Safer Score",
    title: "The Safer Score",
    scenario:
      "Two lines score: one for six and one for three. The six leaves Fritz a live reply on both ends. The three keeps one lane closed.",
    prompt: "Which is the safer score under pressure?",
    choices: [
      { id: "a", label: "Take the six—pressure chapters reward aggression." },
      { id: "b", label: "Pass—both lines are too risky." },
      { id: "c", label: "Take the three and preserve the closed lane Fritz cannot exploit." },
      { id: "d", label: "Play whichever tile leaves the board longest." },
    ],
    correctChoiceId: "c",
    explanation:
      "The safer score is the one that survives Fritz’s reply. Six points that hand him both ends is how tight races flip in one hand.",
    rewardLabel: "Safe Line",
  },
  "ch4-n10": {
    nodeId: "ch4-n10",
    eyebrow: "Puzzle · Tempo Chain",
    title: "Break the Chain",
    scenario:
      "Fritz has scored three hands in a row with the same reply pattern. You hold a tile that feeds his chain for four—or one that interrupts it for one.",
    prompt: "How do you break Fritz’s tempo chain?",
    choices: [
      { id: "a", label: "Feed the chain for four—catch up in one swing." },
      { id: "b", label: "Pass until Fritz breaks his own chain." },
      { id: "c", label: "Open a new end to create more scoring options." },
      { id: "d", label: "Interrupt the pattern even if this turn scores less." },
    ],
    correctChoiceId: "d",
    explanation:
      "Tempo chains compound. Breaking the pattern costs points now and saves more later. Fritz wins circuits when you keep feeding the reply he owns.",
    rewardLabel: "Chain Broken",
  },
  "ch4-n11": {
    nodeId: "ch4-n11",
    eyebrow: "Puzzle · Double Under Fire",
    title: "Double Under Fire",
    scenario:
      "A double appears while you trail 52–54. You can feed it for a quick score—or leave it locked while Fritz holds both replies.",
    prompt: "What is the disciplined read under score pressure?",
    choices: [
      { id: "a", label: "Feed only if you own the next reply on both new ends." },
      { id: "b", label: "Always feed doubles when behind—speed closes gaps." },
      { id: "c", label: "Never play doubles under pressure." },
      { id: "d", label: "Feed the double because low pip tiles are safe." },
    ],
    correctChoiceId: "a",
    explanation:
      "Doubles under fire are traps when Fritz owns both replies. Feed only when you control what opens—not because the scoreboard says hurry.",
    rewardLabel: "Fire Discipline",
  },
  "ch4-n14": {
    nodeId: "ch4-n14",
    eyebrow: "Puzzle · Comeback Denial",
    title: "Deny the Comeback",
    scenario:
      "Fritz trails 55–58 but has been building on the 2 end. One open play lets him swing ten and take the lead.",
    prompt: "How do you deny the comeback?",
    choices: [
      { id: "a", label: "Score now and accept the swing—offense closes gaps." },
      { id: "b", label: "Close the 2 end before you chase points Fritz already owns." },
      { id: "c", label: "Pass and hope Fritz breaks first." },
      { id: "d", label: "Open a fresh end to race to 60 before Fritz replies." },
    ],
    correctChoiceId: "b",
    explanation:
      "Deny the comeback means closing Fritz’s lane first. Points you score while leaving his swing end open are how circuits flip in one reply.",
    rewardLabel: "Comeback Denied",
  },
  "ch4-n16": {
    nodeId: "ch4-n16",
    eyebrow: "Puzzle · Exit Count",
    title: "Count the Exit",
    scenario:
      "Three tiles remain in your hand. The race is 57–56. Fritz has one obvious reply if you play the wrong tile first.",
    prompt: "What does counting the exit demand?",
    choices: [
      { id: "a", label: "Play the highest-scoring tile first—finish lines reward speed." },
      { id: "b", label: "Pass and let Fritz open the winning lane." },
      { id: "c", label: "Plan the last three tiles in order before you touch the board." },
      { id: "d", label: "Play whichever tile is heaviest to lighten the rack." },
    ],
    correctChoiceId: "c",
    explanation:
      "Count the exit means sequencing the last tiles against Fritz’s likely reply. One wrong order at 57–56 loses the circuit—not the boss trial alone.",
    rewardLabel: "Exit Count",
  },
  "ch4-n17": {
    nodeId: "ch4-n17",
    eyebrow: "Puzzle · Tempo",
    title: "Save Tempo",
    scenario:
      "You cannot play without opening Fritz’s best end. Passing keeps tempo; drawing might find a tile but feeds the board Fritz wants.",
    prompt: "When should you save tempo with a pass?",
    choices: [
      { id: "a", label: "Never pass under pressure—tempo always means scoring." },
      { id: "b", label: "Always draw instead of pass when behind." },
      { id: "c", label: "Pass only when you are ahead in the race." },
      { id: "d", label: "Pass when any play gifts Fritz the reply that wins the hand." },
    ],
    correctChoiceId: "d",
    explanation:
      "Tempo is the resource you cannot waste. A pass that denies Fritz a free reply beats a desperate play that hands him the hand.",
    rewardLabel: "Tempo Saved",
  },
  "ch4-n20": {
    nodeId: "ch4-n20",
    eyebrow: "Puzzle · Pressure Gate",
    title: "Pressure Gate I",
    scenario:
      "First late-circuit gate: you lead 54–52. Fritz holds tempo. You can score four and open his lane—or deny and score one.",
    prompt: "What clears Pressure Gate I?",
    choices: [
      { id: "a", label: "Deny Fritz’s lane first, then take the safe line to the race lead." },
      { id: "b", label: "Max score now—four points widen the lead." },
      { id: "c", label: "Pass twice and force Fritz to break." },
      { id: "d", label: "Open a new end to create more scoring options." },
    ],
    correctChoiceId: "a",
    explanation:
      "Pressure gates test denial before score. Four points that open Fritz’s reply are how late-circuit leads evaporate in one hand.",
    rewardLabel: "Gate One",
  },
  "ch4-n22": {
    nodeId: "ch4-n22",
    eyebrow: "Puzzle · Pressure Gate",
    title: "Pressure Gate II",
    scenario:
      "Second gate: tied at 58–58. One greedy tile opens a double Fritz has been holding. The safe line scores two and keeps control.",
    prompt: "What clears Pressure Gate II?",
    choices: [
      { id: "a", label: "Feed the double for speed—tied races demand aggression." },
      { id: "b", label: "Take the safe two and deny Fritz the double swing." },
      { id: "c", label: "Pass until Fritz is forced to play first." },
      { id: "d", label: "Open the longest chain on the board for maximum points." },
    ],
    correctChoiceId: "b",
    explanation:
      "One greedy tile loses the circuit at 58–58. Gate II is about the safe line that survives Fritz’s reply—not the flash play that feeds his double.",
    rewardLabel: "Gate Two",
  },
  "ch4-n23": {
    nodeId: "ch4-n23",
    eyebrow: "Puzzle · Boss Prep",
    title: "No Gifts",
    scenario:
      "Boss prep under circuit pressure: you lead 59–57. Fritz holds one tile and a live end. He is waiting for you to blink.",
    prompt: "What line denies Fritz a free reply before the boss?",
    choices: [
      { id: "a", label: "Max score now—enter the boss ahead by ten." },
      { id: "b", label: "Pass twice and force Fritz to open." },
      { id: "c", label: "Deny the live end, score the safe two, and force Fritz to pass—enter the trial with the swing lane closed." },
      { id: "d", label: "Feed the open end for speed—boss trials reward aggression." },
    ],
    correctChoiceId: "c",
    explanation:
      "No gifts under pressure means Fritz gets nothing for free. Close the reply he has been counting on, then take the modest line to 60.",
    rewardLabel: "No Gifts Seal",
  },
  "ch5-n02": {
    nodeId: "ch5-n02",
    eyebrow: "Puzzle · Lead Protection",
    title: "Protect the Lead",
    scenario:
      "You lead 42–39. Fritz has been quiet on the 5 end. You can score six and open it—or take two and keep the lane closed.",
    prompt: "How do you protect the lead in the Iron Mile?",
    choices: [
      { id: "a", label: "Press for max score—a lead demands aggression." },
      { id: "b", label: "Pass and force Fritz to break first." },
      { id: "c", label: "Open a fresh end to race to 60 faster." },
      { id: "d", label: "Take the modest score and deny Fritz the 5 end he is counting on." },
    ],
    correctChoiceId: "d",
    explanation:
      "Protect the lead means closing Fritz’s swing lane before you chase points. Six points that hand him the reply is how endgame leads flip in one hand.",
    rewardLabel: "Lead Protected",
  },
  "ch5-n04": {
    nodeId: "ch5-n04",
    eyebrow: "Puzzle · Greedy Score",
    title: "The Greedy Five",
    scenario:
      "You can score five this turn. Fritz sits one tile from a ten-point swing if you open the 4 end.",
    prompt: "What is the disciplined read?",
    choices: [
      { id: "a", label: "Deny the 4 end first, even if it costs this turn’s score." },
      { id: "b", label: "Take the five—five now beats ten later on paper." },
      { id: "c", label: "Open the 4 end and race Fritz to 60." },
      { id: "d", label: "Pass twice—Fritz will break before the swing lands." },
    ],
    correctChoiceId: "a",
    explanation:
      "The greedy five is the score that opens Fritz’s swing. Ten points in one reply is worth more than five you take now if the end stays live.",
    rewardLabel: "Greedy Denied",
  },
  "ch5-n05": {
    nodeId: "ch5-n05",
    eyebrow: "Puzzle · Closeout",
    title: "Close the Door",
    scenario:
      "Fritz trails 48–51 but owns the 2 end. One open play lets him swing eight and take the lead.",
    prompt: "How do you close the door?",
    choices: [
      { id: "a", label: "Score now and accept the swing—offense closes gaps." },
      { id: "b", label: "Close the 2 end before you chase points Fritz already owns." },
      { id: "c", label: "Pass and hope Fritz breaks first." },
      { id: "d", label: "Open a fresh end to accelerate your race to 60." },
    ],
    correctChoiceId: "b",
    explanation:
      "Close the door means shutting Fritz’s comeback lane first. Points you score while leaving his swing end open are how miles flip in one reply.",
    rewardLabel: "Door Closed",
  },
  "ch5-n08": {
    nodeId: "ch5-n08",
    eyebrow: "Puzzle · Denial",
    title: "When Ahead, Deny",
    scenario:
      "You lead 54–52 with the finish in sight. Fritz holds tempo on the 6 end. You can score four and open it.",
    prompt: "When ahead in the Iron Mile, what wins?",
    choices: [
      { id: "a", label: "Max score—four points widen the lead." },
      { id: "b", label: "Pass twice and force Fritz to break." },
      { id: "c", label: "Deny the 6 end first, then take the safe line toward 60." },
      { id: "d", label: "Feed the 6 end for speed—the race rewards aggression." },
    ],
    correctChoiceId: "c",
    explanation:
      "When ahead, deny. Subtraction beats addition when Fritz owns the reply that resets the race.",
    rewardLabel: "Denial Line",
  },
  "ch5-n10": {
    nodeId: "ch5-n10",
    eyebrow: "Puzzle · Comeback Trap",
    title: "The Comeback Trap",
    scenario:
      "Fritz just opened a line that scores modestly for you—but hands him a double reply he has been holding.",
    prompt: "What is the comeback trap?",
    choices: [
      { id: "a", label: "Never—modest scores are always safe when behind." },
      { id: "b", label: "Only when you are ahead in the race." },
      { id: "c", label: "When the tile is a low pip double." },
      { id: "d", label: "When Fritz owns the next reply that converts your score into his swing." },
    ],
    correctChoiceId: "d",
    explanation:
      "The comeback trap is bait. Fritz offers a small score to feed the reply that flips the mile. Lock or redirect—not charity.",
    rewardLabel: "Trap Avoided",
  },
  "ch5-n11": {
    nodeId: "ch5-n11",
    eyebrow: "Puzzle · Pip Count",
    title: "Pip Count Under Fire",
    scenario:
      "Most 5s and 6s are on the board. Fritz has been quiet—likely holding a high-pip reply. You hold one strong tile and one trap.",
    prompt: "What does pip count under fire demand?",
    choices: [
      { id: "a", label: "Count what remains, assume Fritz holds the high reply, and play accordingly." },
      { id: "b", label: "Play the trap tile—it scores fast." },
      { id: "c", label: "Ignore pip count; board shape is all that matters." },
      { id: "d", label: "Pass until Fritz shows his hand." },
    ],
    correctChoiceId: "a",
    explanation:
      "Under fire, pip count is survival. Fritz’s silence often means he is waiting for the pip you are about to feed him.",
    rewardLabel: "Pip Read",
  },
  "ch5-n14": {
    nodeId: "ch5-n14",
    eyebrow: "Puzzle · Small Edge",
    title: "Take the Small Edge",
    scenario:
      "You trail 50–53. You can score two safely—or six that opens Fritz’s best end.",
    prompt: "Which line recovers the mile?",
    choices: [
      { id: "a", label: "Take the six—catch up in one swing." },
      { id: "b", label: "Take the two, close Fritz’s lane, and rebuild tempo." },
      { id: "c", label: "Pass until Fritz is forced to open." },
      { id: "d", label: "Open a new end to create more scoring options." },
    ],
    correctChoiceId: "b",
    explanation:
      "The small edge is how recovery works in the Iron Mile. Two safe points with a closed lane beat six that hand Fritz the swing.",
    rewardLabel: "Small Edge",
  },
  "ch5-n16": {
    nodeId: "ch5-n16",
    eyebrow: "Puzzle · Draw Discipline",
    title: "Force the Safe Draw",
    scenario:
      "You cannot play without opening Fritz’s best end. The boneyard is active and you trail by five.",
    prompt: "How do you force a safe draw?",
    choices: [
      { id: "a", label: "Draw aggressively—speed matters more than board shape." },
      { id: "b", label: "Keep passing until Fritz is forced to break." },
      { id: "c", label: "Draw once, reassess the board, and avoid unlocking Fritz’s best end." },
      { id: "d", label: "Draw until you can score, regardless of what opens." },
    ],
    correctChoiceId: "c",
    explanation:
      "A safe draw changes the pip count without feeding Fritz the board he wants. One disciplined pull beats three desperate ones.",
    rewardLabel: "Safe Draw",
  },
  "ch5-n17": {
    nodeId: "ch5-n17",
    eyebrow: "Puzzle · Discipline",
    title: "No Hero Tile",
    scenario:
      "You hold one tile that scores eight and opens both ends. Another scores two and keeps control.",
    prompt: "Which line finishes the hand cleanly?",
    choices: [
      { id: "a", label: "Play the hero tile—eight points close gaps fast." },
      { id: "b", label: "Pass and hope Fritz breaks first." },
      { id: "c", label: "Dump the heaviest tile regardless of the reply." },
      { id: "d", label: "Play the boring two and preserve the closed lane." },
    ],
    correctChoiceId: "d",
    explanation:
      "No hero tile means the boring line wins the mile. Eight points that hand Fritz both ends is how recovery attempts fail.",
    rewardLabel: "No Hero",
  },
  "ch5-n20": {
    nodeId: "ch5-n20",
    eyebrow: "Puzzle · Iron Gate",
    title: "Iron Gate I",
    scenario:
      "First late-mile gate: you lead 56–54. Fritz holds tempo. You can score four and open his lane—or deny and score one.",
    prompt: "What clears Iron Gate I?",
    choices: [
      { id: "a", label: "Deny Fritz’s lane first, then take the safe line toward 60." },
      { id: "b", label: "Max score now—four points widen the lead." },
      { id: "c", label: "Pass twice and force Fritz to break." },
      { id: "d", label: "Open a new end to create more scoring options." },
    ],
    correctChoiceId: "a",
    explanation:
      "Iron gates test closeout discipline. Four points that open Fritz’s reply are how late-mile leads evaporate in one hand.",
    rewardLabel: "Gate One",
  },
  "ch5-n22": {
    nodeId: "ch5-n22",
    eyebrow: "Puzzle · Iron Gate",
    title: "Iron Gate II",
    scenario:
      "Second gate: tied at 58–58. One greedy tile opens a double Fritz has been holding. The safe line scores two and keeps control.",
    prompt: "What clears Iron Gate II?",
    choices: [
      { id: "a", label: "Feed the double for speed—tied races demand aggression." },
      { id: "b", label: "Take the safe two and deny Fritz the double swing." },
      { id: "c", label: "Pass until Fritz is forced to play first." },
      { id: "d", label: "Open the longest chain on the board for maximum points." },
    ],
    correctChoiceId: "b",
    explanation:
      "One greedy tile loses the mile at 58–58. Gate II is the safe line that survives Fritz’s reply—not the flash play that feeds his double.",
    rewardLabel: "Gate Two",
  },
  "ch5-n23": {
    nodeId: "ch5-n23",
    eyebrow: "Puzzle · Boss Prep",
    title: "Finish Clean",
    scenario:
      "One puzzle before the Iron Mile boss: you lead 59–57 at the closeout mile. Fritz holds one tile and a live end.",
    prompt: "What line protects the lead into the boss seat?",
    choices: [
      { id: "a", label: "Max score now—enter the boss ahead by ten." },
      { id: "b", label: "Pass twice and force Fritz to open." },
      { id: "c", label: "Lock the two-point line to 60, keep your pass in hand, and close the swing—protect the lead into the boss trial." },
      { id: "d", label: "Feed the open end for speed—boss trials reward aggression." },
    ],
    correctChoiceId: "c",
    explanation:
      "Finish clean is closeout discipline: deny the swing, score safely, and enter the boss with a lead Fritz cannot flip in one reply.",
    rewardLabel: "Clean Finish Seal",
  },
};

export { getJourneyPuzzle, hasJourneyPuzzle } from './journeyContentIndex.ts';
