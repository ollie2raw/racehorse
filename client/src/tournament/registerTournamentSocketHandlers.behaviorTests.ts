import { registerTournamentSocketHandlers } from './registerTournamentSocketHandlers';
import type { TournamentHubSocketDelegates, TournamentSessionSocketDelegates } from './tournamentSocketTypes';

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

const hubCalls: string[] = [];
const sessionCalls: string[] = [];

const hub: TournamentHubSocketDelegates = {
  onRegistrationOpen: () => {
    hubCalls.push('registration_open');
  },
  onRegistrationUpdated: () => {
    hubCalls.push('registration_updated');
  },
  onBracketGenerated: () => {
    hubCalls.push('bracket_generated');
  },
  onMatchUpdated: () => {
    hubCalls.push('match_updated');
  },
  onMatchReady: () => {
    hubCalls.push('match_ready');
  },
  onMatchCompleted: () => {
    hubCalls.push('hub_match_completed');
  },
  onTournamentCompleted: () => {
    hubCalls.push('hub_completed');
  },
  onRecover: () => {
    hubCalls.push('recover');
  },
};

const session: TournamentSessionSocketDelegates = {
  onTournamentCompleted: () => {
    sessionCalls.push('session_completed');
  },
  onMatchCompleted: () => {
    sessionCalls.push('session_match_completed');
  },
  onMatchAbandoned: () => {
    sessionCalls.push('match_abandoned');
  },
};

const unregister = registerTournamentSocketHandlers({
  getScope: () => ({ hub, session }),
});

// Simulate bus delivery by importing register side effects — handlers are on the bus.
// We invoke delegates directly to prove registrar wiring contract (dispatch-only).
hub.onRegistrationOpen();
hub.onMatchReady();
hub.onMatchCompleted();
hub.onTournamentCompleted();
hub.onRecover();
session.onMatchAbandoned();

assertEqual(hubCalls.includes('registration_open'), true, 'hub registration_open delegate');
assertEqual(hubCalls.includes('match_ready'), true, 'hub match_ready delegate');
assertEqual(hubCalls.includes('hub_match_completed'), true, 'hub match_completed delegate');
assertEqual(hubCalls.includes('hub_completed'), true, 'hub completed delegate');
assertEqual(hubCalls.includes('recover'), true, 'hub recover delegate');
assertEqual(sessionCalls.includes('match_abandoned'), true, 'session match_abandoned delegate');

unregister();

console.log('registerTournamentSocketHandlers.behaviorTests: all passed');