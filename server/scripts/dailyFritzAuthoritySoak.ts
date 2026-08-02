import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import '../src/loadEnv';
import {
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
  type DailyFritzTranscript,
} from '@racehorse/game-core';
import type { DailyFritzDrawWinner, DailyFritzHandDeal, DailyFritzTier } from '../src/dailyFritz';
import { buildHonestDailyFritzHandTranscript } from '../src/testing/dailyFritzTranscriptDriver';

function applyEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key] != null) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

applyEnvFile(path.resolve(process.cwd(), '../client/.env'));

type Json = Record<string, unknown>;
type StartPackage = Json & {
  attempt_id: string;
  verified_match_id: string;
  run_date: string;
  challenge_id: string;
  authority_revision: number;
  current_hand_index: number;
  current_game_number: 1 | 2 | 3;
  current_game_scores: { you: number; fritz: number };
  fritz_tier: DailyFritzTier;
  fritz_policy_version: 1 | 2;
  deal_size: 7 | 14;
  winning_score: number;
  first_hand: DailyFritzHandDeal;
  draw_winner: DailyFritzDrawWinner;
};
type HandPackage = Json & {
  current_hand_index: number;
  authority_revision: number;
  current_game_scores: { you: number; fritz: number };
  hand: DailyFritzHandDeal;
  replayed?: boolean;
};

const baseUrl = (process.env.DAILY_FRITZ_SOAK_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
const serviceKey = required('SUPABASE_SERVICE_KEY');
const anonKey = required('VITE_SUPABASE_ANON_KEY');
const users = positiveInt(process.env.DAILY_FRITZ_SOAK_USERS, 1);
const concurrency = positiveInt(process.env.DAILY_FRITZ_SOAK_CONCURRENCY, 1);
const timeoutMs = positiveInt(process.env.DAILY_FRITZ_SOAK_TIMEOUT_MS, 20_000);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchJson<T>(url: string, init: RequestInit, expected = [200]): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const body = await response.json().catch(() => ({})) as Json;
  if (!expected.includes(response.status)) {
    throw new Error(`${init.method ?? 'GET'} ${url} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function createUser(): Promise<{ id: string; accessToken: string }> {
  const id = randomUUID();
  const email = `df-soak-${id}@racehorse-test.invalid`;
  const password = `Df-${randomUUID()}-Aa9!`;
  const created = await fetchJson<Json>(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const userId = String(created.id ?? '');
  if (!userId) throw new Error('Supabase did not return an ephemeral user ID.');
  const signedIn = await fetchJson<Json>(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const accessToken = String(signedIn.access_token ?? '');
  if (!accessToken) throw new Error('Supabase did not return an ephemeral access token.');
  return { id: userId, accessToken };
}

async function deleteUser(id: string): Promise<void> {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`Failed to remove ephemeral soak user ${id}: ${response.status}`);
  }
}

function api(token: string, pathName: string, body?: Json): Promise<Json> {
  return fetchJson<Json>(`${baseUrl}${pathName}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function apiExpect(token: string, pathName: string, body: Json, expected: number[]): Promise<Json> {
  return fetchJson<Json>(`${baseUrl}${pathName}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, expected);
}

const startBody = {
  verification_protocol_version: DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  game_rules_version: GAME_RULES_VERSION,
  fritz_policy_version: FRITZ_POLICY_VERSION,
  fritz_policy_contract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
  state_digest_version: DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  supported_transcript_protocol_versions: [DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION],
  supported_fritz_policies: [{
    version: FRITZ_POLICY_VERSION,
    contract: getFritzPolicyContract(FRITZ_POLICY_VERSION),
  }],
  supported_state_digest_versions: [DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION],
  client_release: 'daily-fritz-authority-soak',
};

function handCommand(pkg: StartPackage, handIndex: number, transcript: DailyFritzTranscript): Json {
  return {
    attempt_id: pkg.attempt_id,
    verified_match_id: pkg.verified_match_id,
    run_date: pkg.run_date,
    game_number: 1,
    completed_hand_index: handIndex,
    transcript,
  };
}

async function assertAuthorityRows(attemptId: string, expectedHands: number): Promise<void> {
  const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
  let rows: {
    hands: Json[]; games: Json[]; operations: Json[]; outbox: Json[]; events: Json[];
  } | null = null;
  const auditDeadline = Date.now() + 10_000;
  do {
    const [hands, games, operations, outbox, events] = await Promise.all([
      fetchJson<Json[]>(`${supabaseUrl}/rest/v1/daily_fritz_verified_hands?select=hand_index&attempt_id=eq.${attemptId}`, { headers }),
      fetchJson<Json[]>(`${supabaseUrl}/rest/v1/daily_fritz_verified_games?select=game_number&attempt_id=eq.${attemptId}`, { headers }),
      fetchJson<Json[]>(`${supabaseUrl}/rest/v1/daily_fritz_attempt_operations?select=operation_id,status&attempt_id=eq.${attemptId}`, { headers }),
      fetchJson<Json[]>(`${supabaseUrl}/rest/v1/daily_fritz_outbox?select=event_type,analytics_projected_at&attempt_id=eq.${attemptId}`, { headers }),
      fetchJson<Json[]>(`${supabaseUrl}/rest/v1/daily_fritz_events?select=event_type,source,idempotency_key&attempt_id=eq.${attemptId}&source=eq.outbox`, { headers }),
    ]);
    rows = { hands, games, operations, outbox, events };
    const auditComplete = hands.length === expectedHands
      && games.length === 1
      && outbox.some((row) => row.event_type === 'game_recorded')
      && outbox.every((row) => Boolean(row.analytics_projected_at))
      && events.filter((row) => row.event_type === 'game_recorded').length === 1;
    if (auditComplete) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < auditDeadline);

  if (!rows) throw new Error('Authority audit returned no database response.');
  const { hands, games, operations, outbox, events } = rows;
  const evidence = JSON.stringify({
    attemptId,
    expectedHands,
    handCount: hands.length,
    gameCount: games.length,
    operations: operations.map((row) => row.operation_id),
    outbox: outbox.map((row) => ({ type: row.event_type, projected: Boolean(row.analytics_projected_at) })),
    events: events.map((row) => ({ type: row.event_type, source: row.source })),
  });
  if (hands.length !== expectedHands) throw new Error(`Expected ${expectedHands} verified hands, found ${hands.length}.`);
  if (games.length !== 1) throw new Error(`Expected one verified game, found ${games.length}.`);
  if (new Set(operations.map((row) => row.operation_id)).size !== operations.length) {
    throw new Error('Duplicate durable operation receipts detected.');
  }
  if (!outbox.some((row) => row.event_type === 'game_recorded')) {
    throw new Error(`Game authority committed without its transactional outbox event: ${evidence}`);
  }
  if (outbox.some((row) => !row.analytics_projected_at)) {
    throw new Error(`Committed authority outbox event was not projected into canonical analytics: ${evidence}`);
  }
  const gameEvents = events.filter((row) => row.event_type === 'game_recorded');
  if (gameEvents.length !== 1 || gameEvents[0]?.source !== 'outbox') {
    throw new Error(`Expected exactly one canonical outbox game event, found ${gameEvents.length}: ${evidence}`);
  }
  if (new Set(events.map((row) => row.idempotency_key)).size !== events.length) {
    throw new Error('Duplicate canonical analytics identities detected.');
  }
}

async function runOne(index: number): Promise<Json> {
  const startedAt = Date.now();
  const user = await createUser();
  try {
    const starts = await Promise.all([
      api(user.accessToken, '/api/daily-fritz/start', startBody),
      api(user.accessToken, '/api/daily-fritz/start', startBody),
    ]) as StartPackage[];
    const pkg = starts[0];
    if (starts.some((value) => value.attempt_id !== pkg.attempt_id || value.challenge_id !== pkg.challenge_id)) {
      throw new Error('Concurrent starts did not resolve to one attempt and challenge.');
    }

    let handIndex = pkg.current_hand_index;
    let hand = pkg.first_hand;
    let scores = pkg.current_game_scores;
    let handCount = 0;
    let lastTranscript: DailyFritzTranscript | null = null;

    while (handCount < 64) {
      const driven = buildHonestDailyFritzHandTranscript({
        challengeId: pkg.challenge_id,
        attemptId: pkg.attempt_id,
        gameNumber: 1,
        handIndex,
        deal: hand,
        drawWinner: pkg.draw_winner,
        winningScore: pkg.winning_score,
        dealSize: pkg.deal_size,
        playerScore: scores.you,
        fritzScore: scores.fritz,
        fritzTier: pkg.fritz_tier,
        fritzPolicyVersion: pkg.fritz_policy_version,
      });
      lastTranscript = driven.transcript;
      handCount += 1;
      if (driven.terminalState.gameOver) break;

      const command = handCommand(pkg, handIndex, driven.transcript);
      let next: HandPackage;
      if (handCount === 1) {
        const duplicates = await Promise.all([
          api(user.accessToken, '/api/daily-fritz/next-hand', command),
          api(user.accessToken, '/api/daily-fritz/next-hand', command),
        ]) as HandPackage[];
        if (!duplicates.some((value) => value.replayed === true)) {
          throw new Error('Concurrent duplicate hand command did not replay the durable result.');
        }
        next = duplicates[0].current_hand_index >= duplicates[1].current_hand_index
          ? duplicates[0] : duplicates[1];
        const alternate = buildHonestDailyFritzHandTranscript({
          challengeId: pkg.challenge_id,
          attemptId: pkg.attempt_id,
          gameNumber: 1,
          handIndex,
          deal: hand,
          drawWinner: pkg.draw_winner,
          winningScore: pkg.winning_score,
          dealSize: pkg.deal_size,
          playerScore: scores.you,
          fritzScore: scores.fritz,
          fritzTier: pkg.fritz_tier,
          fritzPolicyVersion: pkg.fritz_policy_version,
          playerPolicy: 'last_legal',
        });
        if (JSON.stringify(alternate.transcript.actions) !== JSON.stringify(driven.transcript.actions)) {
          const conflict = await apiExpect(
            user.accessToken,
            '/api/daily-fritz/next-hand',
            handCommand(pkg, handIndex, alternate.transcript),
            [409],
          );
          if (conflict.code !== 'verified_hand_conflict'
            || conflict.recoverable !== true
            || conflict.recovery_action !== 'reload_official_hand') {
            throw new Error(`Cross-device conflict was not recoverable: ${JSON.stringify(conflict)}`);
          }
        }
      } else if (handCount === 2) {
        await api(user.accessToken, '/api/daily-fritz/next-hand', command); // Simulated lost response.
        next = await api(user.accessToken, '/api/daily-fritz/next-hand', command) as HandPackage;
        if (next.replayed !== true) throw new Error('Lost-response retry was not replayed idempotently.');
      } else {
        next = await api(user.accessToken, '/api/daily-fritz/next-hand', command) as HandPackage;
      }
      handIndex = next.current_hand_index;
      hand = next.hand;
      scores = next.current_game_scores;

      if (handCount === 2) {
        const today = await api(user.accessToken, '/api/daily-fritz/today');
        const resumed = await api(user.accessToken, '/api/daily-fritz/start', startBody) as StartPackage;
        if (today.attempt_status !== 'started' || resumed.current_hand_index !== handIndex) {
          throw new Error('Refresh/reconnect did not return the authoritative hand index.');
        }
        hand = resumed.first_hand;
        scores = resumed.current_game_scores;
      }
    }
    if (!lastTranscript) throw new Error('Game one produced no terminal transcript.');

    const recordBody = {
      attempt_id: pkg.attempt_id,
      verified_match_id: pkg.verified_match_id,
      run_date: pkg.run_date,
      game_number: 1,
      transcript: lastTranscript,
    };
    const gameResults = await Promise.all([
      api(user.accessToken, '/api/daily-fritz/record-game', recordBody),
      api(user.accessToken, '/api/daily-fritz/record-game', recordBody),
    ]);
    if (gameResults.some((value) => !value.set_result)) {
      throw new Error('Game-one verification did not return a set result.');
    }
    await assertAuthorityRows(pkg.attempt_id, handCount);
    return { index, attemptId: pkg.attempt_id, handCount, elapsedMs: Date.now() - startedAt };
  } finally {
    await deleteUser(user.id);
  }
}

async function main(): Promise<void> {
  const results: Json[] = [];
  process.stdout.write(`${JSON.stringify({
    phase: 'started',
    users,
    concurrency,
    baseUrl,
  })}\n`);
  for (let offset = 0; offset < users; offset += concurrency) {
    const wave = Array.from({ length: Math.min(concurrency, users - offset) }, (_, waveIndex) =>
      runOne(offset + waveIndex));
    const completed = await Promise.all(wave);
    results.push(...completed);
    process.stdout.write(`${JSON.stringify({
      phase: 'wave_completed',
      completedUsers: results.length,
      users,
    })}\n`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, users, concurrency, baseUrl, results }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
