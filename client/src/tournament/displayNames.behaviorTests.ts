import {
  botDisplayNameFromTier,
  registrationNameFor,
  resolveTournamentPlayerName,
  tournamentBotDisplayIndex,
} from './displayNames.ts';

function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(
      `[displayNames.behaviorTests] ${msg}: expected ${String(expected)}, got ${String(actual)}`,
    );
  }
}

assertEqual(tournamentBotDisplayIndex('bot:fritz:tour-1:3'), 3, 'bot index from id');
assertEqual(
  resolveTournamentPlayerName('bot:fritz:tour-1:2', { round: 2 }),
  'Elite Fritz 2',
  'elite tier with stable index',
);
assertEqual(
  registrationNameFor('bot:fritz:tour-1:4', 'Fritz', null),
  'Fritz 4',
  'registration ignores generic Fritz username',
);
assertEqual(botDisplayNameFromTier('master', 1), 'Master Fritz 1', 'master tier label');

console.log('displayNames.behaviorTests: ok');
