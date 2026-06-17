import {
  createFixedBotMatch,
  createFixedBotMatchWithStarter,
  startNextFixedBotHand,
  type BotHandDeal,
} from './botEngine.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
}

const baseDeal: BotHandDeal = {
  player_tiles: [
    { low: 0, high: 0 },
    { low: 0, high: 1 },
    { low: 0, high: 2 },
    { low: 0, high: 3 },
    { low: 0, high: 4 },
    { low: 0, high: 5 },
    { low: 0, high: 6 },
  ],
  fritz_tiles: [
    { low: 1, high: 1 },
    { low: 1, high: 2 },
    { low: 1, high: 3 },
    { low: 1, high: 4 },
    { low: 1, high: 5 },
    { low: 1, high: 6 },
    { low: 2, high: 2 },
  ],
  boneyard: [
    { low: 2, high: 3 },
    { low: 2, high: 4 },
    { low: 2, high: 5 },
    { low: 2, high: 6 },
    { low: 3, high: 3 },
    { low: 3, high: 4 },
    { low: 3, high: 5 },
    { low: 3, high: 6 },
    { low: 4, high: 4 },
    { low: 4, high: 5 },
    { low: 4, high: 6 },
    { low: 5, high: 5 },
    { low: 5, high: 6 },
    { low: 6, high: 6 },
  ],
  locked: [
    { low: 5, high: 6 },
    { low: 6, high: 6 },
  ],
};

function testFixedStarterOpensHandOne(): void {
  const match = createFixedBotMatchWithStarter(baseDeal, 'bot', 60, 7);
  assertEqual(match.handNumber, 1, 'first fixed hand');
  assertEqual(match.currentPlayer, 'bot', 'draw winner opens hand 1');
  assertEqual(match.matchStarter, 'bot', 'starter persisted');
}

function testFixedStarterAlternatesAcrossHands(): void {
  const handOne = createFixedBotMatchWithStarter(baseDeal, 'bot', 60, 7);
  const handTwo = startNextFixedBotHand(handOne, baseDeal);
  const handThree = startNextFixedBotHand(handTwo, baseDeal);
  assertEqual(handOne.currentPlayer, 'bot', 'starter opens hand one');
  assertEqual(handTwo.currentPlayer, 'you', 'hand two alternates');
  assertEqual(handThree.currentPlayer, 'bot', 'hand three alternates back');
}

function testLegacyFixedMatchStillOpensYou(): void {
  const match = createFixedBotMatch(baseDeal, 60, 7);
  assertEqual(match.currentPlayer, 'you', 'legacy fixed match unchanged');
  assertEqual(match.matchStarter, 'you', 'legacy starter defaults to you');
}

function run(): void {
  testFixedStarterOpensHandOne();
  testFixedStarterAlternatesAcrossHands();
  testLegacyFixedMatchStillOpensYou();
  console.log('fixedStarter.behaviorTests: all passed');
}

run();
