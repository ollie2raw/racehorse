/**
 * Guardrail #1 (ENGINEERING_GUARDRAILS.md) — RLS/policy assertions.
 *
 * Closes the RK-0 class of bug: a policy named for one role but actually
 * scoped to another (`ranked_games`'s "Service role can insert ranked
 * games" policy was `to public`, not `to service_role` — RLS enabled, a
 * policy present, everything assert_security_posture() checks for was
 * green, and it was still a live, unauthenticated, zero-skill exploit).
 * assert_security_posture() deliberately treats "RLS on + client write
 * grant" as advisory-only, trusting the policy predicates without ever
 * inspecting them. RK-0 was found only because a human ran a manual
 * `select * from pg_policies` in the SQL editor. This script is what lets
 * that same check run unattended in CI.
 *
 * Queries the live database via list_rls_policy_manifest()
 * (2026-09-04_policy_manifest_rpc.sql, service_role-only) and diffs it
 * against ../../supabase/policy-manifest.json. For every table LISTED in
 * the manifest, the live policy set must match exactly (same policy names,
 * same roles/cmd/qual/with_check) — any drift fails the build. A table
 * present live but NOT listed in the manifest is reported as "unpinned"
 * (visible in the run output) but does not fail the build — see the
 * manifest's own _read_me for why partial coverage is a deliberate,
 * honest starting point rather than a false completeness claim.
 *
 * Run: `npm run check:policy-manifest` (server/), needs SUPABASE_URL +
 * SUPABASE_SERVICE_KEY in the environment.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../src/loadEnv';

export type LivePolicyRow = {
  schemaname: string;
  tablename: string;
  policyname: string;
  roles: string[];
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

export type ManifestPolicy = {
  policyname: string;
  cmd: string;
  roles: string[];
  qual: string | null;
  with_check: string | null;
};

export type PolicyManifest = {
  tables: Record<string, { policies: ManifestPolicy[] }>;
};

export type PolicyDiffFinding = {
  table: string;
  kind: 'missing_policy' | 'unexpected_policy' | 'mismatched_policy';
  policyname: string;
  detail: string;
};

export type PolicyDiffResult = {
  findings: PolicyDiffFinding[];
  unpinnedTables: string[];
  checkedTables: string[];
};

function policyKey(p: { cmd: string; roles: string[]; qual: string | null; with_check: string | null }): string {
  return JSON.stringify({
    cmd: p.cmd,
    roles: [...p.roles].sort(),
    qual: p.qual ?? null,
    with_check: p.with_check ?? null,
  });
}

/**
 * Pure diff — no I/O. Exported so the negative-test case (a deliberately
 * mis-scoped policy) can be proven without touching the live database.
 */
export function diffPolicyManifest(live: LivePolicyRow[], manifest: PolicyManifest): PolicyDiffResult {
  const liveByTable = new Map<string, LivePolicyRow[]>();
  for (const row of live) {
    const list = liveByTable.get(row.tablename) ?? [];
    list.push(row);
    liveByTable.set(row.tablename, list);
  }

  const findings: PolicyDiffFinding[] = [];
  const checkedTables = Object.keys(manifest.tables).sort();

  for (const table of checkedTables) {
    const expected = manifest.tables[table]!.policies;
    const actual = liveByTable.get(table) ?? [];
    const actualByName = new Map(actual.map((row) => [row.policyname, row]));
    const expectedByName = new Map(expected.map((p) => [p.policyname, p]));

    for (const exp of expected) {
      const got = actualByName.get(exp.policyname);
      if (!got) {
        findings.push({
          table,
          kind: 'missing_policy',
          policyname: exp.policyname,
          detail: `expected in manifest but not found live on public.${table}`,
        });
        continue;
      }
      if (policyKey(got) !== policyKey(exp)) {
        findings.push({
          table,
          kind: 'mismatched_policy',
          policyname: exp.policyname,
          detail:
            `expected {cmd:${exp.cmd}, roles:${JSON.stringify(exp.roles)}, qual:${JSON.stringify(exp.qual)}, with_check:${JSON.stringify(exp.with_check)}} `
            + `but live is {cmd:${got.cmd}, roles:${JSON.stringify(got.roles)}, qual:${JSON.stringify(got.qual)}, with_check:${JSON.stringify(got.with_check)}}`,
        });
      }
    }

    for (const got of actual) {
      if (!expectedByName.has(got.policyname)) {
        findings.push({
          table,
          kind: 'unexpected_policy',
          policyname: got.policyname,
          detail: `present live on public.${table} but not in the manifest — either pin it or confirm it's intentional`,
        });
      }
    }
  }

  const pinnedTables = new Set(checkedTables);
  const unpinnedTables = [...liveByTable.keys()].filter((t) => !pinnedTables.has(t)).sort();

  return { findings, unpinnedTables, checkedTables };
}

function loadManifest(): PolicyManifest {
  const path = join(__dirname, '..', '..', 'supabase', 'policy-manifest.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  return { tables: raw.tables };
}

async function fetchLivePolicies(): Promise<LivePolicyRow[]> {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  }
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/list_rls_policy_manifest`, {
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
      `list_rls_policy_manifest() call failed: ${response.status} ${body} `
      + `(has 2026-09-04_policy_manifest_rpc.sql been applied to this database?)`,
    );
  }
  return (await response.json()) as LivePolicyRow[];
}

async function main(): Promise<void> {
  const manifest = loadManifest();
  const live = await fetchLivePolicies();
  const result = diffPolicyManifest(live, manifest);

  process.stdout.write(`Checked ${result.checkedTables.length} pinned table(s): ${result.checkedTables.join(', ')}\n`);
  if (result.unpinnedTables.length > 0) {
    process.stdout.write(
      `${result.unpinnedTables.length} unpinned table(s) with policies exist live but are NOT checked by this manifest: `
      + `${result.unpinnedTables.join(', ')}\n`,
    );
  }

  if (result.findings.length === 0) {
    process.stdout.write('policy manifest check clean — no drift on any pinned table\n');
    return;
  }

  process.stdout.write(`${result.findings.length} policy drift finding(s):\n`);
  for (const f of result.findings) {
    process.stdout.write(`  [${f.kind}] public.${f.table} / "${f.policyname}": ${f.detail}\n`);
  }
  process.exitCode = 1;
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
