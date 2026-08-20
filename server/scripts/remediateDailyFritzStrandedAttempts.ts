/**
 * Case-by-case remediation for the 7 stranded Daily Fritz attempts identified
 * in the 2026-08-20 hardening follow-up. Attempt #7 (live Aug 20 rejected run)
 * is intentionally excluded.
 *
 * Default: dry-run (no writes).
 * Apply:    REMEDIATE_APPLY=1 npx tsx scripts/remediateDailyFritzStrandedAttempts.ts
 *
 * Abandon leaves `result` (including any orphan authority hands) untouched —
 * only status + completedAt change.
 */
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

type AttemptRow = {
  id: string;
  run_date: string;
  user_id: string;
  status: string;
  started_at: string;
  revision: number;
  result: Record<string, unknown> | null;
};

const TARGETS: Array<{
  id: string;
  runDate: string;
  kind: 'legacy_orphan' | 'corrupt_ledger';
  note: string;
}> = [
  {
    id: '52ba55c0-442a-442d-b797-5eb379416c94',
    runDate: '2026-07-05',
    kind: 'legacy_orphan',
    note: 'Pre-modern started row: game 1 published, no authority, no events.',
  },
  {
    id: '2ba392c2-5780-4878-a98e-60d85f884580',
    runDate: '2026-07-06',
    kind: 'legacy_orphan',
    note: 'Pre-modern started row: game 1 published, no authority, no events.',
  },
  {
    id: '39816586-d07d-40bb-8122-e42f52ed1981',
    runDate: '2026-07-10',
    kind: 'legacy_orphan',
    note: 'Pre-modern started row: game 1 published, no authority, no events.',
  },
  {
    id: 'f3ac0758-736c-4b2a-99ae-968b27857415',
    runDate: '2026-07-11',
    kind: 'legacy_orphan',
    note: 'Pre-modern started row: game 1 published, no authority, no events.',
  },
  {
    id: '0df1400a-914c-4d4a-8875-a034deb5c261',
    runDate: '2026-07-17',
    kind: 'legacy_orphan',
    note: 'Pre-modern started row: game 1 published, no authority, no events.',
  },
  {
    id: '0b6fe2f8-89a9-4847-8a7d-767bbd46fae2',
    runDate: '2026-07-22',
    kind: 'corrupt_ledger',
    note: 'Corrupt ledger: published game 1 missing receipt; orphan authority hand game 2 / hand 0 left inert.',
  },
];

const EXCLUDED = {
  id: 'e1f0a2f2-ce10-4c65-aab5-c71dc02b1be7',
  reason: 'Live Aug 20 started+rejected run — leave as-is (already unranked).',
};

function loadEnv(): { url: string; key: string } {
  const envPath = resolve(__dirname, '../.env');
  const text = readFileSync(envPath, 'utf8');
  const env: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [k, ...rest] = line.split('=');
    env[k!] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  const url = env.SUPABASE_URL?.replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_KEY missing from server/.env');
  return { url, key };
}

async function supabaseFetch<T>(
  url: string,
  key: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${await response.text()}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function summarizeResult(result: Record<string, unknown> | null) {
  const games = Array.isArray(result?.games) ? result!.games as Array<Record<string, unknown>> : [];
  const authority = result?.authority && typeof result.authority === 'object'
    ? result.authority as Record<string, unknown>
    : {};
  const hands = Array.isArray(authority.hands) ? authority.hands : [];
  const authGames = Array.isArray(authority.games) ? authority.games : [];
  return {
    verification_status: result?.verification_status ?? null,
    published_games: games.map((g) => g.gameNumber),
    authority_games: authGames.map((g) => (g as { gameNumber?: number }).gameNumber),
    authority_hand_pairs: hands.map((h) => {
      const row = h as { gameNumber?: number; handIndex?: number };
      return `${row.gameNumber}/${row.handIndex}`;
    }),
  };
}

function nextResult(kind: 'legacy_orphan' | 'corrupt_ledger', previous: Record<string, unknown> | null) {
  const base = { ...(previous ?? {}) };
  if (kind === 'legacy_orphan') {
    return {
      ...base,
      verification_status: 'legacy_unverified',
      remediation_note: 'abandoned_legacy_orphan_2026-08-20',
    };
  }
  return {
    ...base,
    verification_status: 'rejected',
    remediation_note: 'abandoned_corrupt_ledger_2026-08-20',
    // Intentionally do not touch authority.hands — orphan game-2/hand-0 stays inert.
  };
}

async function main() {
  const apply = process.env.REMEDIATE_APPLY === '1';
  const { url, key } = loadEnv();
  const ids = TARGETS.map((t) => t.id);
  const rows = await supabaseFetch<AttemptRow[]>(
    url,
    key,
    `/rest/v1/daily_fritz_attempts?select=id,run_date,user_id,status,started_at,revision,result&id=in.(${ids.join(',')})&order=started_at.asc`,
  );

  console.log(JSON.stringify({
    mode: apply ? 'APPLY' : 'DRY_RUN',
    excluded: EXCLUDED,
    targets: TARGETS.length,
    fetched: rows.length,
  }, null, 2));

  const byId = new Map(rows.map((r) => [r.id, r]));
  const plan = [];
  for (const target of TARGETS) {
    const row = byId.get(target.id);
    if (!row) {
      plan.push({ id: target.id, action: 'skip_missing', note: target.note });
      continue;
    }
    if (row.status !== 'started') {
      plan.push({
        id: target.id,
        action: 'skip_not_started',
        status: row.status,
        note: target.note,
      });
      continue;
    }
    const before = summarizeResult(row.result);
    const patchedResult = nextResult(target.kind, row.result);
    const after = summarizeResult(patchedResult);
    plan.push({
      id: target.id,
      run_date: row.run_date,
      user_id: row.user_id,
      kind: target.kind,
      note: target.note,
      action: 'abandon',
      revision: row.revision,
      before,
      after,
      authority_hands_unchanged:
        JSON.stringify(before.authority_hand_pairs) === JSON.stringify(after.authority_hand_pairs),
    });

    if (apply) {
      const completedAt = new Date().toISOString();
      const updated = await supabaseFetch<AttemptRow[]>(
        url,
        key,
        `/rest/v1/daily_fritz_attempts?id=eq.${target.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'abandoned',
            completed_at: completedAt,
            result: patchedResult,
            // bump revision for observability; abandon API does the same via upsert
            revision: row.revision + 1,
          }),
        },
      );
      const eventKey = createHash('sha256')
        .update(`remediate:${target.id}:abandoned:${completedAt}`)
        .digest('hex');
      await supabaseFetch(
        url,
        key,
        '/rest/v1/daily_fritz_events?on_conflict=idempotency_key',
        {
          method: 'POST',
          headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify([{
            attempt_id: target.id,
            run_date: row.run_date,
            user_id: row.user_id,
            event_type: 'attempt_abandoned',
            idempotency_key: `remediate:${target.id}:${eventKey.slice(0, 24)}`,
            payload: {
              remediation: true,
              kind: target.kind,
              note: target.note,
              previous_status: 'started',
            },
          }]),
        },
      );
      console.log(JSON.stringify({ applied: target.id, updated: updated?.[0]?.status ?? null }, null, 2));
    }
  }

  console.log(JSON.stringify({ plan }, null, 2));
  if (!apply) {
    console.log('\nDry-run only. Re-run with REMEDIATE_APPLY=1 after human confirm.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
