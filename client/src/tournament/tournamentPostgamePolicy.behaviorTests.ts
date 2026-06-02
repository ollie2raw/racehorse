import {
  shouldDeferTournamentMatchFinalize,
  shouldShowTournamentGameOverOverlay,
} from './tournamentPostgamePolicy.ts';

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`[tournamentPostgamePolicy.behaviorTests] ${msg}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function testDeferFinalizeWhileLiveMatch() {
  assertEqual(
    shouldDeferTournamentMatchFinalize({
      appMode: 'multiplayer',
      attachedMatchId: 'match-1',
      payloadMatchId: 'match-1',
    }),
    true,
    'defer while attached live match',
  );
  assertEqual(
    shouldDeferTournamentMatchFinalize({
      appMode: 'tournament',
      attachedMatchId: 'match-1',
      payloadMatchId: 'match-1',
    }),
    false,
    'no defer on tournament hub mode',
  );
  assertEqual(
    shouldDeferTournamentMatchFinalize({
      appMode: 'multiplayer',
      attachedMatchId: 'match-2',
      payloadMatchId: 'match-1',
    }),
    false,
    'no defer for different match',
  );
}

function testShowGameOverOverlayUntilConsumed() {
  const consumed = new Set<string>();
  assertEqual(
    shouldShowTournamentGameOverOverlay({
      gameOver: true,
      matchId: 'match-1',
      consumedMatchIds: consumed,
    }),
    true,
    'show overlay before consumed',
  );
  consumed.add('match-1');
  assertEqual(
    shouldShowTournamentGameOverOverlay({
      gameOver: true,
      matchId: 'match-1',
      consumedMatchIds: consumed,
    }),
    false,
    'hide overlay after consumed',
  );
}

testDeferFinalizeWhileLiveMatch();
testShowGameOverOverlayUntilConsumed();
console.log('tournamentPostgamePolicy.behaviorTests: ok');
