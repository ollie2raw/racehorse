/**
 * Guardrail #7 (ENGINEERING_GUARDRAILS.md) — proactive stale-artifact detection
 * for Daily Fritz published challenges.
 *
 * DF-STALE-1: `daily_fritz_published_challenges` rows are pre-generated a day
 * ahead and frozen (content-addressed, immutable trigger). The `/start` outage
 * came from the serving path *re-deriving* the package under whatever version
 * constants were live at call time and hard-failing on the digest mismatch. The
 * behavioural fix (reuse the already-published row, never re-derive) is shipped
 * and pinned by INV-19. This script is the other half: catch a pre-generated
 * future-dated row that will fail when it goes live *on the day of the bump*,
 * not the day of rollover.
 *
 * What still fails after the reuse-first fix (i.e. what this alarm can actually
 * fire on):
 *
 *  - `unservable` — the stored row does not survive
 *    `assertValidDailyFritzPublishedChallenge` (the exact oracle the `/start`
 *    reuse path runs): a `content_digest` that no longer matches its `package`,
 *    a column that disagrees with the package, a `fritz_policy_version` that has
 *    dropped below the current *min-supported* floor (GC-6 tolerates supported
 *    prior versions — but only supported ones), a `fritz_policy_contract` that no
 *    longer resolves, a wrong `generation_version` / rules / seed / verifier /
 *    transcript-protocol stamp, malformed hand slots. Any of these means every
 *    `/start` for that day throws once the calendar reaches it.
 *  - `orphaned_run` — a `live` future challenge whose `daily_fritz_runs` row is
 *    missing or itself `invalidated`. `/start` 409s on this
 *    (`challenge_publication_mismatch` / `challenge_publication_invalidated`).
 *
 * What it deliberately does NOT fail on (the DF-STALE-1 scenario itself, now
 * handled):
 *
 *  - `stale_tolerated` — a `fritz_policy_version` behind the current
 *    `FRITZ_POLICY_VERSION` but still supported. The reuse-first serving path
 *    absorbs this. Reported (INFO) so the drift is visible on bump day, never
 *    failing.
 *  - `missing_published_row` — a future `live` run with no published challenge
 *    yet (a warmup gap). `/start` self-heals by publishing on first call.
 *    Reported (WARN), never failing.
 *
 * Run: `npm run check:published-freshness` (server/), needs SUPABASE_URL +
 * SUPABASE_SERVICE_KEY in the environment.
 */
import { FRITZ_POLICY_VERSION } from '@racehorse/game-core';
import '../src/loadEnv';
import {
  assertValidDailyFritzPublishedChallenge,
} from '../src/dailyFritzPublishedChallenge';
import {
  toDailyFritzPublishedChallenge,
  type DailyFritzPublishedChallengeRow,
} from '../src/http/stores/dailyFritzPublishedChallengeStore';
import { getPacificDateKeyDaysFromNow } from '../src/shared/pacificDate';

export type FreshnessRunRow = { run_date: string; status: string };

export type FreshnessFinding = {
  challengeId: string;
  runDate: string;
  kind: 'unservable' | 'orphaned_run' | 'stale_tolerated' | 'missing_published_row';
  detail: string;
};

const FAILING_KINDS = new Set<FreshnessFinding['kind']>(['unservable', 'orphaned_run']);

export function isFailingFreshnessFinding(finding: FreshnessFinding): boolean {
  return FAILING_KINDS.has(finding.kind);
}

/**
 * Pure diff — no I/O. Exported so the negative tests can prove each finding kind
 * without touching the live database.
 *
 * @param challenges  published-challenge rows with `run_date >= today`
 * @param runs        `daily_fritz_runs` rows with `run_date >= today`
 * @param currentFritzPolicyVersion  the deployed `FRITZ_POLICY_VERSION`
 */
export function diffPublishedArtifactFreshness(
  challenges: DailyFritzPublishedChallengeRow[],
  runs: FreshnessRunRow[],
  currentFritzPolicyVersion: number,
): FreshnessFinding[] {
  const findings: FreshnessFinding[] = [];
  const runStatusByDate = new Map(runs.map((r) => [r.run_date, r.status] as const));
  const challengeDates = new Set(challenges.map((c) => c.run_date));

  for (const row of challenges) {
    // The authoritative "would /start be able to serve this row" oracle — the
    // same assertion the reuse path runs via toDailyFritzPublishedChallenge +
    // assertValidDailyFritzPublishedChallenge.
    try {
      assertValidDailyFritzPublishedChallenge(toDailyFritzPublishedChallenge(row));
    } catch (error) {
      findings.push({
        challengeId: row.challenge_id,
        runDate: row.run_date,
        kind: 'unservable',
        detail:
          `stored row fails validation and will 500 every /start on ${row.run_date}: `
          + `${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (row.status !== 'live') continue;

    const runStatus = runStatusByDate.get(row.run_date);
    if (!runStatus) {
      findings.push({
        challengeId: row.challenge_id,
        runDate: row.run_date,
        kind: 'orphaned_run',
        detail: `live published challenge has no daily_fritz_runs row for ${row.run_date} — /start will 409`,
      });
    } else if (runStatus !== 'live') {
      findings.push({
        challengeId: row.challenge_id,
        runDate: row.run_date,
        kind: 'orphaned_run',
        detail:
          `live published challenge but its run is '${runStatus}' — /start 409s `
          + `(challenge_publication_invalidated / _mismatch)`,
      });
    } else if (row.fritz_policy_version !== currentFritzPolicyVersion) {
      findings.push({
        challengeId: row.challenge_id,
        runDate: row.run_date,
        kind: 'stale_tolerated',
        detail:
          `fritz_policy_version ${row.fritz_policy_version} is behind current ${currentFritzPolicyVersion} `
          + `but still supported — the reuse-first serving path absorbs this (not a failure)`,
      });
    }
  }

  for (const run of runs) {
    if (run.status === 'live' && !challengeDates.has(run.run_date)) {
      findings.push({
        challengeId: `(none for ${run.run_date})`,
        runDate: run.run_date,
        kind: 'missing_published_row',
        detail: `future live run has no published challenge yet — /start self-heals by publishing on first call`,
      });
    }
  }

  return findings;
}

function supabaseHeaders(): { url: string; headers: Record<string, string> } {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required.');
  }
  return {
    url,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
  };
}

async function fetchRows<T>(path: string): Promise<T[]> {
  const { url, headers } = supabaseHeaders();
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`GET ${path} failed: ${response.status} ${body}`);
  }
  return (await response.json()) as T[];
}

async function main(): Promise<void> {
  const today = getPacificDateKeyDaysFromNow(0);
  const challenges = await fetchRows<DailyFritzPublishedChallengeRow>(
    `daily_fritz_published_challenges?select=*&run_date=gte.${today}&order=run_date.asc`,
  );
  const runs = await fetchRows<FreshnessRunRow>(
    `daily_fritz_runs?select=run_date,status&run_date=gte.${today}&order=run_date.asc`,
  );

  const findings = diffPublishedArtifactFreshness(challenges, runs, FRITZ_POLICY_VERSION);

  process.stdout.write(
    `Checked ${challenges.length} future-dated published challenge(s) and ${runs.length} run(s) `
    + `(from ${today}, current FRITZ_POLICY_VERSION=${FRITZ_POLICY_VERSION})\n`,
  );

  if (findings.length === 0) {
    process.stdout.write('published-artifact freshness clean — every pre-generated challenge is servable\n');
    return;
  }

  const failing = findings.filter(isFailingFreshnessFinding);
  for (const f of findings) {
    const tag = isFailingFreshnessFinding(f) ? 'FAIL' : f.kind === 'stale_tolerated' ? 'info' : 'warn';
    process.stdout.write(`  [${tag}:${f.kind}] ${f.runDate} ${f.challengeId}: ${f.detail}\n`);
  }

  if (failing.length > 0) {
    process.stdout.write(`${failing.length} failing freshness finding(s)\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
