/**
 * Backtest verifyPlayerMoveLog against live-room-shaped ghost_games rows.
 *
 * Usage:
 *   npm run backtest:human-move-log --prefix server
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY (required)
 *   HUMAN_MOVE_LOG_BACKTEST_LIMIT (default 500)
 */

import '../src/loadEnv';
import { verifyPlayerMoveLog } from '../src/ghost/verifier';
import type { GhostMoveLogEntry } from '../src/ghost/service';

type GhostGameRow = {
  id: string;
  user_id: string;
  played_at: string;
  final_score: number;
  opponent_score: number;
  move_log: unknown;
  match_id?: string | null;
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function hasHandNumber(log: unknown): log is GhostMoveLogEntry[] {
  return (
    Array.isArray(log) &&
    log.length > 0 &&
    log.some(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        (entry as GhostMoveLogEntry).hand_number != null &&
        Number.isFinite(Number((entry as GhostMoveLogEntry).hand_number)),
    )
  );
}

function hasDrawEntries(log: GhostMoveLogEntry[]): boolean {
  return log.some((entry) => entry.branch === 'draw');
}

function hasForcedDrawMove(log: GhostMoveLogEntry[]): boolean {
  return log.some((entry) => Boolean(entry.forced_draw) && entry.tile_played != null);
}

async function supabaseFetch<T>(baseUrl: string, serviceKey: string, path: string): Promise<T> {
  const response = await fetch(new URL(path, baseUrl), {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function fetchGhostGames(
  supabaseUrl: string,
  serviceKey: string,
  limit: number,
): Promise<GhostGameRow[]> {
  const withMatchId = `/rest/v1/ghost_games?select=id,user_id,played_at,final_score,opponent_score,move_log,match_id&order=played_at.desc&limit=${limit}`;
  const withoutMatchId = `/rest/v1/ghost_games?select=id,user_id,played_at,final_score,opponent_score,move_log&order=played_at.desc&limit=${limit}`;
  try {
    return await supabaseFetch<GhostGameRow[]>(supabaseUrl, serviceKey, withMatchId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('match_id')) throw error;
    return await supabaseFetch<GhostGameRow[]>(supabaseUrl, serviceKey, withoutMatchId);
  }
}

async function main(): Promise<void> {
  const supabaseUrl = required('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = required('SUPABASE_SERVICE_KEY');
  const limit = Math.max(1, Number(process.env.HUMAN_MOVE_LOG_BACKTEST_LIMIT ?? 500) || 500);

  const rows = await fetchGhostGames(supabaseUrl, serviceKey, limit);

  const liveShaped = rows.filter((row) => hasHandNumber(row.move_log));
  const results = {
    fetched: rows.length,
    liveShaped: liveShaped.length,
    checked: 0,
    passed: 0,
    failed: 0,
    strictPassed: 0,
    strictFailed: 0,
    emptyLogs: 0,
    withDrawEntries: 0,
    withForcedDrawMoveOnly: 0,
    failureReasons: {} as Record<string, number>,
    strictFailureReasons: {} as Record<string, number>,
    samples: [] as Array<{
      id: string;
      userId: string;
      playedAt: string;
      matchId: string | null;
      reason: string;
      entryIndex: number;
      hasDrawEntries: boolean;
      hasForcedDrawMove: boolean;
    }>,
    strictSamples: [] as Array<{
      id: string;
      userId: string;
      playedAt: string;
      matchId: string | null;
      reason: string;
      entryIndex: number;
      hasDrawEntries: boolean;
      hasForcedDrawMove: boolean;
    }>,
  };

  for (const row of liveShaped) {
    const log = row.move_log as GhostMoveLogEntry[];
    if (log.length === 0) {
      results.emptyLogs += 1;
      continue;
    }
    results.checked += 1;
    if (hasDrawEntries(log)) results.withDrawEntries += 1;
    if (hasForcedDrawMove(log) && !hasDrawEntries(log)) results.withForcedDrawMoveOnly += 1;

    const verification = verifyPlayerMoveLog(log);
    const strictVerification = verifyPlayerMoveLog(log, { strictHandContinuity: true });
    if (verification.ok) {
      results.passed += 1;
    } else {
      results.failed += 1;
      results.failureReasons[verification.reason] = (results.failureReasons[verification.reason] ?? 0) + 1;
      if (results.samples.length < 12) {
        results.samples.push({
          id: row.id,
          userId: row.user_id,
          playedAt: row.played_at,
          matchId: row.match_id ?? null,
          reason: verification.reason,
          entryIndex: verification.entryIndex,
          hasDrawEntries: hasDrawEntries(log),
          hasForcedDrawMove: hasForcedDrawMove(log),
        });
      }
    }

    if (strictVerification.ok) {
      results.strictPassed += 1;
    } else {
      results.strictFailed += 1;
      results.strictFailureReasons[strictVerification.reason] =
        (results.strictFailureReasons[strictVerification.reason] ?? 0) + 1;
      if (results.strictSamples.length < 12) {
        results.strictSamples.push({
          id: row.id,
          userId: row.user_id,
          playedAt: row.played_at,
          matchId: row.match_id ?? null,
          reason: strictVerification.reason,
          entryIndex: strictVerification.entryIndex,
          hasDrawEntries: hasDrawEntries(log),
          hasForcedDrawMove: hasForcedDrawMove(log),
        });
      }
    }
  }

  const passRate =
    results.checked > 0 ? `${((results.passed / results.checked) * 100).toFixed(1)}%` : 'n/a';
  const strictPassRate =
    results.checked > 0
      ? `${((results.strictPassed / results.checked) * 100).toFixed(1)}%`
      : 'n/a';

  console.log(
    JSON.stringify(
      {
        corpus: {
          supabaseHost: new URL(supabaseUrl).host,
          limit,
        },
        summary: {
          ...results,
          passRate,
          strictPassRate,
          samples: results.samples,
          strictSamples: results.strictSamples,
        },
        notes: [
          'liveShaped = ghost_games rows containing hand_number (live-room capture shape)',
          'passRate = legacy-tolerant verifier (historical backtest corpus)',
          'strictPassRate = strictHandContinuity gate used by PR #28 on new completions',
          'withDrawEntries = logs captured after draw-step logging shipped',
          'withForcedDrawMoveOnly = legacy logs with forced_draw MOVE but no draw steps',
        ],
      },
      null,
      2,
    ),
  );

  if (results.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
