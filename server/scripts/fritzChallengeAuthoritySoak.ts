import '../src/loadEnv';
import {
  DAILY_FRITZ_VERIFIER_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
} from '@racehorse/game-core';
import { DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION } from '../src/http/routes/dailyFritzVerificationPolicy';
import {
  driveFritzChallengeAttempt,
  parseFritzChallengeLifecycleStart,
} from '../src/testing/fritzChallengeLifecycleDriver';
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

const baseUrl = (process.env.FRITZ_CHALLENGE_SOAK_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const supabaseUrl = requiredEnv('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = requiredEnv('SUPABASE_SERVICE_KEY');
const anonKey = requiredEnv('VITE_SUPABASE_ANON_KEY');
const pairs = positiveInt(process.env.FRITZ_CHALLENGE_SOAK_PAIRS, 1);
const concurrency = positiveInt(process.env.FRITZ_CHALLENGE_SOAK_CONCURRENCY, 1);
const timeoutMs = positiveInt(process.env.FRITZ_CHALLENGE_SOAK_TIMEOUT_MS, 20_000);
const latencies: number[] = [];

const userInput = { supabaseUrl, serviceKey, anonKey, timeoutMs };
const startBody = {
  verification_protocol_version: DAILY_FRITZ_VERIFICATION_PROTOCOL_VERSION,
  game_rules_version: GAME_RULES_VERSION,
  fritz_policy_version: FRITZ_POLICY_VERSION,
  verifier_version: DAILY_FRITZ_VERIFIER_VERSION,
};

async function seedFriendship(creatorId: string, recipientId: string): Promise<void> {
  await fetchJson<Json[]>(`${supabaseUrl}/rest/v1/friends?on_conflict=user_id,friend_user_id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify([{ user_id: creatorId, friend_user_id: recipientId, status: 'accepted' }]),
  }, timeoutMs, [200, 201]);
}

async function runPair(index: number): Promise<Json> {
  const creator = await createEphemeralUser({ ...userInput, prefix: `fc-soak-creator-${index}` });
  const recipient = await createEphemeralUser({ ...userInput, prefix: `fc-soak-recipient-${index}` });
  const startedAt = Date.now();
  try {
    await seedFriendship(creator.id, recipient.id);
    const creatorApi = createApi({ baseUrl, token: creator.accessToken, timeoutMs });
    const recipientApi = createApi({ baseUrl, token: recipient.accessToken, timeoutMs });
    const created = await creatorApi({
      path: '/api/fritz-challenges',
      method: 'POST',
      body: { fritz_tier: 'master', deal_size: 7, recipient_user_id: recipient.id },
    });
    const challenge = created.challenge as Json;
    const shareCode = String(challenge.share_code ?? '');
    if (!shareCode) throw new Error('Challenge creation did not return a share code.');
    await recipientApi({ path: `/api/fritz-challenges/${shareCode}/join`, method: 'POST', body: {} });

    const [creatorStartRaw, recipientStartRaw] = await Promise.all([
      creatorApi({ path: `/api/fritz-challenges/${shareCode}/start`, method: 'POST', body: startBody }),
      recipientApi({ path: `/api/fritz-challenges/${shareCode}/start`, method: 'POST', body: startBody }),
    ]);
    const [creatorResult, recipientResult] = await Promise.all([
      driveFritzChallengeAttempt({
        shareCode,
        start: parseFritzChallengeLifecycleStart(creatorStartRaw),
        request: creatorApi,
      }),
      driveFritzChallengeAttempt({
        shareCode,
        start: parseFritzChallengeLifecycleStart(recipientStartRaw),
        request: recipientApi,
      }),
    ]);
    const finalView = await fetchJson<Json>(`${baseUrl}/api/fritz-challenges/${shareCode}`, {
      headers: { authorization: `Bearer ${creator.accessToken}` },
    }, timeoutMs);
    const elapsedMs = Date.now() - startedAt;
    latencies.push(elapsedMs);
    return {
      shareCode,
      elapsedMs,
      creator: creatorResult,
      recipient: recipientResult,
      finalStatus: (finalView.challenge as Json | undefined)?.status ?? null,
    };
  } finally {
    await Promise.allSettled([
      deleteEphemeralUser({ id: creator.id, supabaseUrl, serviceKey, timeoutMs }),
      deleteEphemeralUser({ id: recipient.id, supabaseUrl, serviceKey, timeoutMs }),
    ]);
  }
}

async function main(): Promise<void> {
  const results = await runInWaves({
    total: pairs,
    concurrency,
    worker: runPair,
    onWave: (completed, total) => process.stdout.write(`${JSON.stringify({ phase: 'wave_completed', completed, total })}\n`),
  });
  process.stdout.write(`${JSON.stringify({
    mode: 'fritz-challenge',
    pairs,
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
