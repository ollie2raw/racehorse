/**
 * One-time seed for the authenticated mobile-reachability pass (issue #116).
 *
 * The reachability harness's authed pass (`npm run e2e:reachability:authed`)
 * signs in as the approved QA account so `/friends`, `/stats`, `/settings` etc.
 * render real content instead of the signed-out gate. `/stats` and `/settings`
 * only need a signed-in session; `/friends` needs actual friend rows. This
 * script gives the QA account three accepted friendships, idempotently.
 *
 * It creates three clearly-marked, unroutable throwaway friend accounts
 * (`*@qa.invalid`, RFC 6761 reserved) + their `profiles` rows, then inserts
 * `friends` rows with status `accepted` using the service key (which bypasses
 * the RLS policy that stops a client inserting anything but `pending`).
 *
 *   Requires (env, or client/.env + server/.env):
 *     SUPABASE_URL, SUPABASE_SERVICE_KEY   (server/.env)
 *     DAILY_FRITZ_QA_USER_ID               (the approved QA account, uuid)
 *
 *   Usage:
 *     DAILY_FRITZ_QA_USER_ID=<uuid> node client/scripts/seedReachabilityQaData.mjs [--dry-run]
 *
 * This writes to production. It only ADDS marked test rows; it never deletes or
 * modifies anything else. Run it once; re-runs are no-ops.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

const FRIENDS = [
  { email: 'reachability-qa-friend-1@qa.invalid', username: 'reach_qa_friend_1' },
  { email: 'reachability-qa-friend-2@qa.invalid', username: 'reach_qa_friend_2' },
  { email: 'reachability-qa-friend-3@qa.invalid', username: 'reach_qa_friend_3' },
];

function loadEnvFile(relPath) {
  try {
    const raw = readFileSync(resolve(__dirname, relPath), 'utf8');
    const env = {};
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq > 0) env[t.slice(0, eq)] = t.slice(eq + 1);
    }
    return env;
  } catch {
    return {};
  }
}

const fileEnv = { ...loadEnvFile('../.env'), ...loadEnvFile('../../server/.env') };
const cfg = {
  url: process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL,
  serviceKey: process.env.SUPABASE_SERVICE_KEY ?? fileEnv.SUPABASE_SERVICE_KEY,
  qaUserId: process.env.DAILY_FRITZ_QA_USER_ID?.trim(),
};

for (const [k, v] of Object.entries(cfg)) {
  if (!v) {
    console.error(`Missing ${k === 'qaUserId' ? 'DAILY_FRITZ_QA_USER_ID' : k.toUpperCase()}.`);
    process.exit(1);
  }
}

const svc = {
  apikey: cfg.serviceKey,
  Authorization: `Bearer ${cfg.serviceKey}`,
  'Content-Type': 'application/json',
};

async function api(path, init = {}) {
  const res = await fetch(new URL(path, cfg.url), { ...init, headers: { ...svc, ...init.headers } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Find an auth user by email (admin API), or create it (confirmed). Returns its id. */
async function ensureFriendUser({ email, username }) {
  const found = await api(`/auth/v1/admin/users?email=${encodeURIComponent(email)}`);
  const existing = (found?.users ?? found)?.find?.((u) => u.email === email) ?? null;
  if (existing) return existing.id;
  if (DRY_RUN) {
    console.log(`  [dry-run] would create auth user ${email}`);
    return null;
  }
  const created = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password: crypto.randomUUID() + crypto.randomUUID(),
      email_confirm: true,
      user_metadata: { username, seeded_by: 'seedReachabilityQaData' },
    }),
  });
  return created.id;
}

async function ensureProfile(id, username) {
  const rows = await api(`/rest/v1/profiles?id=eq.${id}&select=id`);
  if (rows?.length) return;
  if (DRY_RUN) return void console.log(`  [dry-run] would insert profile ${username}`);
  await api('/rest/v1/profiles', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({ id, username }),
  });
}

async function ensureFriendship(friendId) {
  const rows = await api(
    `/rest/v1/friends?select=id,status&or=(and(user_id.eq.${cfg.qaUserId},friend_user_id.eq.${friendId}),and(user_id.eq.${friendId},friend_user_id.eq.${cfg.qaUserId}))`,
  );
  if (rows?.some((r) => r.status === 'accepted')) return 'already-accepted';
  if (DRY_RUN) {
    console.log(`  [dry-run] would insert friends row (accepted) qa↔${friendId}`);
    return 'would-create';
  }
  await api('/rest/v1/friends', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: cfg.qaUserId, friend_user_id: friendId, status: 'accepted' }),
  });
  return 'created';
}

console.log(
  `${DRY_RUN ? '[dry-run] ' : ''}Seeding 3 accepted friendships for QA user ${cfg.qaUserId} @ ${cfg.url}`,
);
for (const friend of FRIENDS) {
  console.log(`- ${friend.username}`);
  const id = await ensureFriendUser(friend);
  if (!id) continue;
  await ensureProfile(id, friend.username);
  console.log(`  friendship: ${await ensureFriendship(id)}`);
}
console.log('Done. Run `npm run qa:capture-auth` if the QA session fixture is stale, then `npm run e2e:reachability:authed`.');
