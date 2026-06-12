import '../loadEnv';
import { seedTournamentQa } from '../scheduledTournament/qaSeed';

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function main(): Promise<void> {
  const state = readFlag('--state');
  if (!state) {
    throw new Error(
      'missing --state. Use --state waiting_room | bracket_lock | assigned_qf | live_qf | near_30_qf | overlay_qf_win',
    );
  }

  const result = await seedTournamentQa(state);
  console.log('[tournament:qa-seed] complete');
  console.log(`tournamentId=${result.tournamentId}`);
  console.log(`fixtureState=${result.fixtureState}`);
  console.log(`qaUserId=${result.qaUserId}`);
  console.log(`scheduledStart=${result.scheduledStart}`);
  console.log(`registrationCloseAt=${result.registrationCloseAt}`);
  console.log(`humanMatchId=${result.humanMatchId ?? 'n/a'}`);
  console.log(`roomCode=${result.roomCode ?? 'n/a'}`);
  console.log(`canceledPriorQaFixtures=${result.canceledPriorQaFixtures}`);
  console.log(`nextStep=${result.nextQaStep}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[tournament:qa-seed] failed', message);
  process.exitCode = 1;
});
