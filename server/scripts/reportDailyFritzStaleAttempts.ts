/** READ ONLY: consumes an export by default; optional explicit Supabase GETs. */
import fs from 'node:fs';
import path from 'node:path';
import { readEnvFile } from '../src/envFile';
import { assertNotProductionSupabase } from '../src/platform/env/productionSupabaseGuard';
import { DAILY_FRITZ_RECOVERY_RESULT_FIELDS, projectDailyFritzRecoveryResult, type DailyFritzRecoveryCandidate } from '../src/dailyFritzRecoveryProjection';
import { summarizeDailyFritzStaleAttempt } from '../src/dailyFritzRecoveryReconciliation';

function arg(name: string): string | undefined { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }

async function main(): Promise<void> {
  const input = arg('--input');
  const ownerMapPath = arg('--owners');
  const owners: Record<string, { email?: string; missing?: boolean }> = ownerMapPath ? JSON.parse(fs.readFileSync(ownerMapPath, 'utf8')) : {};
  const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
  const rows: DailyFritzRecoveryCandidate[] = [];
  if (input) {
    const exported = JSON.parse(fs.readFileSync(input, 'utf8')) as Array<Record<string, unknown>>;
    for (const row of exported) {
      if (row.status != null && row.status !== 'started') continue;
      const startedAt = String(row.startedAt ?? row.started_at);
      if (!Number.isFinite(Date.parse(startedAt)) || Date.parse(startedAt) >= Date.parse(cutoff)) continue;
      rows.push({ id: String(row.id), userId: String(row.userId ?? row.user_id), runDate: String(row.runDate ?? row.run_date), startedAt, result: projectDailyFritzRecoveryResult((row.result ?? row) as Record<string, unknown>) });
    }
  } else {
    if (!process.argv.includes('--supabase-read-only')) throw new Error('Use --input <export.json>, or explicitly --supabase-read-only. No writes are supported.');
    const env = { ...readEnvFile(path.resolve(__dirname, '../.env')), ...process.env };
    assertNotProductionSupabase('read-only Daily Fritz reconciliation', { env });
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY required for read-only mode.');
    const select = ['id', 'user_id', 'run_date', 'started_at', ...DAILY_FRITZ_RECOVERY_RESULT_FIELDS.map((field) => `${field}:result->${field}`)].join(',');
    let afterId: string | undefined;
    for (;;) {
      const params = new URLSearchParams({ select, status: 'eq.started', started_at: `lt.${cutoff}`, order: 'id.asc', limit: '100' });
      if (afterId) params.set('id', `gt.${afterId}`);
      const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/daily_fritz_attempts?${params}`, {
        method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Read-only attempt scan failed: HTTP ${response.status}`);
      const page = await response.json() as Array<Record<string, unknown>>;
      for (const row of page) rows.push({ id: String(row.id), userId: String(row.user_id), runDate: String(row.run_date), startedAt: String(row.started_at), result: projectDailyFritzRecoveryResult(row) });
      if (page.length < 100) break;
      afterId = String(page[page.length - 1]!.id);
    }
  }
  const attempts = rows.map((row) => summarizeDailyFritzStaleAttempt(row, owners[row.userId]));
  const counts: Record<string, number> = {};
  for (const row of attempts) counts[row.category] = (counts[row.category] ?? 0) + 1;
  process.stdout.write(`${JSON.stringify({ readOnly: true, generatedAt: new Date().toISOString(), cutoff, ownershipEvidenceProvided: Boolean(ownerMapPath), counts, attempts }, null, 2)}\n`);
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
