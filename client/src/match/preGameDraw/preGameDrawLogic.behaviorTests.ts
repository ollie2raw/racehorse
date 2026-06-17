import {
  createBotMatchWithStarter,
  resolveHandStarter,
  startNextBotHand,
} from '../../bot/botEngine.ts';
import {
  applyOpponentPick,
  applyPlayerPick,
  generateDoubleSixSet,
  getPickableTileIds,
  initPreGameDraw,
  simulateDrawRound,
  tilePipSum,
} from './preGameDrawLogic.ts';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${label}: expected ${e}, got ${a}`);
  }
}

function assertTrue(value: boolean, label: string): void {
  if (!value) throw new Error(label);
}

function countTiles(hands: Array<{ low: number; high: number }[]>): number {
  return hands.reduce((sum, hand) => sum + hand.length, 0);
}

function testInitHasTwentyEightPickableTiles(): void {
  const state = initPreGameDraw(generateDoubleSixSet(), () => 0.42);
  assertEqual(state.phase, 'pick-player', 'initial phase');
  assertEqual(getPickableTileIds(state).length, 28, 'all tiles pickable');
}

function testWinnerRemovesBothTilesAndLeavesTwentySixForDeal(): void {
  const deck = generateDoubleSixSet();
  const state = initPreGameDraw(deck, () => 0.1);
  const playerTileId = '6-6';
  const opponentTileId = '0-0';
  const resolved = simulateDrawRound(state, playerTileId, opponentTileId);

  assertEqual(resolved.phase, 'resolved', 'draw resolved');
  assertEqual(resolved.winner, 'you', 'higher pip sum wins');
  assertEqual(resolved.remainingDeck?.length, 26, 'two draw tiles removed');
  assertTrue(
    !resolved.remainingDeck!.some((tile) => tile.low === 6 && tile.high === 6),
    'player draw tile removed from deal pool',
  );
  assertTrue(
    !resolved.remainingDeck!.some((tile) => tile.low === 0 && tile.high === 0),
    'opponent draw tile removed from deal pool',
  );
}

function testResolvedWinnerKeepsBothTilesVisibleOnBoard(): void {
  const resolved = simulateDrawRound(initPreGameDraw(), '6-6', '0-0');
  assertEqual(resolved.phase, 'resolved', 'draw resolved');

  const visibleOnBoard = resolved.tiles.filter((slot) => !slot.outOfPlay);
  assertEqual(visibleOnBoard.length, 28, 'all 28 tiles stay on board during reveal pause');
  assertTrue(
    visibleOnBoard.filter((slot) => slot.revealed).length === 2,
    'both drawn tiles stay revealed on board',
  );
  assertEqual(resolved.remainingDeck?.length, 26, 'deal pool still excludes drawn pair');
}

function testTieRedrawRemovesBothAndReopensPicks(): void {
  const state = initPreGameDraw(generateDoubleSixSet(), () => 0.2);
  const afterTie = simulateDrawRound(state, '3-3', '0-6');
  assertEqual(afterTie.phase, 'pick-player', 'tie returns to player pick');
  assertEqual(afterTie.currentRound.you, null, 'round picks cleared');
  assertEqual(afterTie.currentRound.bot, null, 'round picks cleared');
  assertEqual(getPickableTileIds(afterTie).length, 26, 'tied tiles removed from pool');
  assertEqual(afterTie.remainingDeck, null, 'no deal deck until winner');

  const resolved = simulateDrawRound(afterTie, '6-6', '0-1');
  assertEqual(resolved.phase, 'resolved', 'second round resolves');
  assertEqual(resolved.remainingDeck?.length, 24, 'four tiles removed after tie + win');
}

function testCreateBotMatchWithStarterUsesDrawWinnerAndRemainingDeck(): void {
  const draw = simulateDrawRound(initPreGameDraw(), '6-6', '0-0');
  assertTrue(draw.remainingDeck != null && draw.winner != null, 'draw setup');

  const match = createBotMatchWithStarter(draw.remainingDeck!, draw.winner!, 60, 7);
  assertEqual(match.matchStarter, 'you', 'match starter stored');
  assertEqual(match.currentPlayer, 'you', 'hand 1 starts with draw winner');
  assertEqual(match.handNumber, 1, 'first hand');
  assertEqual(match.players.you.hand.length, 7, 'player hand dealt');
  assertEqual(match.players.bot.hand.length, 7, 'bot hand dealt');
  assertEqual(match.boneyard.length, 12, 'boneyard from remaining tiles');

  const tileTotal = countTiles([match.players.you.hand, match.players.bot.hand, match.boneyard]);
  assertEqual(tileTotal, 26, 'all post-draw tiles accounted for');
  assertEqual(match.deadTiles.length, 2, 'locked tail tiles tracked separately');
}

function testHandTwoAlternatesFromMatchStarter(): void {
  const draw = simulateDrawRound(initPreGameDraw(), '6-6', '0-0');
  const handOne = createBotMatchWithStarter(draw.remainingDeck!, 'you', 60, 7);
  const handTwo = startNextBotHand({ ...handOne, handOver: true });

  assertEqual(resolveHandStarter('you', 2), 'bot', 'starter alternation helper');
  assertEqual(handTwo.currentPlayer, 'bot', 'hand 2 starts with other player');
  assertEqual(handTwo.matchStarter, 'you', 'starter preserved across hands');
  assertEqual(handTwo.handNumber, 2, 'second hand number');
}

function testBotWinsDrawStartsHandOne(): void {
  const draw = simulateDrawRound(initPreGameDraw(), '0-0', '6-6');
  const match = createBotMatchWithStarter(draw.remainingDeck!, draw.winner!, 60, 7);
  assertEqual(match.currentPlayer, 'bot', 'bot opens when it wins draw');
}

function testPipSumHelper(): void {
  assertEqual(tilePipSum({ low: 6, high: 6 }), 12, 'double six pip sum');
  assertEqual(tilePipSum({ low: 0, high: 1 }), 1, '0-1 pip sum');
}

function testApplyPlayerPickTransitionsToOpponentPhase(): void {
  const state = initPreGameDraw();
  const afterPlayer = applyPlayerPick(state, '4-5');
  assertEqual(afterPlayer.phase, 'pick-opponent', 'waits for opponent');
  assertEqual(afterPlayer.currentRound.you?.pipSum, 9, 'player pip sum stored');
}

function testApplyOpponentPickRejectsUnavailableTile(): void {
  const state = applyPlayerPick(initPreGameDraw(), '4-5');
  let threw = false;
  try {
    applyOpponentPick(state, '4-5');
  } catch {
    threw = true;
  }
  assertTrue(threw, 'cannot pick already revealed tile');
}

function testMultipleTieRoundsBeforeWinner(): void {
  let state = initPreGameDraw();
  state = simulateDrawRound(state, '3-3', '0-6');
  assertEqual(state.phase, 'pick-player', 'first tie reopens picks');
  assertEqual(getPickableTileIds(state).length, 26, 'two tiles removed after first tie');

  state = simulateDrawRound(state, '2-4', '1-5');
  assertEqual(state.phase, 'pick-player', 'second tie reopens picks');
  assertEqual(getPickableTileIds(state).length, 24, 'four tiles removed after two ties');

  const resolved = simulateDrawRound(state, '6-6', '0-1');
  assertEqual(resolved.phase, 'resolved', 'third round resolves');
  assertEqual(resolved.remainingDeck?.length, 22, 'six tiles removed after two ties + win');
}

function run(): void {
  testInitHasTwentyEightPickableTiles();
  testWinnerRemovesBothTilesAndLeavesTwentySixForDeal();
  testResolvedWinnerKeepsBothTilesVisibleOnBoard();
  testTieRedrawRemovesBothAndReopensPicks();
  testMultipleTieRoundsBeforeWinner();
  testCreateBotMatchWithStarterUsesDrawWinnerAndRemainingDeck();
  testHandTwoAlternatesFromMatchStarter();
  testBotWinsDrawStartsHandOne();
  testPipSumHelper();
  testApplyPlayerPickTransitionsToOpponentPhase();
  testApplyOpponentPickRejectsUnavailableTile();
  console.log('preGameDrawLogic.behaviorTests: all passed');
}

run();
