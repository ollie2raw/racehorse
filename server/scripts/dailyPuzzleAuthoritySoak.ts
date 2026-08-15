import '../src/loadEnv';
import type { DailyPuzzleAttempt, DailyPuzzleSlot } from '../src/dailyPuzzle';
import { driveDailyPuzzleFiveSlotAttempt } from '../src/testing/dailyPuzzleLifecycleDriver';
import {
  applyAuthoritySoakEnv,
  createApi,
  createEphemeralUser,
  deleteEphemeralUser,
  fetchJson,
  percentile,
  positiveInt,
  requiredEnv,
  runInWaves,
  type Json,
} from './authoritySoakSupport';

applyAuthoritySoakEnv();

const baseUrl = (process.env.DAILY_PUZZLE_SOAK_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = requiredEnv('SUPABASE_SERVICE_KEY');
const anonKey = requiredEnv('VITE_SUPABASE_ANON_KEY');
const users = positiveInt(process.env.DAILY_PUZZLE_SOAK_USERS, 1);
const concurrency = positiveInt(process.env.DAILY_PUZZLE_SOAK_CONCURRENCY, 1);
const timeoutMs = positiveInt(process.env.DAILY_PUZZLE_SOAK_TIMEOUT_MS, 20_000);
const latencies: number[] = [];
const userInput = { supabaseUrl, serviceKey, anonKey, timeoutMs };

async function runUser(index: number): Promise<Json> {
  const user = await createEphemeralUser({ ...userInput, prefix: `dp-soak-${index}` });
  const startedAt = Date.now();
  try {
    const api = createApi({ baseUrl, token: user.accessToken, timeoutMs });
    const today = await fetchJson<Json>(`${baseUrl}/api/daily-puzzle/today`, {
      headers: { authorization: `Bearer ${user.accessToken}` },
    }, timeoutMs);
    const puzzleDate = String(today.runDate ?? '');
    const slots = today.slots as DailyPuzzleSlot[];
    if (!puzzleDate || !Array.isArray(slots) || slots.length !== 5) {
      throw new Error('Daily Puzzle soak requires one published five-slot day.');
    }
    const [firstStart, duplicateStart] = await Promise.all([
      api({ path: '/api/daily-puzzle/start', method: 'POST', body: { runDate: puzzleDate } }),
      api({ path: '/api/daily-puzzle/start', method: 'POST', body: { runDate: puzzleDate } }),
    ]);
    const attempt = firstStart.attempt as DailyPuzzleAttempt;
    const duplicateAttempt = duplicateStart.attempt as DailyPuzzleAttempt;
    if (!attempt?.id || duplicateAttempt?.id !== attempt.id) throw new Error('Daily Puzzle start was not idempotent.');
    const completed = await driveDailyPuzzleFiveSlotAttempt({
      attemptId: attempt.id,
      puzzleDate,
      slots,
      request: api,
    });
    const replayedCompletion = await api({
      path: '/api/daily-puzzle/complete',
      method: 'POST',
      body: { attemptId: attempt.id, puzzleDate },
    });
    if (replayedCompletion.replayed !== true) throw new Error('Daily Puzzle completion replay was not idempotent.');
    const elapsedMs = Date.now() - startedAt;
    latencies.push(elapsedMs);
    return {
      attemptId: attempt.id,
      puzzleDate,
      elapsedMs,
      totalScore: ((completed.attempt as DailyPuzzleAttempt | undefined)?.totalScore) ?? null,
    };
  } finally {
    await deleteEphemeralUser({ id: user.id, supabaseUrl, serviceKey, timeoutMs });
  }
}

async function main(): Promise<void> {
  const results = await runInWaves({
    total: users,
    concurrency,
    worker: runUser,
    onWave: (completed, total) => process.stdout.write(`${JSON.stringify({ phase: 'wave_completed', completed, total })}\n`),
  });
  process.stdout.write(`${JSON.stringify({
    mode: 'daily-puzzle',
    users,
    concurrency,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    results,
  }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
