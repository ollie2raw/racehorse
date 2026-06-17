import { applyPlayerPick, initPreGameDraw } from './preGameDrawLogic.ts';
import {
  buildPreGameDrawResultMessage,
  isPreGameDrawTapAllowed,
  shouldInitPreGameDrawOnEnable,
} from './usePreGameDraw.ts';

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

function assertFalse(value: boolean, label: string): void {
  if (value) throw new Error(label);
}

function testResultMessageCopy(): void {
  assertEqual(buildPreGameDrawResultMessage('you', 'Fritz'), 'You go first', 'player win');
  assertEqual(buildPreGameDrawResultMessage('bot', 'Fritz'), 'Fritz goes first', 'bot win');
  assertEqual(buildPreGameDrawResultMessage('bot', 'Ghost'), 'Ghost goes first', 'custom opponent');
}

function testShouldInitOnlyOnFalseToTrue(): void {
  assertFalse(shouldInitPreGameDrawOnEnable(false, false), 'idle stays idle');
  assertTrue(shouldInitPreGameDrawOnEnable(false, true), 'false→true inits');
  assertFalse(shouldInitPreGameDrawOnEnable(true, true), 'stays enabled — no re-init');
  assertFalse(shouldInitPreGameDrawOnEnable(true, false), 'true→false disables only');
}

/**
 * Regression: effect deps changing while enabled stayed true used to re-shuffle and wipe
 * the player's revealed pick. Simulate that stale re-run here.
 */
function testPlayerPickSurvivesEnabledStaysTrue(): void {
  let wasEnabled = true;
  const enabled = true;

  assertFalse(
    shouldInitPreGameDrawOnEnable(wasEnabled, enabled),
    'effect re-run while already enabled must not init',
  );

  const freshDeck = initPreGameDraw(undefined, () => 0.42);
  const pickableId = freshDeck.tiles.find((slot) => !slot.revealed)!.id;
  const afterPlayerPick = applyPlayerPick(freshDeck, pickableId);
  const revealedSlot = afterPlayerPick.tiles.find((slot) => slot.id === pickableId)!;

  assertTrue(revealedSlot.revealed, 'player pick flips tile before hypothetical re-init');

  assertFalse(
    shouldInitPreGameDrawOnEnable(wasEnabled, enabled),
    'still no re-init after player pick',
  );

  assertTrue(revealedSlot.revealed, 'revealed pick is not wiped when enabled stays true');
  assertEqual(afterPlayerPick.phase, 'pick-opponent', 'phase advances to opponent pick');
}

function testTapBlockedDuringInitPending(): void {
  const state = initPreGameDraw(undefined, () => 0.5);
  const pickableId = state.tiles.find((slot) => !slot.revealed)!.id;

  assertFalse(
    isPreGameDrawTapAllowed('pick-player', true, state),
    'tap blocked while initPending',
  );

  assertTrue(
    isPreGameDrawTapAllowed('pick-player', false, state),
    'tap allowed after init commits',
  );

  const afterPick = applyPlayerPick(state, pickableId);
  assertFalse(
    isPreGameDrawTapAllowed('pick-opponent', false, afterPick),
    'tap blocked after player pick until tie redraw',
  );
}

function run(): void {
  testResultMessageCopy();
  testShouldInitOnlyOnFalseToTrue();
  testPlayerPickSurvivesEnabledStaysTrue();
  testTapBlockedDuringInitPending();
  console.log('usePreGameDraw.behaviorTests: all passed');
}

run();
