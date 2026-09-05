/**
 * Guardrail #6 (ENGINEERING_GUARDRAILS.md) — account-deletion cascade
 * completeness.
 *
 * Closes the SA-6 class of bug: a `user_id`/`player_id`-shaped foreign key to
 * `public.profiles(id)` or `auth.users(id)` that does NOT cascade on delete,
 * so `DELETE /api/account` 500s with a raw `23503` for any user who has a row
 * in that table (`bot_match_pending`'s `user_id` FK had no `ON DELETE` action
 * at all — RESTRICT by default — while every sibling table cascaded). SA-6 was
 * found only because a human traced the account-deletion flow by hand.
 *
 * Queries the live database via list_cascade_delete_manifest()
 * (2026-09-05_cascade_delete_manifest_rpc.sql, service_role-only) and checks
 * every FK it returns: `confdeltype` must be `'c'` (cascade), UNLESS the
 * (table, columns) pair is listed in ../../supabase/cascade-delete-allowlist.json
 * with a recorded reason AND the allow-listed `confdeltype` matches live. Any
 * un-allow-listed non-cascade FK, any allow-listed FK whose live action drifted
 * from what the allow-list records, and any allow-list entry that matches no
 * live FK all fail the build.
 *
 * Run: `npm run check:cascade-delete` (server/), needs SUPABASE_URL +
 * SUPABASE_SERVICE_KEY in the environment.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/loadEnv';

export type LiveConstraintRow = {
  schemaname: string;
  tablename: string;
  constraint_name: string;
  column_names: string[];
  referenced_table: string;
  referenced_columns: string[];
  confdeltype: string;
};

export type CascadeAllowlistEntry = {
  table: string;
  columns: string[];
  /** The exact non-cascade action this FK is allowed to have ('n' | 'r' | 'a' | 'd'). */
  confdeltype: string;
  reason: string;
  _source?: string;
};

export type CascadeAllowlist = {
  exceptions: CascadeAllowlistEntry[];
};

export type CascadeDiffFinding = {
  table: string;
  columns: string[];
  kind: 'missing_cascade' | 'wrong_action' | 'stale_allowlist_entry';
  detail: string;
};

export type CascadeDiffResult = {
  findings: CascadeDiffFinding[];
  /** (table, columns) of every FK that correctly cascades. */
  cascading: string[];
  /** (table, columns) of every FK that is a recorded, matched exception. */
  allowedExceptions: string[];
};

const CONFDELTYPE_LABEL: Record<string, string> = {
  c: 'CASCADE',
  r: 'RESTRICT',
  n: 'SET NULL',
  d: 'SET DEFAULT',
  a: 'NO ACTION',
};

function label(code: string): string {
  return CONFDELTYPE_LABEL[code] ?? code;
}

function fkKey(table: string, columns: string[]): string {
  return `${table}(${[...columns].sort().join(', ')})`;
}

/**
 * Pure diff — no I/O. Exported so the negative-test case (an FK that should
 * cascade but doesn't — the exact SA-6 shape) can be proven without touching
 * the live database.
 */
export function diffCascadeDeleteManifest(
  live: LiveConstraintRow[],
  allowlist: CascadeAllowlist,
): CascadeDiffResult {
  const findings: CascadeDiffFinding[] = [];
  const cascading: string[] = [];
  const allowedExceptions: string[] = [];

  const allowByKey = new Map(
    allowlist.exceptions.map((e) => [fkKey(e.table, e.columns), e] as const),
  );
  const matchedAllowKeys = new Set<string>();

  for (const row of live) {
    const key = fkKey(row.tablename, row.column_names);

    if (row.confdeltype === 'c') {
      cascading.push(key);
      continue;
    }

    const allowed = allowByKey.get(key);
    if (!allowed) {
      findings.push({
        table: row.tablename,
        columns: row.column_names,
        kind: 'missing_cascade',
        detail:
          `FK ${row.constraint_name} on public.${key} references ${row.referenced_table} `
          + `but its ON DELETE action is ${label(row.confdeltype)}, not CASCADE — a deleted `
          + `user with a row here breaks DELETE /api/account. Add "on delete cascade", or if `
          + `this row is genuinely meant to survive account deletion, add an entry to `
          + `supabase/cascade-delete-allowlist.json with a recorded reason.`,
      });
      continue;
    }

    matchedAllowKeys.add(key);

    if (allowed.confdeltype !== row.confdeltype) {
      findings.push({
        table: row.tablename,
        columns: row.column_names,
        kind: 'wrong_action',
        detail:
          `allow-list records public.${key} as ${label(allowed.confdeltype)} `
          + `("${allowed.reason}") but live is ${label(row.confdeltype)} — the exception is `
          + `stale or the FK drifted; reconcile the allow-list with reality.`,
      });
      continue;
    }

    allowedExceptions.push(key);
  }

  for (const entry of allowlist.exceptions) {
    const key = fkKey(entry.table, entry.columns);
    if (!matchedAllowKeys.has(key)) {
      findings.push({
        table: entry.table,
        columns: entry.columns,
        kind: 'stale_allowlist_entry',
        detail:
          `allow-list entry public.${key} matches no live FK targeting profiles/auth.users — `
          + `the constraint was dropped or renamed; remove the entry (or fix its table/columns) `
          + `so a real regression can't hide behind it.`,
      });
    }
  }

  return {
    findings,
    cascading: cascading.sort(),
    allowedExceptions: allowedExceptions.sort(),
  };
}

function loadAllowlist(): CascadeAllowlist {
  const path = join(__dirname, '..', '..', 'supabase', 'cascade-delete-allowlist.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return { exceptions: raw.exceptions };
}

async function fetchLiveConstraints(): Promise<LiveConstraintRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/list_cascade_delete_manifest`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(
      `list_cascade_delete_manifest() call failed: ${response.status} ${body} `
      + `(has 2026-09-05_cascade_delete_manifest_rpc.sql been applied to this database?)`,
    );
  }
  return (await response.json()) as LiveConstraintRow[];
}

async function main(): Promise<void> {
  const allowlist = loadAllowlist();
  const live = await fetchLiveConstraints();
  const result = diffCascadeDeleteManifest(live, allowlist);

  process.stdout.write(
    `Checked ${live.length} FK(s) targeting public.profiles(id) / auth.users(id): `
    + `${result.cascading.length} cascade, ${result.allowedExceptions.length} allow-listed exception(s)\n`,
  );
  if (result.allowedExceptions.length > 0) {
    process.stdout.write(`  allow-listed: ${result.allowedExceptions.join(', ')}\n`);
  }

  if (result.findings.length === 0) {
    process.stdout.write('cascade-delete completeness check clean — every FK cascades or is a recorded exception\n');
    return;
  }

  process.stdout.write(`${result.findings.length} cascade-delete finding(s):\n`);
  for (const f of result.findings) {
    process.stdout.write(`  [${f.kind}] public.${fkKey(f.table, f.columns)}: ${f.detail}\n`);
  }
  process.exitCode = 1;
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
