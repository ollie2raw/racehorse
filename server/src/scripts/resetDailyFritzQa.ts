import '../loadEnv';
import { resetDailyFritzQaAttempt } from '../dailyFritz/qaReset';

function readFlag(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function main(): Promise<void> {
  const runDate = readFlag('--run-date') ?? undefined;
  const reason = readFlag('--reason') ?? 'qa_cli_reset';
  const result = await resetDailyFritzQaAttempt({ runDate, reason });
  console.log('[daily-fritz:qa-reset] complete');
  console.log(`runDate=${result.runDate}`);
  console.log(`qaUserId=${result.qaUserId}`);
  console.log(`deleted=${result.deleted}`);
  console.log(`previousStatus=${result.previousStatus ?? 'none'}`);
  console.log(`attemptId=${result.attemptId ?? 'none'}`);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[daily-fritz:qa-reset] failed', message);
  process.exitCode = 1;
});
