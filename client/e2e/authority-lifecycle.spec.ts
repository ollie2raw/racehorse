import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { DailyPuzzleAttempt, DailyPuzzleSlot } from '../../server/src/dailyPuzzle';
import type * as ChallengeDriver from '../../server/src/testing/fritzChallengeLifecycleDriver';
import type * as DailyFritzDriver from '../../server/src/testing/dailyFritzLifecycleDriver';
import type * as PuzzleDriver from '../../server/src/testing/dailyPuzzleLifecycleDriver';

const require = createRequire(import.meta.url);
const {
  DAILY_FRITZ_VERIFIER_VERSION,
  DAILY_FRITZ_AUTHORITY_STATE_DIGEST_VERSION,
  DAILY_FRITZ_TRANSCRIPT_PROTOCOL_VERSION,
  FRITZ_POLICY_VERSION,
  GAME_RULES_VERSION,
  getFritzPolicyContract,
} = require('@racehorse/game-core') as typeof import('@racehorse/game-core');
const {
  driveFritzChallengeAttempt,
  parseFritzChallengeLifecycleStart,
} = require('../../server/dist/testing/fritzChallengeLifecycleDriver.js') as typeof ChallengeDriver;
const {
  driveDailyFritzAttempt,
  parseDailyFritzLifecycleStart,
} = require('../../server/dist/testing/dailyFritzLifecycleDriver.js') as typeof DailyFritzDriver;
const {
  driveDailyPuzzleFiveSlotAttempt,
} = require('../../server/dist/testing/dailyPuzzleLifecycleDriver.js') as typeof PuzzleDriver;

type Json = Record<string, unknown>;
type StorageState = {
  origins?: Array<{ localStorage?: Array<{ name: string; value: string }> }>;
};

const enabled = process.env.RUN_AUTHORITY_E2E === '1';
const apiBaseUrl = (process.env.PLAYWRIGHT_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '') ?? '';
const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? '';

test.describe('authenticated authority lifecycle contracts', () => {
  test.skip(!enabled, 'Set RUN_AUTHORITY_E2E=1 with Supabase credentials to run authority lifecycle E2E.');

  test('Challenge creator and recipient accept, complete, and review the same verified set', async ({ browser }) => {
    const identities = JSON.parse(await fs.readFile('.auth/e2e-user-ids.json', 'utf8')) as {
      hostId: string;
      guestId: string;
    };
    const [hostToken, guestToken] = await Promise.all([
      readAccessToken('.auth/host.json'),
      readAccessToken('.auth/guest.json'),
    ]);
    await seedFriendship(identities.hostId, identities.guestId);

    const created = await api(hostToken, '/api/fritz-challenges', {
      fritz_tier: 'master',
      deal_size: 7,
      recipient_user_id: identities.guestId,
    });
    const challenge = created.challenge as Json;
    const shareCode = String(challenge.share_code ?? '');
    expect(shareCode).toMatch(/^[A-Z0-9]{8}$/);

    const hostContext = await browser.newContext({ storageState: '.auth/host.json' });
    const guestContext = await browser.newContext({ storageState: '.auth/guest.json' });
    try {
      const [hostPage, guestPage] = await Promise.all([hostContext.newPage(), guestContext.newPage()]);
      await Promise.all([
        hostPage.goto(`/#/fritz/challenge/${shareCode}`),
        guestPage.goto(`/#/fritz/challenge/${shareCode}`),
      ]);
      await expect(guestPage.getByRole('button', { name: 'Accept Challenge' })).toBeVisible();
      await guestPage.getByRole('button', { name: 'Accept Challenge' }).click();
      await expect(guestPage.getByText('Accepted', { exact: true })).toBeVisible();

      const startBody = {
        verification_protocol_version: 1,
        game_rules_version: GAME_RULES_VERSION,
        fritz_policy_version: FRITZ_POLICY_VERSION,
        verifier_version: DAILY_FRITZ_VERIFIER_VERSION,
      };
      const [hostStart, guestStart] = await Promise.all([
        api(hostToken, `/api/fritz-challenges/${shareCode}/start`, startBody),
        api(guestToken, `/api/fritz-challenges/${shareCode}/start`, startBody),
      ]);
      await Promise.all([
        driveFritzChallengeAttempt({
          shareCode,
          start: parseFritzChallengeLifecycleStart(hostStart),
          request: ({ path: pathname, body }) => api(hostToken, pathname, body),
        }),
        driveFritzChallengeAttempt({
          shareCode,
          start: parseFritzChallengeLifecycleStart(guestStart),
          request: ({ path: pathname, body }) => api(guestToken, pathname, body),
        }),
      ]);

      await assertVerifiedChallengeResult(hostPage, shareCode);
      await assertVerifiedChallengeResult(guestPage, shareCode);
    } finally {
      await Promise.all([hostContext.close(), guestContext.close()]);
    }
  });

  test('Daily Puzzle persists all five verified slots and renders completed ladder state', async ({ browser }) => {
    const token = await readAccessToken('.auth/host.json');
    const today = await getApi(token, '/api/daily-puzzle/today');
    const puzzleDate = String(today.runDate ?? '');
    const slots = today.slots as DailyPuzzleSlot[];
    expect(slots).toHaveLength(5);
    const started = await api(token, '/api/daily-puzzle/start', { runDate: puzzleDate });
    const attempt = started.attempt as DailyPuzzleAttempt;
    await driveDailyPuzzleFiveSlotAttempt({
      attemptId: attempt.id,
      puzzleDate,
      slots,
      request: ({ path: pathname, body }) => api(token, pathname, body),
    });

    const context = await browser.newContext({ storageState: '.auth/host.json' });
    try {
      const page = await context.newPage();
      await page.goto('/#/daily');
      await expect(page.getByText(/Practice Mode|Completed/i).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Puzzle 5', { exact: true }).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('Daily Fritz completes the published best-of-three and renders its verified result', async ({ browser }) => {
    const token = await readAccessToken('.auth/host.json');
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
      client_release: 'playwright-authority-lifecycle',
    };
    const started = await api(token, '/api/daily-fritz/start', startBody);
    await driveDailyFritzAttempt({
      start: parseDailyFritzLifecycleStart(started),
      startBody,
      request: ({ path: pathname, body }) => api(token, pathname, body),
    });
    const today = await getApi(token, '/api/daily-fritz/today');
    expect(today.attempt_status).toBe('completed');

    const context = await browser.newContext({ storageState: '.auth/host.json' });
    try {
      const page = await context.newPage();
      await page.goto('/#/daily-fritz');
      await expect(page.getByText(/Verified result recorded|Daily Fritz/i).first()).toBeVisible({ timeout: 20_000 });
    } finally {
      await context.close();
    }
  });
});

async function assertVerifiedChallengeResult(page: Page, shareCode: string): Promise<void> {
  await page.goto(`/#/fritz/challenge/${shareCode}`);
  await expect(page.getByText('Verified set complete.')).toBeVisible({ timeout: 20_000 });
}

async function readAccessToken(storageStatePath: string): Promise<string> {
  const state = JSON.parse(await fs.readFile(path.resolve(storageStatePath), 'utf8')) as StorageState;
  for (const origin of state.origins ?? []) {
    for (const entry of origin.localStorage ?? []) {
      if (!entry.name.endsWith('-auth-token')) continue;
      const session = JSON.parse(entry.value) as { access_token?: string };
      if (session.access_token) return session.access_token;
    }
  }
  throw new Error(`No Supabase access token found in ${storageStatePath}.`);
}

async function seedFriendship(hostId: string, guestId: string): Promise<void> {
  if (!supabaseUrl || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  const response = await fetch(`${supabaseUrl}/rest/v1/friends?on_conflict=user_id,friend_user_id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify([{ user_id: hostId, friend_user_id: guestId, status: 'accepted' }]),
  });
  if (!response.ok) throw new Error(`Friendship seed failed: ${response.status} ${await response.text()}`);
}

async function api(token: string, pathname: string, body: Json): Promise<Json> {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(`POST ${pathname} failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
}

async function getApi(token: string, pathname: string): Promise<Json> {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const json = await response.json().catch(() => ({})) as Json;
  if (!response.ok) throw new Error(`GET ${pathname} failed: ${response.status} ${JSON.stringify(json)}`);
  return json;
}
