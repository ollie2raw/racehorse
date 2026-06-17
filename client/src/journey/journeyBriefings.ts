export interface JourneyBriefing {
  nodeId: string;
  eyebrow: string;
  title: string;
  intro: string;
  trailNotes: string[];
  rewardLabel: string;
}

export const JOURNEY_BRIEFINGS: Record<string, JourneyBriefing> = {
  'ch1-n01': {
    nodeId: 'ch1-n01',
    eyebrow: 'Trailhead Briefing',
    title: 'Welcome to The Fritz Trail',
    intro:
      'Racehorse Journey is a long march through Fritz—not a daily sprint. Each node on this trail is a deliberate test of instinct, tempo, and score pressure. Chapter 1 is only the proving ground; many more chapters lie ahead.',
    trailNotes: [
      'Move in order. Each node unlocks the next when you earn it.',
      'Match nodes are live Fritz trials. Win to advance.',
      'Checkpoints like this one set the strategic frame before harder ground.',
      'Puzzle gates train board reads—not luck.',
      'The First Grandmaster Trial closes Chapter 1. The full Journey continues beyond it.',
    ],
    rewardLabel: 'Trail Marker',
  },
  'ch1-n07': {
    nodeId: 'ch1-n07',
    eyebrow: 'Checkpoint · Doubles',
    title: 'Double Trouble',
    intro:
      'Doubles are not just big tiles—they are tempo levers. Played well, a double locks the board in your favor. Played late, it feeds your opponent the initiative you cannot afford to give back.',
    trailNotes: [
      'A double on the line often opens two fresh ends—watch both before you commit.',
      'Feed a double when you still control the next reply; lock it when the board runs away from you.',
      'Early doubles can accelerate your race to 60; late doubles often trade points for desperation.',
      'If Fritz keeps doubles in hand, assume he is waiting for your pass—not for your charity.',
      'Tempo beats flash. The right double at the right moment wins quiet hands.',
    ],
    rewardLabel: 'Double Down',
  },
  'ch2-n01': {
    nodeId: 'ch2-n01',
    eyebrow: 'High Line Briefing',
    title: 'Welcome to The High Line',
    intro:
      'Chapter 1 taught you to survive Fritz. The High Line teaches you to control him. Every open end is a scoring lane—or a trap. Fritz will punish the ends you leave free.',
    trailNotes: [
      'Tempo matters more here. Passing is rarely neutral when Fritz leads the race.',
      'Count both open ends before every play—not just the one you want to hit.',
      'Score denial beats flash: sometimes the winning move is the tile Fritz cannot reply to.',
      'Standard and Elite Fritz appear earlier on this trail. Master Fritz waits at the summit.',
      'Clear all twelve nodes to earn the High Line Crest. Chapter 3 lies beyond.',
    ],
    rewardLabel: 'Line Marker',
  },
  'ch2-n07': {
    nodeId: 'ch2-n07',
    eyebrow: 'Checkpoint · The Lock',
    title: 'The Lock',
    intro:
      'Locking the board is a weapon—not a habit. A sealed line denies Fritz his favorite ends. But a lock you cannot escape becomes his weapon instead.',
    trailNotes: [
      'Lock when you control the only reply Fritz can make—and that reply favors you.',
      'Break a lock when your hand needs fresh ends more than Fritz does.',
      'Score denial often means locking the end Fritz has been counting on all hand.',
      'Elite and Master Fritz will pass into a lock to bait you into opening it for them.',
      'The second half of The High Line rewards patience over panic.',
    ],
    rewardLabel: 'Lock Key',
  },
  'ch3-n01': {
    nodeId: 'ch3-n01',
    eyebrow: 'Long March Briefing',
    title: 'Welcome to The Long March',
    intro:
      'Chapter 3 is longer and harder than the trails behind you. Twenty nodes test whether your reads hold across multiple hands—not just one clever turn. Endurance, recovery, and score denial carry this march.',
    trailNotes: [
      'Bad deals happen. Recovery is a skill—not luck.',
      'Tempo and points diverge over a long match. Choose the line that wins the hand.',
      'Draws are not panic buttons. Every pull from the boneyard has a cost.',
      'Elite Fritz appears in the middle march; Master Fritz waits in the late stretch.',
      'The Long March Seal closes Chapter 3. The full Journey continues beyond it.',
    ],
    rewardLabel: 'March Marker',
  },
  'ch3-n07': {
    nodeId: 'ch3-n07',
    eyebrow: 'Checkpoint · Endurance',
    title: 'Endurance Rules',
    intro:
      'You are one-third through the march. The players who survive long chapters do not chase every point—they protect the race score across hands and deny Fritz the swing that resets the trail.',
    trailNotes: [
      'One big hand does not win a long chapter if the next three hands give it back.',
      'When ahead in the race, variance is the enemy. Lock safe lines.',
      'When behind, pick fights on boards you can control—not on Fritz’s terms.',
      'Mid-march checkpoints exist to reset discipline, not to celebrate progress.',
      'The second half of this chapter runs harder than the first.',
    ],
    rewardLabel: 'Endurance Crest',
  },
  'ch3-n13': {
    nodeId: 'ch3-n13',
    eyebrow: 'Checkpoint · The Long Hand',
    title: 'The Long Hand',
    intro:
      'Some hands refuse to end cleanly. Tiles linger, passes stack, and Fritz waits for the one end you cannot defend. The Long Hand rewards patience and pip discipline over forced heroics.',
    trailNotes: [
      'Track what has been played—not just what you hold.',
      'A long hand favors the player who needs fewer points to win the race.',
      'Do not unlock an end just to score this turn if Fritz owns the reply.',
      'Doubles in long hands are traps as often as weapons.',
      'Three nodes remain after this checkpoint—including the boss gate.',
    ],
    rewardLabel: 'Long Hand Seal',
  },
  'ch3-n18': {
    nodeId: 'ch3-n18',
    eyebrow: 'Final Gate Briefing',
    title: 'Final Gate Briefing',
    intro:
      'The boss trial is two nodes away. You have marched through recovery puzzles, Elite pressure, and twin Master sets. The Long March boss is Master Fritz with no margin for drift—but it is still only Chapter 3.',
    trailNotes: [
      'Clear the boss prep gate puzzle before you enter the trial.',
      'Master Fritz punishes free ends and free turns in equal measure.',
      'Win the match to earn the Long March Seal—not the end of Racehorse Journey.',
      'Review earlier checkpoints if a read feels uncertain. Speed is not the goal.',
      'Many more chapters lie beyond this seal.',
    ],
    rewardLabel: 'Gate Brief',
  },
  'ch4-n01': {
    nodeId: 'ch4-n01',
    eyebrow: 'Circuit Briefing',
    title: 'Pressure Circuit Briefing',
    intro:
      'Chapter 4 is twenty-four nodes of sustained pressure—not one boss spike. Fritz will ask the same defensive questions again and again: deny the swing, hold thin edges, and refuse to blink when the rack is ugly.',
    trailNotes: [
      'Convert thin advantages into race leads without opening swing lanes.',
      'Standard Fritz opens the circuit; Elite and Master trials arrive in the middle and late stretch.',
      'When behind, defend without desperation—greedy tiles lose circuits faster than Fritz does.',
      'Late-hand discipline matters more here than in The Long March.',
      'The Pressure Circuit Crest closes Chapter 4. Racehorse Journey continues beyond it.',
    ],
    rewardLabel: 'Circuit Marker',
  },
  'ch4-n07': {
    nodeId: 'ch4-n07',
    eyebrow: 'Checkpoint · Small Edges',
    title: 'Small Edges',
    intro:
      'You are one-quarter through the circuit. The players who survive repeated pressure do not chase every point—they stack modest scores that Fritz cannot answer in one reply.',
    trailNotes: [
      'Two safe points beat five that hand Fritz a swing end.',
      'A closed board is an edge even when the race score is close.',
      'Bad racks are normal. Forcing the board is how Fritz converts them.',
      'Elite Fritz trials start after this checkpoint.',
      'The second half of the circuit runs under heavier score pressure.',
    ],
    rewardLabel: 'Edge Crest',
  },
  'ch4-n13': {
    nodeId: 'ch4-n13',
    eyebrow: 'Checkpoint · When Behind',
    title: 'When Behind',
    intro:
      'Fritz has closed the gap—or passed you. The circuit does not reward panic. Defend the race by denying his comeback lane before you chase points he already owns.',
    trailNotes: [
      'Behind in the race, variance is the enemy. Pick fights on boards you control.',
      'Deny before you score when Fritz is one reply from a swing.',
      'Master Fritz control trials begin after this checkpoint.',
      'Tempo is a resource—passing can be correct when a play gifts Fritz the reply.',
      'Six nodes remain after this checkpoint, including the boss gate.',
    ],
    rewardLabel: 'Defender Seal',
  },
  'ch4-n19': {
    nodeId: 'ch4-n19',
    eyebrow: 'Final Circuit Briefing',
    title: 'Final Circuit Briefing',
    intro:
      'Five nodes to the Pressure Circuit boss. You have run squeeze reads, Elite tight races, and twin Master control trials. The boss is Master Fritz with no margin for a free end—but this is still only Chapter 4.',
    trailNotes: [
      'Clear both pressure gates and the no-gifts prep before the boss trial.',
      'Master Fritz punishes every end you leave open under score pressure.',
      'Win the boss to earn the Pressure Circuit Crest—not the end of Racehorse Journey.',
      'Review earlier checkpoints if a read feels uncertain. Speed is not the goal.',
      'Many more chapters lie beyond this crest.',
    ],
    rewardLabel: 'Final Brief',
  },
  'ch5-n01': {
    nodeId: 'ch5-n01',
    eyebrow: 'Iron Mile Briefing',
    title: 'Iron Mile Briefing',
    intro:
      'Chapter 5 is twenty-four nodes of endgame closeout. You survived repeated pressure—now every hand asks whether you can protect a lead, deny the swing, and finish clean inside the final mile.',
    trailNotes: [
      'Protect leads by denying Fritz’s comeback lanes before you chase points.',
      'Elite Fritz opens the mile; Master Fritz dominates the late stretch.',
      'Recovery without hero tiles—small edges and safe draws beat desperation.',
      'Greedy scores are how late-mile leads evaporate in one reply.',
      'The Iron Mile Crest closes Chapter 5. Racehorse Journey continues beyond it.',
    ],
    rewardLabel: 'Mile Marker',
  },
  'ch5-n07': {
    nodeId: 'ch5-n07',
    eyebrow: 'Checkpoint · Closing Discipline',
    title: 'Closing Discipline',
    intro:
      'You are one-quarter through the Iron Mile. Endgame players do not chase every point—they close lanes, protect race leads, and let Fritz break first.',
    trailNotes: [
      'When ahead, subtraction beats addition. Deny before you score.',
      'A closed board is control even when the race score is close.',
      'Master Fritz lead-defense trials begin after this checkpoint.',
      'Comeback traps appear in the second half—do not feed them.',
      'The final mile runs under the heaviest Master pressure.',
    ],
    rewardLabel: 'Closeout Crest',
  },
  'ch5-n13': {
    nodeId: 'ch5-n13',
    eyebrow: 'Checkpoint · Behind the Count',
    title: 'Behind the Count',
    intro:
      'Fritz leads the race or sits one swing away. The Iron Mile does not reward hero tiles. Recover with small edges, safe draws, and boards you can control.',
    trailNotes: [
      'Behind in the race, pick fights on your terms—not Fritz’s.',
      'Two safe points beat five that hand him the reply he has been counting.',
      'Master Fritz recovery trials begin after this checkpoint.',
      'Pip discipline matters more when heavy tiles remain in play.',
      'Six nodes remain after this checkpoint, including the boss gate.',
    ],
    rewardLabel: 'Recovery Seal',
  },
  'ch5-n19': {
    nodeId: 'ch5-n19',
    eyebrow: 'Final Mile Briefing',
    title: 'Final Mile Briefing',
    intro:
      'Five nodes to the Iron Mile boss. You have run lead defense, recovery trials, and closing-table pressure. The boss is Master Fritz with no margin for a free end—but this is still only Chapter 5.',
    trailNotes: [
      'Clear both iron gates and the finish-clean prep before the boss trial.',
      'Master Fritz punishes every greedy score in the final mile.',
      'Win the boss to earn the Iron Mile Crest—not the end of Racehorse Journey.',
      'Review earlier checkpoints if a read feels uncertain. Speed is not the goal.',
      'Many more chapters lie beyond this crest.',
    ],
    rewardLabel: 'Final Brief',
  },
};

export { getJourneyBriefing, hasJourneyBriefing } from './journeyContentIndex.ts';
