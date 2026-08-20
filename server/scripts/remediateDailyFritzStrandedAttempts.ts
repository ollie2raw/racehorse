/**
 * Case-by-case remediation for the 7 stranded Daily Fritz attempts identified
 * in the 2026-08-20 hardening follow-up. Attempt #7 (live Aug 20 rejected run)
 * is intentionally excluded.
 *
 * Default: dry-run (no writes).
 * Apply:    REMEDIATE_APPLY=1 npx tsx scripts/remediateDailyFritzStrandedAttempts.ts
 *
 * Safe to re-run: rows already abandoned are skipped (`skip_not_started`).
 * Per-row failures are logged and do not abort the rest of the batch.
 *
 * Abandon leaves orphan authority hands inert — we only set status/completedAt
 * plus a verification_status stamp; authority.hands are not rewritten.
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

/**
 * PostgREST often returns 201 with an empty body when Prefer includes
 * `return=minimal`. Calling response.json() on that throws
 * "Unexpected end of JSON input" (undici) — that crashed the first apply
 * after the first row's event write.
 */
async function supabaseFetch<T>(
  url: string,
  key: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const method = init.method ?? 'GET';
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
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${raw.slice(0, 500)}`);
  }
  if (response.status === 204 || raw.trim() === '') {
    return undefined as T;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `${method} ${path} → ${response.status}: invalid JSON body `
      + `(${raw.length} bytes): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

async function applyOneRow(
  url: string,
  key: string,
  target: (typeof TARGETS)[number],
  row: AttemptRow,
  patchedResult: Record<string, unknown>,
): Promise<{ status: string; revision: number | null }> {
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
        revision: row.revision + 1,
      }),
    },
  );
  const eventKey = createHash('sha256')
    .update(`remediate:${target.id}:abandoned:${completedAt}`)
    .digest('hex');
  // return=minimal is fine now — empty bodies are treated as success.
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
  return {
    status: updated?.[0]?.status ?? 'abandoned',
    revision: updated?.[0]?.revision ?? row.revision + 1,
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
  const plan: Array<Record<string, unknown>> = [];
  const summary = {
    skipped: [] as string[],
    would_apply: [] as string[],
    applied: [] as string[],
    failed: [] as Array<{ id: string; error: string }>,
  };

  for (const target of TARGETS) {
    try {
      const row = byId.get(target.id);
      if (!row) {
        plan.push({ id: target.id, action: 'skip_missing', note: target.note });
        summary.skipped.push(target.id);
        continue;
      }
      if (row.status !== 'started') {
        plan.push({
          id: target.id,
          action: 'skip_not_started',
          status: row.status,
          note: target.note,
        });
        summary.skipped.push(target.id);
        continue;
      }

      const before = summarizeResult(row.result);
      const patchedResult = nextResult(target.kind, row.result);
      const after = summarizeResult(patchedResult);
      const entry: Record<string, unknown> = {
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
      };

      if (!apply) {
        plan.push(entry);
        summary.would_apply.push(target.id);
        continue;
      }

      const applied = await applyOneRow(url, key, target, row, patchedResult);
      entry.apply_result = applied;
      plan.push(entry);
      summary.applied.push(target.id);
      console.log(JSON.stringify({ applied: target.id, ...applied }, null, 2));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plan.push({
        id: target.id,
        action: 'failed',
        note: target.note,
        error: message,
      });
      summary.failed.push({ id: target.id, error: message });
      console.error(JSON.stringify({ failed: target.id, error: message }, null, 2));
    }
  }

  console.log(JSON.stringify({ plan }, null, 2));
  console.log(JSON.stringify({ summary }, null, 2));
  if (!apply) {
    console.log('\nDry-run only. Re-run with REMEDIATE_APPLY=1 after human confirm.');
  }
  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
